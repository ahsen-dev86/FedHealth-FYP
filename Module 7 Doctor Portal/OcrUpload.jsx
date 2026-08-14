// frontend/src/doctor/OcrUpload.jsx
// Upload a photo/scan of a paper CBC report; the backend runs Tesseract and
// returns extracted CBC values, which we merge into the form. Extraction is
// best-effort — the doctor reviews the filled fields before predicting.
import { useRef, useState } from 'react';
import { api } from '../api/client';

export default function OcrUpload({ onExtract }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function handle(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await api.upload('/ocr', fd);
      onExtract(r.cbc || {});
      setMsg(r.extractedCount
        ? `Filled ${r.extractedCount} value${r.extractedCount === 1 ? '' : 's'} from the report — please review.`
        : 'No values could be read. Try a clearer photo, or enter values manually.');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handle} />
      <button className="fh-btn fh-btn--ghost" disabled={busy}
              onClick={() => inputRef.current?.click()}>
        {busy ? 'Reading report…' : 'Scan paper report (OCR)'}
      </button>
      {msg && <p className="fh-muted" style={{ marginTop: 8 }}>{msg}</p>}
      {err && <p className="fh-error" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}
