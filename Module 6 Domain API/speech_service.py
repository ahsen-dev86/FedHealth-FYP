"""Speech-to-text for the doctor's symptom dictation: English, Urdu, and mixed English-Urdu."""
# A separate small Flask service (default 127.0.0.1:8002) so the speech model
# never shares a process, or a Python environment, with the CBC model.
#
#   * Model: OpenAI Whisper (multilingual) run locally through faster-whisper
#     (CTranslate2, int8 on CPU). Audio never leaves the machine: no cloud
#     speech API is called, which matters for clinical dictation.
#   * language = "en" | "ur" | "mixed". "mixed" lets Whisper detect the language
#     and primes it with a bilingual symptom prompt so code-switched speech
#     ("patient ko fever hai aur bohat weakness") keeps its English terms. If
#     detection lands on a language other than English/Urdu (spoken Urdu is
#     often detected as Hindi), the audio is decoded again as Urdu.
#   * The transcript is clinical CONTEXT for the doctor. It is not a model input.
#
# Run:  .venv-speech\Scripts\python.exe "Module 6 Domain API\speech_service.py"
# Env:  WHISPER_MODEL (default "small"), WHISPER_COMPUTE (default "int8"),
#       WHISPER_DEVICE (default "cpu"), SPEECH_PORT (8002), INFERENCE_API_KEY.
import os
import tempfile
import threading
import time

from flask import Flask, jsonify, request

MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
API_KEY = os.environ.get("INFERENCE_API_KEY", "")
MAX_SECONDS = float(os.environ.get("SPEECH_MAX_SECONDS", "120"))
LANGUAGES = {"en", "ur", "mixed"}

# Vocabulary hints: Whisper conditions on this text, which steers spelling of
# symptom words in both scripts without constraining what can be transcribed.
PROMPTS = {
    "en": "Patient symptoms: fatigue, pallor, fever, shortness of breath, bruising, bone pain, weight loss.",
    "ur": "مریض کی علامات: تھکن، کمزوری، بخار، سانس پھولنا، چکر، یرقان، ہڈیوں میں درد، وزن میں کمی۔",
    "mixed": "مریض کو fever ہے، بہت weakness اور fatigue ہے، bone pain بھی ہے۔ "
             "Patient has pallor and shortness of breath, بھوک نہیں لگتی۔",
}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024  # a 2-minute opus clip is well under 2 MB

_model = None
_model_error = None
_lock = threading.Lock()


def _load():
    """Load the Whisper model once (first use downloads it to the Hugging Face cache)."""
    global _model, _model_error
    with _lock:
        if _model is None and _model_error is None:
            try:
                from faster_whisper import WhisperModel
                _model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)
            except Exception as exc:  # no network for the first download, bad model name, ...
                _model_error = f"{type(exc).__name__}: {exc}"
    return _model


def _decode(path, language, prompt):
    segments, info = _model.transcribe(
        path, language=language, initial_prompt=prompt, beam_size=5,
        vad_filter=True, condition_on_previous_text=False)
    text = " ".join(s.text.strip() for s in segments).strip()
    return text, info


@app.errorhandler(413)
def _too_large(_err):
    return jsonify(error="The recording is too large"), 413


@app.get("/health")
def health():
    ready = _model is not None
    return jsonify(ok=_model_error is None, service="fedhealth-speech", model=MODEL_NAME, loaded=ready,
                   languages=sorted(LANGUAGES), error=_model_error), 200 if _model_error is None else 503


@app.post("/transcribe")
def transcribe():
    if API_KEY and request.headers.get("X-API-Key") != API_KEY:
        return jsonify(error="unauthorized"), 401
    upload = request.files.get("audio")
    if upload is None:
        return jsonify(error='Send the recording in the form field "audio"'), 400
    mode = (request.form.get("language") or "mixed").lower()
    if mode not in LANGUAGES:
        return jsonify(error="language must be en, ur or mixed"), 400
    if _load() is None:
        return jsonify(error=f"speech model unavailable: {_model_error}"), 503

    start = time.perf_counter()
    suffix = os.path.splitext(upload.filename or "")[1][:8] or ".webm"
    fd, path = tempfile.mkstemp(suffix=suffix, prefix="fedhealth-speech-")
    os.close(fd)
    try:
        upload.save(path)
        try:
            text, info = _decode(path, None if mode == "mixed" else mode, PROMPTS[mode])
            if mode == "mixed" and info.language not in ("en", "ur"):
                text, info = _decode(path, "ur", PROMPTS["mixed"])
        except Exception as exc:
            return jsonify(error=f"Could not read the recording ({type(exc).__name__}); try recording again"), 400
    finally:
        try:
            os.remove(path)  # the audio is never kept
        except OSError:
            pass
    if info.duration > MAX_SECONDS:
        return jsonify(error=f"Recording is longer than {int(MAX_SECONDS)} seconds"), 400
    return jsonify(text=text, requested_language=mode, detected_language=info.language,
                   language_probability=round(float(info.language_probability), 3),
                   duration_seconds=round(float(info.duration), 2), model=f"whisper-{MODEL_NAME}",
                   ms=int((time.perf_counter() - start) * 1000))


if __name__ == "__main__":
    if os.environ.get("SPEECH_PRELOAD", "1") == "1":
        threading.Thread(target=_load, daemon=True).start()
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("SPEECH_PORT", "8002")), threaded=True)
