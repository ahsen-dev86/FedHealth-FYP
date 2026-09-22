// frontend/src/model-health/DataIntakeCharts.jsx
// How much data is coming in, and what kind: volume over time, then two
// breakdowns (by ingestion source, by predicted condition — the "nature" of
// the incoming data). Breakdowns use horizontal bar lists rather than pies:
// byCondition can run to 7+ categories, past where a pie stays legible.
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { conditionLabel } from '../lib/format';

const SOURCE_LABELS = { lims: 'LIMS (lab system)', manual: 'Manual entry', ocr: 'OCR scan' };

function BreakdownBars({ rows, labelFor }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_2fr_36px] items-center gap-2 text-xs">
          <span className="truncate text-muted-foreground">{labelFor(r)}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} />
          </div>
          <span className="text-right font-mono tabular-nums">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

export default function DataIntakeCharts({ intake }) {
  if (!intake) return <p className="text-sm text-muted-foreground">Loading intake data…</p>;
  const { byDay, bySource, byCondition } = intake;

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Reports ingested per day</div>
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
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)' }} />
            <Area type="monotone" dataKey="count" name="Reports" stroke="var(--chart-1)" strokeWidth={2}
                  fill="url(#intakeFill)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">By source</div>
          <BreakdownBars rows={bySource} labelFor={(r) => SOURCE_LABELS[r.source] || r.source} />
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">By predicted condition</div>
          <BreakdownBars rows={byCondition} labelFor={(r) => conditionLabel(r.condition)} />
        </div>
      </div>
    </div>
  );
}
