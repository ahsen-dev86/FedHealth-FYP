// frontend/src/doctor/DoctorPortal.jsx
// The point-of-care workspace. Left column = intake (patient + CBC + OCR +
// symptoms); right column = the model's confidence readout, rule flag, doctor
// confirmation, and the patient's longitudinal trends. Mirrors the scope mockup.
import { useState } from 'react';
import { api } from '../api/client';
import CbcForm from './CbcForm';
import OcrUpload from './OcrUpload';
import SymptomIntake from './SymptomIntake';
import PredictionResult from './PredictionResult';
import PatientHistory from './PatientHistory';

const EMPTY_META = {
  patientRef: '', sex: '', ageYears: '',
  district: '', province: '', latitude: '', longitude: '',
};

export default function DoctorPortal() {
  const [meta, setMeta] = useState(EMPTY_META);
  const [cbc, setCbc] = useState({});
  const [symptomsText, setSymptomsText] = useState('');
  const [symptomTags, setSymptomTags] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyKey, setHistoryKey] = useState(0); // bump to refetch after predict

  const setMetaField = (k) => (e) => setMeta({ ...meta, [k]: e.target.value });

  // Merge OCR-extracted values into the form (as strings for the inputs).
  function applyOcr(extracted) {
    const asStrings = Object.fromEntries(Object.entries(extracted).map(([k, v]) => [k, String(v)]));
    setCbc((c) => ({ ...c, ...asStrings }));
  }

  // Convert the string CBC form into numbers, dropping blanks.
  function numericCbc() {
    const out = {};
    for (const [k, v] of Object.entries(cbc)) {
      if (v !== '' && v != null && !Number.isNaN(Number(v))) out[k] = Number(v);
    }
    return out;
  }

  async function predict() {
    setError('');
    const cbcNums = numericCbc();
    if (!meta.patientRef.trim()) { setError('Enter a patient reference.'); return; }
    if (Object.keys(cbcNums).length === 0) { setError('Enter at least one CBC value (or scan a report).'); return; }

    setBusy(true);
    try {
      const payload = {
        patientRef: meta.patientRef.trim(),
        sex: meta.sex || undefined,
        ageYears: meta.ageYears ? Number(meta.ageYears) : undefined,
        district: meta.district || undefined,
        province: meta.province || undefined,
        latitude: meta.latitude ? Number(meta.latitude) : undefined,
        longitude: meta.longitude ? Number(meta.longitude) : undefined,
        symptomsText: symptomsText || undefined,
        cbc: cbcNums,
      };
      const r = await api.post('/predict', payload);
      setResult(r);
      setHistoryKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDiagnosis(predictionId, condition, notes) {
    await api.post(`/predictions/${predictionId}/confirm`, { confirmedCondition: condition, notes });
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div className="fh-eyebrow">Clinical decision support</div>
        <h1 style={{ fontSize: 24, marginTop: 4 }}>Doctor Portal</h1>
      </div>

      <div className="fh-grid-2">
        {/* ---- Intake ---- */}
        <div className="fh-card">
          <div className="fh-card__head"><h3 style={{ fontSize: 15 }}>New assessment</h3></div>
          <div className="fh-card__body">
            <div className="fh-field">
              <label className="fh-label">Patient reference <span className="fh-muted">(pseudonymous — no name/ID)</span></label>
              <input className="fh-input" value={meta.patientRef} onChange={setMetaField('patientRef')}
                     placeholder="e.g. pt-hash-001" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="fh-field">
                <label className="fh-label">Sex</label>
                <select className="fh-select" value={meta.sex} onChange={setMetaField('sex')}>
                  <option value="">—</option><option value="F">Female</option>
                  <option value="M">Male</option><option value="O">Other</option>
                </select>
              </div>
              <div className="fh-field">
                <label className="fh-label">Age</label>
                <input className="fh-input" inputMode="numeric" value={meta.ageYears} onChange={setMetaField('ageYears')} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="fh-field">
                <label className="fh-label">District</label>
                <input className="fh-input" value={meta.district} onChange={setMetaField('district')} placeholder="e.g. Lahore" />
              </div>
              <div className="fh-field">
                <label className="fh-label">Province</label>
                <input className="fh-input" value={meta.province} onChange={setMetaField('province')} placeholder="e.g. Punjab" />
              </div>
            </div>

            <hr className="fh-hr" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div className="fh-eyebrow">CBC values</div>
              <OcrUpload onExtract={applyOcr} />
            </div>
            <CbcForm cbc={cbc} setCbc={setCbc} />

            <hr className="fh-hr" />
            <div className="fh-eyebrow" style={{ marginBottom: 8 }}>Symptoms</div>
            <SymptomIntake value={symptomsText} onChange={setSymptomsText}
                           tags={symptomTags}
                           onParsed={(r) => setSymptomTags(r.tags || [])} />

            {error && <p className="fh-error" style={{ marginTop: 14 }}>{error}</p>}
            <button className="fh-btn fh-btn--primary" style={{ width: '100%', marginTop: 16 }}
                    onClick={predict} disabled={busy}>
              {busy ? 'Analyzing…' : 'Analyze CBC'}
            </button>
          </div>
        </div>

        {/* ---- Results + history ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div className="fh-card">
            <div className="fh-card__head"><h3 style={{ fontSize: 15 }}>Assessment</h3></div>
            <div className="fh-card__body">
              {result
                ? <PredictionResult result={result} onConfirm={confirmDiagnosis} />
                : <p className="fh-muted">Enter a CBC and select <strong>Analyze CBC</strong> to see calibrated
                    condition confidences and the thalassemia-trait screen.</p>}
            </div>
          </div>

          {meta.patientRef.trim() && (
            <div className="fh-card">
              <div className="fh-card__head"><h3 style={{ fontSize: 15 }}>Longitudinal trends</h3></div>
              <div className="fh-card__body">
                <PatientHistory key={historyKey} patientRef={meta.patientRef.trim()} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
