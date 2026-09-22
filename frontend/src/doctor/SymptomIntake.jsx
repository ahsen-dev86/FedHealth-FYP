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
import { Mic, Square, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { symptomLabel } from '../lib/format';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

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
      <div className="mb-2 flex gap-2">
        <Select value={lang} onValueChange={setLang}>
          <SelectTrigger className="w-[150px]">
            <SelectValue>{(v) => (v === 'ur-PK' ? 'اردو (Urdu)' : 'English')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en-US">English</SelectItem>
            <SelectItem value="ur-PK">اردو (Urdu)</SelectItem>
          </SelectContent>
        </Select>
        {SR && (
          <Button type="button" variant={listening ? 'default' : 'outline'} size="sm" onClick={toggleVoice}>
            {listening ? <Square /> : <Mic />}
            {listening ? 'Listening…' : 'Dictate'}
          </Button>
        )}
      </div>
      <Textarea rows={3} value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="e.g. fatigue, pale skin, shortness of breath — یا اردو میں: تھکن، پیلاہٹ" />
      <div className="mt-2 flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={recognize} disabled={busy || !value?.trim()}>
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
