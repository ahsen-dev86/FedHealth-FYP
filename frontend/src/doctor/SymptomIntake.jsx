// frontend/src/doctor/SymptomIntake.jsx
// Multilingual symptom intake (scope 6.2.1). Free text in English, Urdu or
// Roman-Urdu, with optional voice dictation in English, Urdu, or a mix of both.
//
// Dictation: the browser records a short clip (MediaRecorder) and sends it to
// POST /symptoms/transcribe, where a Whisper model running on the hospital's
// own server turns it into text; the clip is discarded. "Mixed" lets the model
// follow a doctor who switches between Urdu and English mid-sentence. If that
// service is not running, dictation falls back to the browser's built-in
// speech recognition (Chrome/Edge), and if neither exists the button is hidden.
//
// Symptoms are decision-support CONTEXT (stored on the report, shown to the
// doctor); they are NOT fed into the CBC model.
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Sparkles, LoaderCircle } from 'lucide-react';
import { api } from '../api/client';
import { symptomLabel } from '../lib/format';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

// Browser Web Speech API constructor (fallback path), vendor-prefixed on some browsers.
const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;
const canRecord = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

export const LANGUAGES = [
  { value: 'mixed', label: 'English + اردو (mixed)', browser: 'ur-PK' },
  { value: 'en', label: 'English', browser: 'en-US' },
  { value: 'ur', label: 'اردو (Urdu)', browser: 'ur-PK' },
];
const MAX_SECONDS = 90;

// First container/codec this browser can record (Safari: mp4; Chrome/Firefox: webm/ogg opus).
function recorderMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';
}

