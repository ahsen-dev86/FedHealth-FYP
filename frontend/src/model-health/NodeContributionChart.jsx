// frontend/src/model-health/NodeContributionChart.jsx
// How many training rows each simulated lab held in each federated run (real,
// from settings.train_rows). IID splits are even; the non-IID and by-source
// splits show the skew the federation had to cope with (e.g. a lab with 2 rows).
import { useMemo } from 'react';
// recharts: charting library used for the stacked bar-per-run chart below.
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

export default function NodeContributionChart({ rows }) {
  const { data, labs, total } = useMemo(() => {
    if (!rows) return { data: [], labs: [], total: null };
    const labIds = [...new Set(rows.map((r) => r.lab_id))].sort();
    // Pivot the flat rows into one object per run, with each lab's row count
    // as its own key, so recharts can stack one bar segment per lab.
    const byRun = new Map();
    for (const r of rows) {
      if (!byRun.has(r.run_id)) {
        const enc = r.encryption === 'paillier' ? ' (P)' : '';
        byRun.set(r.run_id, { run: `s${r.seed} ${r.scenario}${enc}` });
      }
      byRun.get(r.run_id)[r.lab_id] = r.train_rows;
    }
    // Total training rows per run; only surfaced when every run used the same
    // total (otherwise the per-run totals differ and a single number would mislead).
    const totals = [...byRun.values()].map((d) => labIds.reduce((sum, lab) => sum + (d[lab] || 0), 0));
    return { data: [...byRun.values()], labs: labIds, total: new Set(totals).size === 1 ? totals[0] : null };
  }, [rows]);

  if (!rows) return <p className="text-sm text-muted-foreground">Loading contribution data…</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No federated run has been imported yet.</p>;

  return (
    <div data-testid="node-contribution">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 36, left: -4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="run" interval={0} angle={-35} textAnchor="end" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                 label={{ value: 'training rows', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)' }} />
          <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
          {labs.map((lab, i) => (
            <Bar key={lab} dataKey={lab} stackId="labs" fill={PALETTE[i % PALETTE.length]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground">
        s = seed; (P) = Paillier-encrypted run.{total != null && ` Every run split the same ${total.toLocaleString()} training rows across its labs.`}
      </p>
    </div>
  );
}
