// frontend/src/components/TrendChart.jsx
// Longitudinal tracking (scope 6.2.2): plots one of the 10 CBC values across a
// patient's visits so the doctor can see trajectories (e.g. falling platelets
// or hemoglobin). Reports store canonical values, so every visit is on the same
// unit regardless of how the paper report printed it. Uses recharts.
import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { CBC_FIELDS } from '../lib/format';
import { Button } from './ui/button';

// Line chart of one selected CBC field across a patient's visit history, with
// a button row to switch which field is plotted.
export default function TrendChart({ reports }) {
  const [metric, setMetric] = useState('HGB'); // which CBC field is currently plotted
  const field = CBC_FIELDS.find((f) => f.key === metric);

  // reports are oldest-first from the API; map to chart points.
  const data = (reports || [])
    .map((r) => ({
      date: (r.collected_at || r.created_at || '').slice(0, 10),
      value: r.cbc?.[metric] != null ? Number(r.cbc[metric]) : null,
    }))
    .filter((p) => p.value != null);

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {CBC_FIELDS.map((f) => (
          <Button key={f.key} type="button" size="sm" variant={f.key === metric ? 'default' : 'outline'}
                  className="font-mono" onClick={() => setMetric(f.key)}>
            {f.label}
          </Button>
        ))}
      </div>
      {data.length < 2 ? (
        <p className="text-sm text-muted-foreground">Need at least two visits with a {field.label} value to show a trend.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} domain={['auto', 'auto']}
                   label={{ value: field.canonicalUnit, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)' }}
                     formatter={(v) => [`${v} ${field.canonicalUnit}`, field.label]} />
            <Line type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2}
                  dot={{ r: 3, fill: 'var(--chart-1)' }} isAnimationActive={false} name={field.label} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