// Free-text symptom box with voice dictation and an NLP "Recognize" call that
// turns the text into canonical tags for the doctor to review.
export default function SymptomIntake({ value, onChange, tags, onParsed }) {
  const [lang, setLang] = useState('mixed');
  const [phase, setPhase] = useState('idle'); // idle | recording | transcribing | listening (browser fallback)
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { kind: 'info' | 'error', text }
  const [serverSpeech, setServerSpeech] = useState(true); // false after the service reports unavailable
  const recorder = useRef(null);
  const chunks = useRef([]);
  const stream = useRef(null);
  const timer = useRef(null);
  const recognition = useRef(null);
  const latest = useRef(value);
  latest.current = value;

  const append = (text) => onChange(((latest.current ? `${latest.current.trim()} ` : '') + text).trim().slice(0, 2000));

  function cleanup() {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }
  useEffect(() => () => { cleanup(); recognition.current?.abort?.(); }, []);

  // Browser speech recognition (fallback when the Whisper service is not running).
  function listenInBrowser() {
    if (!SR) { setNote({ kind: 'error', text: 'Voice dictation is not available: the speech service is offline and this browser has no built-in recognition. Type the symptoms instead.' }); return; }
    const rec = new SR();
    rec.lang = LANGUAGES.find((l) => l.value === lang).browser;
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => append(Array.from(ev.results).map((r) => r[0].transcript).join(' '));
    rec.onend = () => setPhase('idle');
    rec.onerror = (ev) => {
      setPhase('idle');
      if (ev.error === 'not-allowed') setNote({ kind: 'error', text: 'Microphone access was blocked. Allow it in the browser and try again.' });
    };
    recognition.current = rec;
    setPhase('listening');
    rec.start();
  }

  async function transcribe(blob) {
    setPhase('transcribing');
    try {
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', blob, `dictation.${ext}`);
      form.append('language', lang);
      const r = await api.upload('/symptoms/transcribe', form);
      if (!r.text?.trim()) {
        setNote({ kind: 'error', text: 'No speech was heard in that recording. Hold the device closer and try again.' });
      } else {
        append(r.text.trim());
        if (r.parsed?.tags) onParsed(r.parsed);
        setNote({ kind: 'info', text: `Transcribed ${Math.round(r.durationSeconds || 0)} s of speech on the hospital server${r.detectedLanguage ? ` (heard: ${{ en: 'English', ur: 'Urdu' }[r.detectedLanguage] || r.detectedLanguage})` : ''}. Check the text before analysing.` });
      }
    } catch (e) {
      if (e.code === 'SPEECH_UNAVAILABLE') {
        setServerSpeech(false);
        setNote({ kind: 'info', text: SR
          ? 'The speech service is offline; dictation now uses this browser\'s recognition. Press Dictate again.'
          : 'The speech service is offline and this browser has no built-in recognition. Type the symptoms instead.' });
      } else {
        setNote({ kind: 'error', text: e.message });
      }
    } finally {
      setPhase('idle');
    }
  }

  async function startRecording() {
    setNote(null);
    if (!canRecord || !serverSpeech) { listenInBrowser(); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setNote({ kind: 'error', text: 'Microphone access was blocked. Allow it in the browser and try again.' });
      return;
    }
    const mimeType = recorderMime();
    const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    rec.ondataavailable = (ev) => { if (ev.data.size) chunks.current.push(ev.data); };
    rec.onstop = () => {
      cleanup();
      const blob = new Blob(chunks.current, { type: rec.mimeType || mimeType || 'audio/webm' });
      if (blob.size < 800) { setPhase('idle'); setNote({ kind: 'error', text: 'That recording was too short. Hold the button a little longer.' }); return; }
      transcribe(blob);
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setPhase('recording');
    timer.current = setInterval(() => setSeconds((s) => {
      if (s + 1 >= MAX_SECONDS) rec.state === 'recording' && rec.stop();
      return s + 1;
    }), 1000);
  }

  function toggleVoice() {
    if (phase === 'recording') { recorder.current?.state === 'recording' && recorder.current.stop(); return; }
    if (phase === 'listening') { recognition.current?.stop(); return; }
    if (phase === 'idle') startRecording();
  }

  async function recognize() {
    if (!value?.trim()) return;
    setBusy(true);
    try {
      const r = await api.post('/symptoms/parse', { text: value });
      onParsed(r); // { language, tags, symptoms }
    } catch (e) {
      setNote({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const voiceAvailable = canRecord || !!SR;
  const active = phase === 'recording' || phase === 'listening';
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        <Select value={lang} onValueChange={setLang} disabled={phase !== 'idle'}>
          <SelectTrigger className="min-w-0 flex-1 sm:w-[210px] sm:flex-none" aria-label="Dictation language" data-testid="dictation-language">
            <SelectValue>{(v) => LANGUAGES.find((l) => l.value === v)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {voiceAvailable && (
          <Button type="button" variant={active ? 'destructive' : 'outline'} className="h-8" onClick={toggleVoice}
                  disabled={phase === 'transcribing'} data-testid="dictate" aria-pressed={active}>
            {phase === 'transcribing' ? <LoaderCircle className="animate-spin" /> : active ? <Square /> : <Mic />}
            {phase === 'recording' ? `Stop · ${seconds}s` : phase === 'listening' ? 'Listening…'
              : phase === 'transcribing' ? 'Transcribing…' : 'Dictate'}
          </Button>
        )}
        {phase === 'recording' && (
          <span className="inline-flex items-center gap-1.5 text-xs text-destructive" role="status">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-70" /><span className="relative inline-flex size-2 rounded-full bg-destructive" /></span>
            Recording
          </span>
        )}
      </div>
      <Textarea rows={3} value={value} maxLength={2000} dir="auto"
                onChange={(e) => onChange(e.target.value)}
                placeholder="e.g. fatigue, pale skin, shortness of breath — یا اردو میں: تھکن، پیلاہٹ — or mixed: patient ko fever aur weakness hai" />
      {note && (
        <p className={`mt-1.5 text-[11px] ${note.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`} data-testid="dictation-note" role="status">
          {note.text}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={recognize} disabled={busy || !value?.trim()}>
          <Sparkles />
          {busy ? 'Recognizing…' : 'Recognize symptoms'}
        </Button>
      </div>
      {tags?.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="capitalize">{symptomLabel(t)}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}
