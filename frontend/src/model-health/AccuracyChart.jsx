// frontend/src/model-health/AccuracyChart.jsx
// Model accuracy + loss over federated training rounds. Two y-axes since the
// series are on different scales (accuracy 0-1 vs. loss, which starts >1 and
// decays). Falls back to plotting against ml_models version history (dated
// points, no round number) when no FL round history has been imported yet —
// see ModelHealth.accuracyHistory() on the backend for the exact fallback.
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

export default function AccuracyChart({ history }) {
  const points = history?.points || [];
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No training history yet.</p>;
  }

  const byRound = history.source === 'fl_rounds';
  const data = points.map((p) => ({
    label: byRound ? `R${p.round_number}` : (p.created_at || '').slice(0, 10),
    accuracy: p.accuracy != null ? +(p.accuracy * 100).toFixed(1) : null,
    loss: p.loss != null ? +p.loss.toFixed(3) : null,
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
          <YAxis yAxisId="acc" domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                 label={{ value: 'accuracy %', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
          <YAxis yAxisId="loss" orientation="right" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                 label={{ value: 'loss', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="acc" type="monotone" dataKey="accuracy" name="Accuracy %" stroke="var(--chart-1)" strokeWidth={2}
                dot={{ r: 3, fill: 'var(--chart-1)' }} isAnimationActive={false} connectNulls />
          <Line yAxisId="loss" type="monotone" dataKey="loss" name="Loss" stroke="var(--chart-4)" strokeWidth={2}
                dot={{ r: 3, fill: 'var(--chart-4)' }} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      {!byRound && (
        <p className="mt-1 text-xs text-muted-foreground">
          Showing model version history — run the FL history importer for round-by-round detail.
        </p>
      )}
    </div>
  );
}
