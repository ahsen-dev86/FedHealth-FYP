// frontend/src/doctor/PredictionResult.jsx
// Shows the model's calibrated confidence readout + the thalassemia rule flag +
// any alerts, and lets the doctor CONFIRM the diagnosis (the only authoritative
// diagnosis in the system). Handles the rules-only case (no ML scores).
import { useMemo, useState } from 'react';
import { TriangleAlert, CircleCheck } from 'lucide-react';
import ConfidenceScores from '../components/ConfidenceScores';
import RuleFlag from '../components/RuleFlag';
import { conditionLabel } from '../lib/format';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Separator } from '../components/ui/separator';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

export default function PredictionResult({ result, onConfirm }) {
  const inf = result?.inference;
  const prediction = result?.prediction;
  const scores = inf?.scores || null;
  const ruleFlag = inf?.rule_flags?.thalassemia_trait || result?.rule_flags?.thalassemia_trait;

  const options = useMemo(() => (scores ? Object.keys(scores) : []), [scores]);
  const [choice, setChoice] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(prediction?.confirmed_condition || null);

  async function confirm() {
    if (!choice || !prediction?.id) return;
    setBusy(true);
    try {
      await onConfirm(prediction.id, choice, notes);
      setConfirmed(choice);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {inf?.risk_flag && (
        <Alert variant="destructive" className="mb-3.5">
          <TriangleAlert />
          <AlertTitle>High-risk pattern flagged</AlertTitle>
          <AlertDescription>
            This case crossed the risk threshold{inf.top_condition ? ` (${conditionLabel(inf.top_condition)})` : ''}
            {' '}and was forwarded to surveillance. Clinical correlation advised.
          </AlertDescription>
        </Alert>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Confidence readout</div>
      <div className="mt-2.5 mb-1.5">
        {inf?.model_version && (
          <span className="text-xs text-muted-foreground">
            {inf.model_name} · {inf.model_version} · {inf.mode}
            {inf.inference_ms != null && <> · {inf.inference_ms} ms</>}
          </span>
        )}
      </div>
      <ConfidenceScores scores={scores} />

      {!scores && (
        <p className="mt-2 text-sm text-muted-foreground">
          No trained model is active for this case yet — showing the rule-based screen only.
        </p>
      )}

      {ruleFlag && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary">Screening note</div>
          <RuleFlag flag={ruleFlag} />
        </div>
      )}

      {/* Doctor confirmation — the authoritative diagnosis */}
      {prediction?.id && (
        <div className="mt-4.5">
          <Separator className="mb-4" />
          {confirmed ? (
            <Alert className="border-success/30">
              <CircleCheck className="text-success" />
              <AlertTitle>Diagnosis confirmed</AlertTitle>
              <AlertDescription className="text-foreground">{conditionLabel(confirmed)}</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Confirm diagnosis</div>
              <p className="mt-1.5 mb-2.5 text-sm text-muted-foreground">
                The model does not diagnose. Select the confirmed condition.
              </p>
              <div className="flex flex-wrap items-start gap-2">
                <Select value={choice} onValueChange={setChoice}>
                  <SelectTrigger className="w-[260px]"><SelectValue placeholder="Select a condition…" /></SelectTrigger>
                  <SelectContent>
                    {options.map((k) => <SelectItem key={k} value={k}>{conditionLabel(k)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button disabled={!choice || busy} onClick={confirm}>
                  {busy ? 'Saving…' : 'Confirm'}
                </Button>
              </div>
              <Textarea className="mt-2.5" rows={2} placeholder="Clinical notes (optional)"
                        value={notes} onChange={(e) => setNotes(e.target.value)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
