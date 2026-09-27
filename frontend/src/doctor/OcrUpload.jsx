// frontend/src/doctor/OcrUpload.jsx
// Read a paper CBC report: upload a photo/scan (the backend runs Tesseract) or
// paste the report text (e.g. from a PDF or LIMS printout). The API returns the
// 10 model values plus the unit printed next to each; both are merged into the
// form for the doctor to review. OCR is best-effort: values that fail the unit
// or range checks are highlighted and must be corrected before analysis.
import { useRef, useState } from 'react';
import { ScanLine, ClipboardPaste, AlertCircle } from 'lucide-react';
import { api } from '../api/client';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';

const OCR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/tiff'];
const MAX_BYTES = 8 * 1024 * 1024;

// Builds the human-readable status line after an OCR call: how many of the 10
// values were read, and what still needs the doctor's attention.
function summary(r) {
  const n = r.extractedCount || 0;
  if (!n) return 'No CBC values could be read. Try a clearer, flatter photo, or enter values manually.';
  const check = Object.entries(r.unitStatus || {})
    .filter(([, s]) => s === 'unsupported' || s === 'no_unit_printed').map(([f]) => f);
  const parts = [`Read ${n} of 10 values — review them before analysing.`];
  if (check.length) parts.push(`Choose the unit for ${check.join(', ')}.`);
  if (r.outOfRange?.length) parts.push(`Check ${r.outOfRange.join(', ')} (outside the plausible range; possible misread).`);
  if (r.missing?.length) parts.push(`Not found: ${r.missing.join(', ')}.`);
  return parts.join(' ');
}

// Two entry points to the same /ocr endpoint: upload an image or paste text.
// Either way the parent's onExtract(result) merges values into the CBC form.
export default function OcrUpload({ onExtract }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');

  // Shared request runner for both the file-upload and paste-text flows.
  async function run(request) {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await request();
      onExtract(r);
      setMsg(summary(r));
      setPasting(false);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Same limits as the API, checked first so the doctor gets an immediate answer.
    const problem = !OCR_TYPES.includes(file.type) ? 'Choose a PNG, JPEG, WebP or TIFF photo/scan of the report (for a PDF, paste its text).'
      : file.size === 0 ? 'That file is empty.'
      : file.size > MAX_BYTES ? 'The image is larger than 8 MB; take a smaller photo or crop it.' : '';
    if (problem) {
      setErr(problem); setMsg('');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    const fd = new FormData();
    fd.append('image', file);
    run(() => api.upload('/ocr', fd));
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/tiff" hidden
             data-testid="ocr-file" onChange={handleFile} />
      <div className="flex gap-1.5">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <ScanLine />
          {busy ? 'Reading report…' : 'Scan report (OCR)'}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setPasting((v) => !v)}>
          <ClipboardPaste /> Paste text
        </Button>
      </div>
      {pasting && (
        <div className="w-full space-y-1.5">
          <Textarea rows={5} maxLength={20000} placeholder={'e.g.\nTotal Leucocyte Count  9,010  /mm3\nHaemoglobin  12.4  g/dL'}
                    aria-label="Report text" value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="button" size="sm" disabled={busy || !text.trim()}
                  onClick={() => run(() => api.post('/ocr', { text }))}>
            Read values
          </Button>
        </div>
      )}
      {msg && <p className="w-full text-xs text-muted-foreground" data-testid="ocr-summary">{msg}</p>}
      {err && (
        <p className="flex w-full items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="size-3.5" /> {err}
        </p>
      )}
    </div>
  );
}
