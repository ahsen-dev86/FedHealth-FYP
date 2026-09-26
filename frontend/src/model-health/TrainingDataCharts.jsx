// frontend/src/model-health/TrainingDataCharts.jsx
// What the active model was trained and tested on (real counts from
// Dataset/fedhealth_cbc_4class_provenance.csv, stored at registration): rows per
// class in each split, and rows per public source and class. The source mix is
// why unseen-source accuracy is low: several classes come from one source only.
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { CLASSES } from '../lib/contract';
import { conditionLabel, conditionColor } from '../lib/format';

const TOOLTIP = { fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)' };

function StackedByClass({ rows, xKey, height = 220 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
        <Tooltip contentStyle={TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {CLASSES.map((c) => (
          <Bar key={c} dataKey={c} name={conditionLabel(c)} stackId="cls" fill={conditionColor(c)} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function TrainingDataCharts({ data }) {
  if (!data) return <p className="text-sm text-muted-foreground">Loading training data…</p>;
  const splits = ['train', 'val', 'test']
    .filter((s) => data.by_split_class?.[s])
    .map((s) => ({ split: s, ...data.by_split_class[s] }));
  const sources = Object.entries(data.by_source_class || {})
    .map(([source, counts]) => ({ source, ...counts }))
    .sort((a, b) => b.source.localeCompare(a.source));

  return (
    <div className="space-y-4" data-testid="training-data">
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Rows per class and split</div>
          <StackedByClass rows={splits} xKey="split" />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Rows per public source and class</div>
          <StackedByClass rows={sources} xKey="source" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {data.rows?.toLocaleString()} rows; {data.rows_with_imputed_values?.toLocaleString()} contain values borrowed upstream
        (before the split); labels: {Object.entries(data.by_label_basis || {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ')}.
        Source: <span className="font-mono">{data.source_file}</span>.
      </p>
    </div>
  );
}
