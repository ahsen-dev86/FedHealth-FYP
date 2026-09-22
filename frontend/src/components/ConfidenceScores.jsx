// frontend/src/components/ConfidenceScores.jsx
// The signature element: a ranked, calibrated confidence readout. Deliberately
// NOT a single verdict — it shows every condition's confidence so the doctor
// weighs the picture and confirms. Percentages are monospace (instrument feel).
import { conditionLabel, pct, confColor } from '../lib/format';

export default function ConfidenceScores({ scores, topN = 6 }) {
  if (!scores) {
    return <p className="text-sm text-muted-foreground">No model scores available for this case.</p>;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, topN);

  return (
    <div className="flex flex-col gap-2.5">
      {ranked.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[130px_1fr_48px] items-center gap-3 sm:grid-cols-[190px_1fr_56px]">
          <div className="truncate text-[13px] text-foreground">{conditionLabel(key)}</div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full transition-[width] duration-500 ease-out"
                 style={{ width: `${Math.max(2, Math.round(value * 100))}%`, background: confColor(value) }} />
          </div>
          <div className="text-right font-mono text-[13px] tabular-nums text-foreground">{pct(value)}</div>
        </div>
      ))}
    </div>
  );
}
