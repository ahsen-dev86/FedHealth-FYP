// frontend/src/components/ConfidenceScores.jsx
// The signature element: the model's calibrated confidence for each of its four
// classes (healthy, anemia, thalassemia, leukemia), highest first. Deliberately
// NOT a single verdict — every class is shown so the doctor weighs the picture
// and confirms. Percentages are monospace (instrument feel).
import { CLASSES } from '../lib/contract';
import { conditionLabel, conditionColor, pct } from '../lib/format';

// Renders one horizontal bar per class, sorted highest score first.
export default function ConfidenceScores({ scores }) {
  if (!scores) {
    return <p className="text-sm text-muted-foreground">No model scores available for this case.</p>;
  }
  // Only classes actually present in the response are shown, ranked descending.
  const ranked = CLASSES.filter((c) => c in scores).sort((a, b) => scores[b] - scores[a]);

  return (
    <div className="flex flex-col gap-2.5" data-testid="confidence-scores">
      {ranked.map((key, i) => {
        const value = scores[key];
        return (
          <div key={key} className="grid grid-cols-[120px_1fr_48px] items-center gap-3 sm:grid-cols-[150px_1fr_56px]"
               data-testid={`score-${key}`}>
            <div className="flex items-center gap-2 truncate text-[13px] text-foreground">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: conditionColor(key) }} />
              <span className={i === 0 ? 'font-semibold' : ''}>{conditionLabel(key)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-[width] duration-500 ease-out"
                   style={{ width: `${Math.max(2, Math.round(value * 100))}%`, background: conditionColor(key) }} />
            </div>
            <div className="text-right font-mono text-[13px] tabular-nums text-foreground">{pct(value)}</div>
          </div>
        );
      })}
    </div>
  );
}
