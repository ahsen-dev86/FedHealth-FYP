// frontend/src/components/TrendChart.jsx
// Longitudinal tracking (scope 6.2.2): plots a chosen CBC index across a
// patient's visits so the doctor can see trajectories (e.g. falling platelets
// or hemoglobin). Uses recharts.
//
// LIBRARY NOTE: recharts is an addition to the fixed stack (a React charting
// lib). Flagged as a minor dependency choice; hand-rolled SVG was the
// alternative but recharts is standard and defensible.
import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { CBC_FIELDS } from '../lib/format';
import { Button } from './ui/button';

// Sensible defaults to plot; the doctor can switch the index.
const PLOTTABLE = ['HGB', 'PLT', 'MCV', 'WBC', 'RBC', 'MCH'];

export default function TrendChart({ reports }) {
  const [metric, setMetric] = useState('HGB');
  const unit = CBC_FIELDS.find((f) => f.key === metric)?.unit || '';

  // reports are oldest-first from the API; map to chart points.
  const data = (reports || [])
    .map((r) => ({
      date: (r.collected_at || r.created_at || '').slice(0, 10),
      value: r.cbc?.[metric] != null ? Number(r.cbc[metric]) : null,
    }))
    .filter((p) => p.value != null);

  if (data.length < 2) {
    return <p className="text-sm text-muted-foreground">Need at least two visits with a {metric} value to show a trend.</p>;
  }

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {PLOTTABLE.map((m) => (
          <Button key={m} type="button" size="sm" variant={m === metric ? 'default' : 'outline'}
                  className="font-mono" onClick={() => setMetric(m)}>
            {m}
          </Button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                 label={{ value: unit, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)' }} />
          <Line type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2}
                dot={{ r: 3, fill: 'var(--chart-1)' }} isAnimationActive={false} name={metric} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
