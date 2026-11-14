// frontend/src/lab/LabCharts.jsx
// Presentational pieces of the Lab Node dashboard (see LabDashboard.jsx): the
// 24-hour heartbeat strip, reports-per-day chart, simple bar breakdowns, the
// federated rounds table and the activity log. All inputs are the aggregate
// shapes documented in backend/src/services/labTelemetry.js; nothing here ever
// receives a patient row.
// recharts: charting library used for the reports-per-day area chart.
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { CircleCheck, CircleAlert, CircleX, Info } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { conditionLabel, conditionColor, relativeTime } from '../lib/format';

export const STATUS_META = {
  online: { label: 'Online', icon: CircleCheck, cls: 'border-success/30 bg-success/10 text-success', dot: 'bg-success' },
  degraded: { label: 'Degraded', icon: CircleAlert, cls: 'border-warning/30 bg-warning/10 text-warning', dot: 'bg-warning' },
  offline: { label: 'Offline', icon: CircleX, cls: 'border-destructive/30 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
};

const ROUND_META = {
  aggregated: { label: 'Aggregated', cls: 'border-success/30 bg-success/10 text-success' },
  late: { label: 'Late', cls: 'border-warning/30 bg-warning/10 text-warning' },
  failed: { label: 'Failed', cls: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

const SOURCE_LABELS = { lims: 'LIMS (lab system)', manual: 'Manual entry', ocr: 'OCR scan' };

const tooltipStyle = {
  fontSize: 12, borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--popover)', color: 'var(--popover-foreground)',
};

const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// 48 half-hour slots, oldest first: green = a heartbeat arrived in that slot.
export function HeartbeatStrip({ slots }) {
  const up = slots.filter((s) => s.up).length;
  return (
    <div data-testid="heartbeat-strip">
      <div role="img" aria-label={`Heartbeat received in ${up} of ${slots.length} half-hour slots over the last 24 hours`}
           className="flex h-9 gap-px">
        {slots.map((s) => (
          <div key={s.at} title={`${clock(s.at)} · ${s.up ? 'heartbeat received' : 'no heartbeat'}`}
               className={`flex-1 rounded-[2px] ${s.up ? 'bg-success' : 'bg-destructive/70'}`} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>24 h ago</span><span>{up} of {slots.length} slots up</span><span>now</span>
      </div>
    </div>
  );
}

// Reports this lab sent per day over the last 30 days.
export function ReportsPerDayChart({ byDay }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={byDay} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
        <defs>
          <linearGradient id="labReportsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="day" tickFormatter={(d) => d.slice(5)} interval={4} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="count" name="Reports sent" stroke="var(--chart-1)" strokeWidth={2}
              fill="url(#labReportsFill)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// One horizontal bar per row, with its count and share of the total.
export function BarList({ rows, labelFor, colorFor, testId }) {
  const total = rows.reduce((s, r) => s + r.count, 0) || 1;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2" data-testid={testId}>
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,1.3fr)_1.4fr_64px] items-center gap-2 text-xs">
          <span className="text-muted-foreground">{labelFor(r)}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full"
                 style={{ width: `${Math.max(3, (r.count / max) * 100)}%`, background: colorFor?.(r) || 'var(--chart-1)' }} />
          </div>
          <span className="text-right font-mono tabular-nums">{r.count} <span className="text-muted-foreground">· {Math.round((r.count / total) * 100)}%</span></span>
        </div>
      ))}
    </div>
  );
}

export function SourceBars({ rows }) {
  return <BarList testId="source-bars" rows={rows.map((r) => ({ ...r, key: r.source }))} labelFor={(r) => SOURCE_LABELS[r.source] || r.source} />;
}

export function ConditionBars({ rows }) {
  return <BarList testId="condition-bars" rows={rows.map((r) => ({ ...r, key: r.condition }))}
                  labelFor={(r) => conditionLabel(r.condition)} colorFor={(r) => conditionColor(r.condition)} />;
}

export function FlaggedBars({ rows }) {
  return <BarList testId="flagged-bars" rows={rows.map((r) => ({ ...r, key: r.reason }))} labelFor={(r) => r.reason}
                  colorFor={() => 'var(--chart-3)'} />;
}

// Recent federated rounds this node took part in, newest first.
export function RoundsTable({ rounds, totalRounds }) {
  return (
    <Table data-testid="rounds-table">
      <TableHeader>
        <TableRow>
          <TableHead>Round</TableHead>
          <TableHead>Update sent</TableHead>
          <TableHead className="text-right">Local rows</TableHead>
          <TableHead className="text-right">Encrypted payload</TableHead>
          <TableHead className="text-right">Duration</TableHead>
          <TableHead>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rounds.map((r) => {
          const meta = ROUND_META[r.status] || ROUND_META.aggregated;
          return (
            <TableRow key={r.round}>
              <TableCell className="font-mono font-medium text-foreground">{r.round}<span className="text-muted-foreground"> / {totalRounds}</span></TableCell>
              <TableCell className="text-muted-foreground" title={new Date(r.sent_at).toLocaleString()}>{relativeTime(r.sent_at)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{r.samples.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{r.payload_kb.toLocaleString()} KB</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{r.duration_s} s</TableCell>
              <TableCell><Badge variant="outline" className={meta.cls}>{meta.label}</Badge></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

const EVENT_ICON = {
  info: { icon: Info, cls: 'text-muted-foreground' },
  warn: { icon: CircleAlert, cls: 'text-warning' },
  error: { icon: CircleX, cls: 'text-destructive' },
};

// Newest-first activity log of the node.
export function EventList({ events }) {
  return (
    <ul className="space-y-2.5" data-testid="event-list">
      {events.map((e) => {
        const { icon: Icon, cls } = EVENT_ICON[e.level] || EVENT_ICON.info;
        return (
          <li key={`${e.at}-${e.message}`} className="flex items-start gap-2 text-sm">
            <Icon className={`mt-0.5 size-4 shrink-0 ${cls}`} />
            <span className="min-w-0 flex-1 text-foreground">{e.message}</span>
            <span className="shrink-0 text-xs text-muted-foreground" title={new Date(e.at).toLocaleString()}>{relativeTime(e.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}
