// frontend/src/model-health/LimitationsPanel.jsx
// "Known limitations": measured weaknesses shown next to the headline metrics,
// computed from /model-health/limitations (registry limitations + imported run
// records). Nothing here is typed in by hand: the source-exclusion accuracies
// come from source_holdout.json and the federation facts from round_history.json.
import { TriangleAlert } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { pct } from '../lib/format';

const signed = (x) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pts`);

export default function LimitationsPanel({ data }) {
  if (!data) return <p className="text-sm text-muted-foreground">Loading limitations…</p>;
  const holdout = data.sourceHoldout;
  const fed = data.federation || {};
  const runs = fed.runs || [];
  const later = runs.filter((r) => r.selected_round > 0);
  const alpha01 = runs.filter((r) => r.scenario === 'non_iid_01');
  const sources = [...(holdout?.sources || [])].sort((a, b) => a.ann_accuracy - b.ann_accuracy);
  const [lo, hi] = holdout?.ann_accuracy_range || [];

  return (
    <div className="space-y-4 text-sm" data-testid="limitations-panel">
      <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <p className="text-foreground">
          This is a proof of concept trained on a public-data composite. It has <strong>not</strong> been validated on
          data from unseen laboratories and must not be read as clinically validated.
        </p>
      </div>

      {holdout && (
        <div>
          <div className="font-medium text-foreground">
            Unseen-source accuracy: {pct(lo)}–{pct(hi)} (ANN, seed {holdout.seed})
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each data source was held out in turn and the model refitted without it; four balanced classes give 25% by chance.
          </p>
          <Table className="mt-2" data-testid="source-holdout-table">
            <TableHeader>
              <TableRow>
                <TableHead>Excluded source</TableHead>
                <TableHead className="text-right">Rows scored</TableHead>
                <TableHead className="text-right">ANN accuracy</TableHead>
                <TableHead className="text-right">Hybrid accuracy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((s) => (
                <TableRow key={s.excluded_source}>
                  <TableCell className="font-mono text-xs">{s.excluded_source}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{s.excluded_rows ?? '—'}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{pct(s.ann_accuracy)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{pct(s.hybrid_accuracy)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {holdout.note && <p className="mt-1 text-xs text-muted-foreground">{holdout.note}</p>}
        </div>
      )}

      {runs.length > 0 && (
        <div>
          <div className="font-medium text-foreground">
            Federation did not beat the starting model in {fed.keptRoundZero} of {fed.plaintextRuns} plaintext runs
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            <li>Round selection uses global validation log loss; round 0 is the centralized model.</li>
            {later.map((r) => (
              <li key={`${r.seed}-${r.scenario}`}>
                Seed {r.seed} {r.scenario}: round {r.selected_round} selected; test accuracy {signed(r.test_accuracy_delta)} vs the
                centralized model of the same seed.
              </li>
            ))}
            {alpha01.length > 0 && (
              <li>
                Strongly non-IID (α = 0.1): validation loss by the last round{' '}
                {alpha01.every((r) => r.val_loss_final > r.val_loss_round0) ? 'rose in every seed' : 'changed'}{' '}
                ({alpha01.map((r) => `${r.val_loss_round0.toFixed(3)} → ${r.val_loss_final.toFixed(3)}`).join('; ')}).
              </li>
            )}
          </ul>
        </div>
      )}

      {data.notes?.length > 0 && (
        <div>
          <div className="font-medium text-foreground">Protocol notes</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {data.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
