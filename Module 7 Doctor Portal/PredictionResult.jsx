// frontend/src/doctor/PredictionResult.jsx
// Shows the model's calibrated confidence readout + the thalassemia rule flag +
// any alerts, and lets the doctor CONFIRM the diagnosis (the only authoritative
// diagnosis in the system). Handles the rules-only case (no ML scores).
import { useMemo, useState } from 'react';
import ConfidenceScores from '../components/ConfidenceScores';
import RuleFlag from '../components/RuleFlag';
import { conditionLabel } from '../lib/format';

// `result` is the /predict response; `onConfirm` persists the doctor's final
// call. Renders the confidence bars, the thalassemia rule flag, any high-risk
// alert, and (once a prediction id exists) the confirm-diagnosis controls.
export default function PredictionResult({ result, onConfirm }) {
  const inf = result?.inference;
  const prediction = result?.prediction;
  const scores = inf?.scores || null;
  // Rule flag may be nested under inference or, for older payload shapes, at the top level.
  const ruleFlag = inf?.rule_flags?.thalassemia_trait || result?.rule_flags?.thalassemia_trait;

  const options = useMemo(() => (scores ? Object.keys(scores) : []), [scores]);
  const [choice, setChoice] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(prediction?.confirmed_condition || null);

  // Sends the doctor-selected condition to the backend, then flips this
  // panel into its "confirmed" (read-only) state.
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
        <div className="fh-flag fh-flag--risk" style={{ marginBottom: 14 }}>
          <div>
            <div className="fh-flag__title fh-flag__title--risk">High-risk pattern flagged</div>
            <div className="fh-flag__body">
              This case crossed the risk threshold{inf.top_condition ? ` (${conditionLabel(inf.top_condition)})` : ''}
              {' '}and was forwarded to surveillance. Clinical correlation advised.
            </div>
          </div>
        </div>
      )}

      <div className="fh-eyebrow">Confidence readout</div>
      <div style={{ marginTop: 10, marginBottom: 6 }}>
        {inf?.model_version && (
          <span className="fh-muted" style={{ fontSize: 12 }}>
            {inf.model_name} · {inf.model_version} · {inf.mode}
            {inf.inference_ms != null && <> · {inf.inference_ms} ms</>}
          </span>
        )}
      </div>
      <ConfidenceScores scores={scores} />

      {!scores && (
        <p className="fh-muted" style={{ marginTop: 8 }}>
          No trained model is active for this case yet — showing the rule-based screen only.
        </p>
      )}

      {ruleFlag && (
        <div style={{ marginTop: 16 }}>
          <div className="fh-eyebrow">Screening note</div>
          <div style={{ marginTop: 8 }}><RuleFlag flag={ruleFlag} /></div>
        </div>
      )}

      {/* Doctor confirmation — the authoritative diagnosis */}
      {prediction?.id && (
        <div style={{ marginTop: 18 }}>
          <hr className="fh-hr" />
          {confirmed ? (
            <div className="fh-flag fh-flag--ok">
              <div>
                <div className="fh-flag__title">Diagnosis confirmed</div>
                <div className="fh-flag__body">{conditionLabel(confirmed)}</div>
              </div>
            </div>
          ) : (
            <>
              <div className="fh-eyebrow">Confirm diagnosis</div>
              <p className="fh-muted" style={{ margin: '6px 0 10px' }}>
                The model does not diagnose. Select the confirmed condition.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <select className="fh-select" style={{ maxWidth: 280 }} value={choice} onChange={(e) => setChoice(e.target.value)}>
                  <option value="">Select a condition…</option>
                  {options.map((k) => <option key={k} value={k}>{conditionLabel(k)}</option>)}
                </select>
                <button className="fh-btn fh-btn--primary" disabled={!choice || busy} onClick={confirm}>
                  {busy ? 'Saving…' : 'Confirm'}
                </button>
              </div>
              <textarea className="fh-textarea" style={{ marginTop: 10 }} rows={2}
                        placeholder="Clinical notes (optional)"
                        value={notes} onChange={(e) => setNotes(e.target.value)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
