// frontend/src/model-health/NodeContributionChart.jsx
// How much data each node contributed over the selected time span, stacked
// per day so both the daily total and each node's share are readable.
import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

export default function NodeContributionChart({ rows }) {
  const { data, nodeNames } = useMemo(() => {
    if (!rows) return { data: [], nodeNames: [] };
    const names = [...new Set(rows.map((r) => r.name))];
    const byDay = new Map();
    for (const r of rows) {
      if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day });
      byDay.get(r.day)[r.name] = r.count;
    }
    return {
      data: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      nodeNames: names,
    };
  }, [rows]);

  if (!rows) return <p className="text-sm text-muted-foreground">Loading contribution data…</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No lab activity in this window.</p>;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {nodeNames.map((name, i) => (
          <Bar key={name} dataKey={name} stackId="nodes" fill={PALETTE[i % PALETTE.length]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
