// frontend/src/doctor/PredictionResult.jsx
// The model's screening readout for one CBC: the four class confidences, which
// model version produced them, what the model did and did not use, any alerts
// raised, and the doctor's confirmation (the only authoritative diagnosis).
// Research-only rule flags are disabled in inference and never shown as model
// output.
import { useState } from 'react';
import { TriangleAlert, CircleCheck, Info, Send } from 'lucide-react';
import ConfidenceScores from '../components/ConfidenceScores';
import RuleFlag from '../components/RuleFlag';
import { CLASSES, NOT_MODEL_INPUTS } from '../lib/contract';
import { conditionLabel, pct } from '../lib/format';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

// Shown even if an older API response lacks screening.disclaimer.
export const DEFAULT_DISCLAIMER = 'Screening support only, not a diagnosis. The model scores the 10 CBC values only; '
  + 'sex, age, symptoms and location are stored for context and are not model inputs. '
  + 'A doctor must confirm any condition.';

const CONTEXT_LABELS = {
  sex: 'sex', ageYears: 'age', symptoms: 'symptoms', district: 'district', province: 'province',
  latitude: 'location', longitude: null, collectedAt: 'collection date', rule_flags: 'rule flags',
};

export default function PredictionResult({ result, onConfirm }) {
  const inf = result?.inference;
  const prediction = result?.prediction;
  const scores = inf?.scores || null;
  const screening = result?.screening || {};
  const model = result?.model || {};
  const imputed = screening.imputedFeatures || inf?.imputed_features || [];
  const alerts = result?.alerts || [];
  const notInputs = [...new Set((screening.notModelInputs || NOT_MODEL_INPUTS)
    .map((k) => CONTEXT_LABELS[k] ?? k).filter(Boolean))];

  const [choice, setChoice] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmed, setConfirmed] = useState(prediction?.confirmed_condition || null);

  async function confirm() {
    if (!choice || !prediction?.id) return;
    setBusy(true); setErr('');
    try {
      await onConfirm(prediction.id, choice, notes);
      setConfirmed(choice);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Alert className="mb-3.5 border-primary/30 bg-primary/5" data-testid="screening-disclaimer">
        <Info className="text-primary" />
        <AlertTitle>Screening support — not a diagnosis</AlertTitle>
        <AlertDescription>{screening.disclaimer || DEFAULT_DISCLAIMER}</AlertDescription>
      </Alert>

      {inf?.risk_flag && (
        <Alert variant="destructive" className="mb-3.5">
          <TriangleAlert />
          <AlertTitle>Leukemia screening score {pct(scores?.leukemia)} — at or above the {pct(inf.risk_threshold)} flag</AlertTitle>
          <AlertDescription>
            The flag is a configurable demo threshold on the leukemia score, not a clinical cut-off.
            The case was forwarded (aggregated, without patient identifiers) to NIH surveillance.
            Clinical correlation and confirmatory testing advised.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Model confidence (4 classes)</div>
        {inf?.top_condition && (
          <div className="text-xs text-muted-foreground">
            Highest score: <span className="font-medium text-foreground">{conditionLabel(inf.top_condition)} {pct(inf.top_confidence)}</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="model-version">
        <Badge variant="outline" className="font-mono">{inf?.model_name || model.name}</Badge>
        <Badge variant="outline" className="font-mono">{inf?.model_version || model.version}</Badge>
        {inf?.mode && <span>{inf.mode.replace(/_/g, ' ')}</span>}
        {inf?.calibration?.method && <span>· calibrated ({inf.calibration.method.replace(/_/g, ' ')})</span>}
        {inf?.inference_ms != null && <span>· {inf.inference_ms} ms</span>}
      </div>
      <ConfidenceScores scores={scores} />

      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <p>
          Model inputs: the 10 CBC values only.{' '}
          {imputed.length > 0
            ? <span className="text-warning" data-testid="imputed-note">Not on this report, filled with training medians: {imputed.join(', ')}.</span>
            : 'All 10 were provided.'}
        </p>
        <p>Not used by the model: {notInputs.join(', ')}.</p>
      </div>

      <RuleFlag flags={result?.rule_flags || inf?.rule_flags} />

      {alerts.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5" data-testid="alerts-raised">
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Send className="size-3.5 text-destructive" />
              <span>Forwarded to NIH: <span className="text-foreground">{a.title}</span> ({a.type.replace(/_/g, ' ')})</span>
            </div>
          ))}
        </div>
      )}

      {/* Doctor confirmation — the authoritative diagnosis */}
      {prediction?.id && (
        <div className="mt-4.5">
          <Separator className="mb-4" />
          {confirmed ? (
            <Alert className="border-success/30">
              <CircleCheck className="text-success" />
              <AlertTitle>Diagnosis confirmed by doctor</AlertTitle>
              <AlertDescription className="text-foreground">{conditionLabel(confirmed)}</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Confirm diagnosis</div>
              <p className="mt-1.5 mb-2.5 text-sm text-muted-foreground">
                The model does not diagnose. Record the condition you confirmed (it may differ from the highest score).
              </p>
              <div className="flex flex-wrap items-start gap-2">
                <Select value={choice} onValueChange={setChoice}>
                  <SelectTrigger className="w-[220px]" aria-label="Confirmed condition">
                    <SelectValue placeholder="Select a condition…">{(v) => (v ? conditionLabel(v) : 'Select a condition…')}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CLASSES.map((k) => <SelectItem key={k} value={k}>{conditionLabel(k)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button disabled={!choice || busy} onClick={confirm}>
                  {busy ? 'Saving…' : 'Confirm'}
                </Button>
              </div>
              <Textarea className="mt-2.5" rows={2} placeholder="Clinical notes (optional)"
                        value={notes} onChange={(e) => setNotes(e.target.value)} />
              {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
