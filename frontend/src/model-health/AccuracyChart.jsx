// frontend/src/model-health/AccuracyChart.jsx
// Global VALIDATION accuracy and log loss per federated round for one imported
// run (round 0 = the centralized starting model). Two y-axes since the series
// are on different scales. The dashed line marks the round the protocol
// selected by validation loss; when it is round 0, federation did not improve
// on the starting model. These are validation values, not the frozen test set.
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

export function runLabel(r) {
  if (!r) return '';
  const enc = r.encryption === 'paillier' ? ` · Paillier ${r.key_bits}` : '';
  return `seed ${r.seed} · ${r.scenario}${enc} · ${r.total_rounds} rounds`;
}

export default function AccuracyChart({ history, runId, onRunChange }) {
  const points = history?.points || [];
  if (!history) return <p className="text-sm text-muted-foreground">Loading training history…</p>;
  if (points.length === 0) return <p className="text-sm text-muted-foreground">No federated run has been imported yet.</p>;

  const byRound = history.source === 'fl_rounds';
  const data = points.map((p) => ({
    round: byRound ? p.round_number : (p.created_at || '').slice(0, 10),
    accuracy: p.accuracy != null ? +(p.accuracy * 100).toFixed(2) : null,
    macroF1: p.macro_f1 != null ? +(p.macro_f1 * 100).toFixed(2) : null,
    loss: p.loss != null ? +p.loss.toFixed(4) : null,
  }));
  const accs = data.map((d) => d.accuracy).filter((x) => x != null);
  const lo = Math.max(0, Math.floor(Math.min(...accs) - 3));
  const hi = Math.min(100, Math.ceil(Math.max(...accs) + 2));
  const selected = history.run?.selected_round;

  return (
    <div>
      {history.runs?.length > 0 && (
        <select aria-label="Federated run" data-testid="run-select" value={runId || history.run?.id || ''}
                onChange={(e) => onRunChange?.(e.target.value)}
                className="mb-2 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30">
          {history.runs.map((r) => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
        </select>
      )}
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="round" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                 label={byRound ? { value: 'round', position: 'insideBottomRight', offset: -2, style: { fontSize: 11, fill: 'var(--muted-foreground)' } } : undefined} />
          <YAxis yAxisId="acc" domain={[lo, hi]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                 label={{ value: 'validation %', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
          <YAxis yAxisId="loss" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                 label={{ value: 'log loss', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {byRound && selected != null && (
            <ReferenceLine yAxisId="acc" x={selected} stroke="var(--muted-foreground)" strokeDasharray="4 4"
                           label={{ value: `selected: round ${selected}`, position: 'insideTopLeft', fontSize: 10, fill: 'var(--muted-foreground)' }} />
          )}
          <Line yAxisId="acc" type="monotone" dataKey="accuracy" name="Validation accuracy %" stroke="var(--chart-1)" strokeWidth={2}
                dot={{ r: 2.5, fill: 'var(--chart-1)' }} isAnimationActive={false} connectNulls />
          <Line yAxisId="acc" type="monotone" dataKey="macroF1" name="Validation macro-F1 %" stroke="var(--chart-2)" strokeWidth={1.5}
                dot={false} isAnimationActive={false} connectNulls />
          <Line yAxisId="loss" type="monotone" dataKey="loss" name="Validation log loss" stroke="var(--chart-4)" strokeWidth={2}
                dot={{ r: 2.5, fill: 'var(--chart-4)' }} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-muted-foreground">
        Global validation split after each aggregation; round 0 is the centralized starting model.
        {selected === 0 && ' This run kept round 0: federation did not improve validation loss.'}
      </p>
    </div>
  );
}
