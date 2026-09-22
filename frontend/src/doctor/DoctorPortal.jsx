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
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Alert, AlertDescription } from '../components/ui/alert';
import { AlertCircle } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';

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
      <div className="mb-4.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Clinical decision support</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Doctor Portal</h1>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.05fr]">
        {/* ---- Intake ---- */}
        <Card>
          <CardHeader><CardTitle>New assessment</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <div className="space-y-1.5">
              <Label htmlFor="patientRef">Patient reference <span className="font-normal text-muted-foreground">(pseudonymous — no name/ID)</span></Label>
              <Input id="patientRef" value={meta.patientRef} onChange={setMetaField('patientRef')}
                     placeholder="e.g. pt-hash-001" />
            </div>
            <div className="mt-3.5 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Sex</Label>
                <Select value={meta.sex} onValueChange={(v) => setMeta((m) => ({ ...m, sex: v }))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="F">Female</SelectItem>
                    <SelectItem value="M">Male</SelectItem>
                    <SelectItem value="O">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ageYears">Age</Label>
                <Input id="ageYears" inputMode="numeric" value={meta.ageYears} onChange={setMetaField('ageYears')} />
              </div>
            </div>
            <div className="mt-3.5 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="district">District</Label>
                <Input id="district" value={meta.district} onChange={setMetaField('district')} placeholder="e.g. Lahore" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="province">Province</Label>
                <Input id="province" value={meta.province} onChange={setMetaField('province')} placeholder="e.g. Punjab" />
              </div>
            </div>

            <Separator className="my-4" />
            <div className="mb-2.5 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">CBC values</div>
              <OcrUpload onExtract={applyOcr} />
            </div>
            <CbcForm cbc={cbc} setCbc={setCbc} />

            <Separator className="my-4" />
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary">Symptoms</div>
            <SymptomIntake value={symptomsText} onChange={setSymptomsText}
                           tags={symptomTags}
                           onParsed={(r) => setSymptomTags(r.tags || [])} />

            {error && (
              <Alert variant="destructive" className="mt-3.5">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button className="mt-4 w-full" onClick={predict} disabled={busy}>
              {busy ? 'Analyzing…' : 'Analyze CBC'}
            </Button>
          </CardContent>
        </Card>

        {/* ---- Results + history ---- */}
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader><CardTitle>Assessment</CardTitle></CardHeader>
            <CardContent>
              {result
                ? <PredictionResult result={result} onConfirm={confirmDiagnosis} />
                : <p className="text-sm text-muted-foreground">Enter a CBC and select <strong className="font-medium text-foreground">Analyze CBC</strong> to see calibrated
                    condition confidences and the thalassemia-trait screen.</p>}
            </CardContent>
          </Card>

          {meta.patientRef.trim() && (
            <Card>
              <CardHeader><CardTitle>Longitudinal trends</CardTitle></CardHeader>
              <CardContent>
                <PatientHistory key={historyKey} patientRef={meta.patientRef.trim()} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
