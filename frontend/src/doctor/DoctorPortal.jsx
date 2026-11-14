// frontend/src/doctor/DoctorPortal.jsx
// The point-of-care workspace. Left column = intake (patient context + the 10
// CBC values with their units + OCR + symptoms); right column = the model's
// screening readout, doctor confirmation, and the patient's longitudinal trends.
// Only the CBC values reach the model; everything else is context.
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import CbcForm from './CbcForm';
import OcrUpload from './OcrUpload';
import SymptomIntake from './SymptomIntake';
import PredictionResult from './PredictionResult';
import PatientHistory from './PatientHistory';
import {
  FEATURES, UNIT_OPTIONS, validateCbc, unitFactor, patientRefError, ageError,
} from '../lib/contract';
import { DISTRICTS, findDistrict } from '../lib/districts';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Alert, AlertDescription } from '../components/ui/alert';
import { AlertCircle, TriangleAlert, Sparkles, Copy, Check } from 'lucide-react';
import { formatWhileTyping, generateRef, normalizeRef } from '../lib/patientRef';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';

const EMPTY_META = { patientRef: '', sex: '', ageYears: '', district: '' };
const CANONICAL = Object.fromEntries(FEATURES.map((f) => [f, UNIT_OPTIONS[f][0].value]));
const NATIVE_SELECT = 'h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none '
  + 'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

// Small inline label reminding the doctor that a field (sex/age/district) is
// stored for context only and never reaches the prediction model.
function ContextNote() {
  return <span className="font-normal text-muted-foreground">(context, not used by the model)</span>;
}

