// frontend/src/model-health/DataIntakeCharts.jsx
// Reports and screening results actually stored in THIS deployment's database
// (live, from /model-health/data-intake): volume over time, by ingestion source
// and by the model's highest-scoring class. Where the live data is too thin to
// chart (fewer than two days, or nothing in the window), the illustrative
// sample series is shown instead with a visible "Sample data" badge.
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { conditionLabel, conditionColor } from '../lib/format';
import SampleBadge from './SampleBadge';
import { sampleIntake } from './sampleData';

const SOURCE_LABELS = { lims: 'LIMS (lab system)', manual: 'Manual entry', ocr: 'OCR scan' };

function BreakdownBars({ rows, labelFor, colorFor }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_2fr_36px] items-center gap-2 text-xs">
          <span className="truncate text-muted-foreground">{labelFor(r)}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${Math.max(4, (r.count / max) * 100)}%`, background: colorFor?.(r) || 'var(--primary)' }} />
          </div>
          <span className="text-right font-mono tabular-nums">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

function Heading({ children, sample }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
      {children}{sample && <SampleBadge />}
    </div>
  );
}

export default function DataIntakeCharts({ intake }) {
  if (!intake) return <p className="text-sm text-muted-foreground">Loading intake data…</p>;
  const sample = sampleIntake(intake.days || 30);
  const liveReports = (intake.byDay || []).reduce((s, d) => s + d.count, 0);
  const trendIsSample = (intake.byDay || []).length < 2;
  const sourceIsSample = !(intake.bySource || []).length;
  const conditionIsSample = !(intake.byCondition || []).length;
  const byDay = (trendIsSample ? sample.byDay : intake.byDay).map((d) => ({ ...d, day: String(d.day).slice(0, 10) }));

  return (
    <div className="space-y-5" data-testid="data-intake">
      <div>
        <Heading sample={trendIsSample}>Reports ingested per day</Heading>
        {trendIsSample && (
          <p className="mb-1 text-xs text-muted-foreground">
            Live data so far: {liveReports} report{liveReports === 1 ? '' : 's'} on {(intake.byDay || []).length} day(s) in this window —
            too little for a trend, so an illustrative series is shown.
          </p>
        )}
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={byDay} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
            <defs>
              <linearGradient id="intakeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)' }} />
            <Area type="monotone" dataKey="count" name={trendIsSample ? 'Reports (sample)' : 'Reports'} stroke="var(--chart-1)" strokeWidth={2}
                  fill="url(#intakeFill)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Heading sample={sourceIsSample}>By source</Heading>
          <BreakdownBars rows={sourceIsSample ? sample.bySource : intake.bySource}
                         labelFor={(r) => SOURCE_LABELS[r.source] || r.source} />
        </div>
        <div>
          <Heading sample={conditionIsSample}>By highest-scoring class (screening, not diagnosis)</Heading>
          <BreakdownBars rows={conditionIsSample ? sample.byCondition : intake.byCondition}
                         labelFor={(r) => conditionLabel(r.condition)} colorFor={(r) => conditionColor(r.condition)} />
        </div>
      </div>
    </div>
  );
}
