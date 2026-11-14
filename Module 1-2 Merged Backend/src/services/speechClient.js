// backend/src/services/speechClient.js
// ---------------------------------------------------------------------------
// HTTP client for the local Whisper speech-to-text service
// (Module 6 Domain API/speech_service.py). The recording is forwarded as
// multipart and never stored. When the service is not running the route
// answers 503 with code SPEECH_UNAVAILABLE and the doctor portal falls back to
// the browser's own speech recognition, so dictation degrades, it does not break.
// ---------------------------------------------------------------------------
const { speech, inference } = require('../config');
const { HttpError } = require('../middleware/errors');

const headers = () => (inference.apiKey ? { 'X-API-Key': inference.apiKey } : {});

/**
 * @param {Buffer} audio
 * @param {{language: 'en'|'ur'|'mixed', filename?: string, mimeType?: string}} options
 * @returns {Promise<{text: string, detected_language: string, duration_seconds: number, model: string, ms: number}>}
 */
async function transcribe(audio, { language = 'mixed', filename = 'dictation.webm', mimeType = 'audio/webm' } = {}) {
  const form = new FormData();
  form.append('audio', new Blob([audio], { type: mimeType }), filename || 'dictation.webm');
  form.append('language', language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), speech.timeoutMs);
  try {
    const res = await fetch(`${speech.url}/transcribe`, {
      method: 'POST', headers: headers(), body: form, signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (res.status === 400 || res.status === 413) throw new HttpError(res.status, String(data.error || 'The recording could not be read'));
    throw new HttpError(503, `Speech service is not ready: ${data.error || res.status}`, 'SPEECH_UNAVAILABLE');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e.name === 'AbortError') throw new HttpError(504, 'Transcription took too long; try a shorter recording');
    throw new HttpError(503, 'Speech service is not running', 'SPEECH_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

/** { available, model, languages } without throwing. */
async function status() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${speech.url}/health`, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    return { available: res.ok && data.ok !== false, model: data.model ? `whisper-${data.model}` : null,
             languages: data.languages || ['en', 'mixed', 'ur'], loaded: !!data.loaded };
  } catch {
    return { available: false, model: null, languages: [], loaded: false };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { transcribe, status };