// Top-level page for the doctor workflow: collect patient context + CBC (manual
// or OCR) + symptoms, call /predict, then show the result and history side by side.
export default function DoctorPortal() {
  const [meta, setMeta] = useState(EMPTY_META);
  const [cbc, setCbc] = useState({});
  const [units, setUnits] = useState(CANONICAL);
  const [printedUnits, setPrintedUnits] = useState({});
  const [source, setSource] = useState('manual');
  const [symptomsText, setSymptomsText] = useState('');
  const [symptomTags, setSymptomTags] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historyKey, setHistoryKey] = useState(0); // bump to refetch after predict

  const validation = useMemo(() => validateCbc(cbc, units), [cbc, units]);
  const refError = patientRefError(meta.patientRef);
  const ageErr = ageError(meta.ageYears);
  const setMetaField = (k) => (e) => setMeta({ ...meta, [k]: e.target.value });
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(''); // the ID just generated, so the doctor is told to write it down
  const [copied, setCopied] = useState(false);

  // New patient: ask the API for an unused FH-XXXX-XXXX ID (falls back to a locally generated one).
  async function newPatientId() {
    setIssuing(true);
    try {
      const r = await api.get('/patients/new-ref');
      setMeta((m) => ({ ...m, patientRef: r.patientRef }));
      setIssued(r.patientRef);
    } catch {
      const ref = generateRef();
      setMeta((m) => ({ ...m, patientRef: ref }));
      setIssued(ref);
    } finally {
      setIssuing(false);
      setCopied(false);
    }
  }

  async function copyId() {
    try { await navigator.clipboard.writeText(meta.patientRef); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  }

  // Merge OCR output: values as printed plus the printed unit when the API accepts it.
  function applyOcr(r) {
    const values = Object.fromEntries(Object.entries(r.cbc || {}).map(([k, v]) => [k, String(v)]));
    const nextUnits = { ...units };
    for (const [f, unit] of Object.entries(r.units || {})) {
      nextUnits[f] = unit && unitFactor(f, unit) !== null ? unit : '';
    }
    setCbc((c) => ({ ...c, ...values }));
    setUnits(nextUnits);
    setPrintedUnits(Object.fromEntries(Object.entries(r.units || {}).filter(([, u]) => u)));
    setSource('ocr');
    setShowErrors(true);
  }

  // Validate patient ref, age and every CBC field/unit locally before spending
  // a round trip on the API; showErrors flips on so field-level messages appear.
  async function predict() {
    setError('');
    setShowErrors(true);
    if (refError) { setError(refError); return; }
    if (ageErr) { setError(ageErr); return; }
    if (Object.keys(validation.errors).length) {
      setError('Fix the highlighted CBC values or units first.');
      return;
    }
    if (Object.keys(validation.values).length === 0) {
      setError('Enter at least one CBC value (or scan a report).');
      return;
    }
    const place = findDistrict(meta.district);
    setBusy(true);
    try {
      const payload = {
        patientRef: normalizeRef(meta.patientRef),
        sex: meta.sex || undefined,
        ageYears: meta.ageYears ? Number(meta.ageYears) : undefined,
        district: place?.district,
        province: place?.province,
        latitude: place?.latitude,
        longitude: place?.longitude,
        symptomsText: symptomsText || undefined,
        source,
        cbc: validation.values,
        units: validation.units,
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

  // Records the doctor's authoritative diagnosis against a prior prediction
  // (passed down to PredictionResult as onConfirm).
  async function confirmDiagnosis(predictionId, condition, notes) {
    return api.post(`/predictions/${predictionId}/confirm`, { confirmedCondition: condition, notes: notes || undefined });
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
              <Label htmlFor="patientRef">Patient ID <span className="font-normal text-muted-foreground">(pseudonymous — no name, CNIC or phone)</span></Label>
              <div className="flex gap-2">
                <Input id="patientRef" value={meta.patientRef} className="font-mono tracking-wide"
                       onChange={(e) => { setMeta({ ...meta, patientRef: formatWhileTyping(e.target.value) }); setIssued(''); }}
                       aria-invalid={showErrors && refError ? true : undefined} maxLength={64}
                       autoCapitalize="characters" autoComplete="off" spellCheck={false}
                       placeholder="FH-XXXX-XXXX" />
                <Button type="button" variant="outline" className="h-8 shrink-0" onClick={newPatientId} disabled={issuing}
                        data-testid="new-patient-id" title="Generate an ID for a new patient">
                  <Sparkles /> <span className="hidden sm:inline">{issuing ? 'Generating…' : 'New patient'}</span><span className="sm:hidden">New</span>
                </Button>
              </div>
              {issued && issued === meta.patientRef ? (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground" data-testid="patient-id-issued">
                  New ID issued. Write it on the patient's card so their next visit links to this one.
                  <button type="button" onClick={copyId} className="inline-flex items-center gap-1 font-medium text-primary">
                    {copied ? <><Check className="size-3" /> Copied</> : <><Copy className="size-3" /> Copy</>}
                  </button>
                </p>
              ) : !meta.patientRef && (
                <p className="text-[11px] text-muted-foreground">Returning patient: type the ID from their card. New patient: generate one.</p>
              )}
              {(showErrors || meta.patientRef.length >= 12) && refError && (
                <p className="text-[11px] text-destructive" data-testid="patient-ref-error">{refError}</p>
              )}
            </div>
            <div className="mt-3.5 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Sex <ContextNote /></Label>
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
                <Label htmlFor="ageYears">Age <ContextNote /></Label>
                <Input id="ageYears" inputMode="numeric" value={meta.ageYears} onChange={setMetaField('ageYears')}
                       aria-invalid={ageErr ? true : undefined} maxLength={3} />
                {ageErr && <p className="text-[11px] text-destructive" data-testid="age-error">{ageErr}</p>}
              </div>
            </div>
            <div className="mt-3.5 space-y-1.5">
              <Label htmlFor="district">District <ContextNote /></Label>
              <select id="district" className={NATIVE_SELECT} value={meta.district} onChange={setMetaField('district')}>
                <option value="">Not recorded</option>
                {DISTRICTS.map((d) => (
                  <option key={d.district} value={d.district}>{d.district} ({d.province})</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">Used only for aggregated NIH surveillance at district level.</p>
            </div>

            <Separator className="my-4" />
            <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">CBC values (model inputs)</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Enter each value with the unit printed on the report.</p>
              </div>
              <OcrUpload onExtract={applyOcr} />
            </div>
            <CbcForm cbc={cbc} setCbc={setCbc} units={units} setUnits={setUnits} printedUnits={printedUnits}
                     validation={showErrors ? validation : { canonical: validation.canonical }} />
            {validation.warnings.length > 0 && (
              <Alert className="mt-3 border-warning/40" data-testid="cbc-warnings">
                <TriangleAlert className="text-warning" />
                <AlertDescription>
                  <div className="font-medium text-foreground">Check these values (analysis still allowed):</div>
                  <ul className="mt-1 list-disc pl-4">{validation.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </AlertDescription>
              </Alert>
            )}

            <Separator className="my-4" />
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
              Symptoms <ContextNote />
            </div>
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
                ? <PredictionResult key={result.prediction?.id} result={result} onConfirm={confirmDiagnosis} />
                : <p className="text-sm text-muted-foreground">Enter a CBC and select <strong className="font-medium text-foreground">Analyze CBC</strong> to
                    see the model's calibrated confidence for healthy, anemia, thalassemia and leukemia. The result is
                    screening support; you confirm the diagnosis.</p>}
            </CardContent>
          </Card>

          {meta.patientRef.trim() && !refError && (
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
