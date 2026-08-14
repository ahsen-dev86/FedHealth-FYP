// frontend/src/doctor/SymptomIntake.jsx
// Multilingual symptom intake (scope 6.2.1). Free text in English, Urdu, or
// Roman-Urdu, with optional voice dictation via the browser's Web Speech API.
// A "Recognize" call sends the text to the backend NLP service, which returns
// canonical symptom tags shown as chips.
//
// Symptoms are decision-support CONTEXT (stored on the report, shown to the
// doctor); they are NOT fed into the CBC model. Voice is a progressive
// enhancement — the mic button hides if the browser lacks Speech Recognition.
import { useRef, useState } from 'react';
import { api } from '../api/client';
import { symptomLabel } from '../lib/format';

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export default function SymptomIntake({ value, onChange, tags, onParsed }) {
  const [lang, setLang] = useState('en-US');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const recognitionRef = useRef(null);

  function toggleVoice() {
    if (!SR) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const rec = new SR();
    rec.lang = lang;                 // 'en-US' or 'ur-PK'
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const t = Array.from(ev.results).map((r) => r[0].transcript).join(' ');
      onChange(((value ? value + ' ' : '') + t).trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function recognize() {
    if (!value?.trim()) return;
    setBusy(true);
    try {
      const r = await api.post('/symptoms/parse', { text: value });
      onParsed(r); // { language, tags, symptoms }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <select className="fh-select" style={{ width: 'auto' }} value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="en-US">English</option>
          <option value="ur-PK">اردو (Urdu)</option>
        </select>
        {SR && (
          <button className={`fh-btn ${listening ? 'fh-btn--primary' : 'fh-btn--ghost'}`} onClick={toggleVoice} type="button">
            {listening ? '● Listening…' : '🎤 Dictate'}
          </button>
        )}
      </div>
      <textarea className="fh-textarea" rows={3} value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="e.g. fatigue, pale skin, shortness of breath — یا اردو میں: تھکن، پیلاہٹ" />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button className="fh-btn fh-btn--ghost" onClick={recognize} disabled={busy || !value?.trim()} type="button">
          {busy ? 'Recognizing…' : 'Recognize symptoms'}
        </button>
      </div>
      {tags?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {tags.map((t) => (
            <span key={t} className="fh-pill fh-pill--muted" style={{ textTransform: 'capitalize' }}>
              {symptomLabel(t)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
