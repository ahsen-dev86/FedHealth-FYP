// frontend/src/components/ConfidenceScores.jsx
// The signature element: a ranked, calibrated confidence readout. Deliberately
// NOT a single verdict — it shows every condition's confidence so the doctor
// weighs the picture and confirms. Percentages are monospace (instrument feel).
import { conditionLabel, pct, confColor } from '../lib/format';

// `scores` is a { conditionKey: confidence(0-1) } map from the model; `topN`
// caps how many rows are shown (default 6) so the readout stays scannable.
export default function ConfidenceScores({ scores, topN = 6 }) {
  if (!scores) {
    return <p className="fh-muted">No model scores available for this case.</p>;
  }
  // Highest confidence first, keep only the top N rows.
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, topN);

  return (
    <div className="fh-conf">
      {ranked.map(([key, value]) => (
        <div className="fh-conf__row" key={key}>
          <div className="fh-conf__name">{conditionLabel(key)}</div>
          <div className="fh-conf__track">
            {/* Floor the bar width at 2% so even a near-zero confidence is still visible as a sliver */}
            <div className="fh-conf__fill"
                 style={{ width: `${Math.max(2, Math.round(value * 100))}%`, background: confColor(value) }} />
          </div>
          <div className="fh-conf__pct fh-num">{pct(value)}</div>
        </div>
      ))}
    </div>
  );
}
