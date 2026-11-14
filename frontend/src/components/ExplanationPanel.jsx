// frontend/src/components/ExplanationPanel.jsx
// Explainable AI for one screening result, in two clearly separated parts:
//
//   "Why this score"   how much each measured CBC value moved the selected
//                      class score (exact Shapley values from the model), drawn
//                      as a diverging bar per value: right = raised the score,
//                      left = lowered it. The bars add up to the score minus
//                      the score of a reference record at the training medians.
//   "What each value tells us"   each value against a typical adult reference
//                      interval with its textbook meaning. No model involved.
//
// Data: result.explanation from POST /predict (backend services/explain.js).
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Info, Minus } from 'lucide-react';
import { CLASSES } from '../lib/contract';
import { conditionColor, conditionLabel, pct1 } from '../lib/format';
import { Badge } from './ui/badge';

const SHORT = { NEUTp: 'NEUT%', RDW: 'RDW-CV' };
const STATUS = {
  low: { label: 'Low', cls: 'border-warning/50 bg-warning/10 text-warning', Icon: ArrowDown },
  high: { label: 'High', cls: 'border-destructive/40 bg-destructive/10 text-destructive', Icon: ArrowUp },
  normal: { label: 'In range', cls: 'border-success/40 bg-success/10 text-success', Icon: Minus },
  not_measured: { label: 'Not measured', cls: 'border-border bg-muted text-muted-foreground', Icon: Minus },
};

// Signed probability points, e.g. +12.3 / −4.0 (true minus sign for alignment).
function points(x) {
  const v = (x * 100).toFixed(1);
  if (Number(v) === 0) return '0.0';
  return x > 0 ? `+${v}` : `−${Math.abs(x * 100).toFixed(1)}`;
}

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));

// Where a value sits relative to its reference interval: the interval occupies
// the middle half of the track, so low and high values have room on each side.
function GaugeTrack({ value, low, high, status }) {
  const span = high - low || 1;
  const pos = Math.min(100, Math.max(0, 25 + ((value - low) / span) * 50));
  const color = status === 'normal' ? 'var(--success)' : status === 'low' ? 'var(--warning)' : 'var(--destructive)';
  return (
    <div className="relative h-2 w-full rounded-full bg-muted" aria-hidden="true">
      <div className="absolute inset-y-0 left-1/4 w-1/2 rounded-full bg-success/25" />
      <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow"
           style={{ left: `${pos}%`, background: color }} />
    </div>
  );
}

function Attribution({ explanation, scores }) {
  const top = explanation.attribution.targetClass;
  const [cls, setCls] = useState(top);
  const rows = useMemo(() => explanation.features
    .filter((f) => f.measured && f.contributions)
    .map((f) => ({ ...f, c: f.contributions[cls] ?? 0 }))
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c)), [explanation, cls]);
  const max = Math.max(0.01, ...rows.map((r) => Math.abs(r.c)));
  const base = explanation.attribution.baselineScores?.[cls] ?? 0;
  const score = scores?.[cls] ?? 0;
  const color = conditionColor(cls);
  const up = rows.filter((r) => r.c > 0.005).slice(0, 3);
  const down = rows.filter((r) => r.c < -0.005).slice(0, 2);

  return (
    <div data-testid="xai-attribution">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Explain the score for">
        {CLASSES.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={c === cls} onClick={() => setCls(c)}
                  data-testid={`xai-class-${c}`}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
                    c === cls ? 'border-transparent bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}>
            <span className="size-2 rounded-full" style={{ background: conditionColor(c) }} />
            {conditionLabel(c)}
            <span className="font-mono opacity-80">{pct1(scores?.[c])}</span>
          </button>
        ))}
      </div>

      {/* Plain-language reading of the bars below. */}
      <p className="mt-3 text-sm text-foreground" data-testid="xai-summary">
        {up.length > 0
          ? <>The <strong className="font-semibold">{conditionLabel(cls)}</strong> score is driven up mostly by{' '}
              {up.map((r, i) => <span key={r.feature}>{i > 0 && (i === up.length - 1 ? ' and ' : ', ')}<strong className="font-semibold">{SHORT[r.feature] || r.feature}</strong> ({STATUS[r.status].label.toLowerCase()})</span>)}
              {down.length > 0 && <>; {down.map((r) => SHORT[r.feature] || r.feature).join(' and ')} pull{down.length === 1 ? 's' : ''} it down</>}.</>
          : <>No measured value pushes the <strong className="font-semibold">{conditionLabel(cls)}</strong> score up for this report.</>}
      </p>

      <div className="mt-3 rounded-lg border border-border">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
          <span>Reference record (training medians)</span>
          <span className="font-mono text-foreground">{pct1(base)}</span>
        </div>
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const w = (Math.abs(r.c) / max) * 50;
            return (
              <li key={r.feature} className="grid grid-cols-[84px_1fr_52px] items-center gap-2 px-3 py-1.5 sm:grid-cols-[110px_1fr_56px]" data-testid={`xai-row-${r.feature}`}>
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs font-medium text-foreground">{SHORT[r.feature] || r.feature}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{fmt(r.value)} {r.unit}</div>
                </div>
                <div className="relative h-4" role="img"
                     aria-label={`${r.label}: ${r.c >= 0 ? 'raises' : 'lowers'} the score by ${Math.abs(r.c * 100).toFixed(1)} points`}>
                  <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  <div className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm transition-all duration-500"
                       style={r.c >= 0
                         ? { left: '50%', width: `${w}%`, background: color }
                         : { right: '50%', width: `${w}%`, background: 'var(--muted-foreground)', opacity: 0.55 }} />
                </div>
                <div className={`text-right font-mono text-xs ${r.c > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>{points(r.c)}</div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-2 text-xs font-medium text-foreground">
          <span>{conditionLabel(cls)} score for this report</span>
          <span className="font-mono">{pct1(score)}</span>
        </div>
      </div>
      <p className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>← lowers the score</span><span>points of confidence</span><span>raises the score →</span>
      </p>

      <details className="group mt-2 text-xs text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-primary outline-none focus-visible:underline">
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /> How this is calculated
        </summary>
        <p className="mt-1.5 leading-relaxed">
          {explanation.attribution.note} Computed from {explanation.attribution.modelEvaluations?.toLocaleString()} model
          evaluations in {explanation.attribution.ms} ms (method: exact Shapley values, median baseline).
        </p>
      </details>
    </div>
  );
}

function Readings({ explanation }) {
  const [open, setOpen] = useState(null);
  return (
    <div data-testid="xai-readings">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {explanation.features.map((f) => {
          const s = STATUS[f.status];
          const expanded = open === f.feature;
          return (
            <li key={f.feature}>
              <button type="button" onClick={() => setOpen(expanded ? null : f.feature)} aria-expanded={expanded}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/60 sm:grid-cols-[150px_1fr_auto]">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{f.label}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {f.measured ? <>{fmt(f.value)} {f.unit}</> : 'not on this report'}
                  </div>
                </div>
                <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                  {f.measured
                    ? <GaugeTrack value={f.value} low={f.reference.low} high={f.reference.high} status={f.status} />
                    : <div className="h-2 rounded-full bg-muted" />}
                  <div className="mt-1 text-[11px] text-muted-foreground">Reference {fmt(f.reference.low)}–{fmt(f.reference.high)} {f.unit}</div>
                </div>
                <span className={`col-start-2 row-start-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium sm:col-start-3 ${s.cls}`}>
                  <s.Icon className="size-3" />{s.label}
                </span>
              </button>
              {expanded && (
                <div className="space-y-1 bg-muted/30 px-3 pb-3 pt-1 text-xs leading-relaxed text-muted-foreground">
                  <p>{f.about}</p>
                  <p className="text-foreground">{f.meaning}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {explanation.referenceNote}
        {explanation.sexUsedForReference ? ` Sex-specific intervals used (${explanation.sexUsedForReference === 'F' ? 'female' : 'male'}).` : ''}{' '}
        Tap a row for what the value means.
      </p>
    </div>
  );
}

export default function ExplanationPanel({ explanation, scores }) {
  const [tab, setTab] = useState('why');
  if (!explanation?.features?.length) return null;
  const abnormal = explanation.abnormal?.length || 0;
  return (
    <section className="mt-4" data-testid="explanation-panel" aria-label="Explanation of this result">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Explanation</div>
        <Badge variant="outline" className="gap-1 text-[11px] font-normal text-muted-foreground"><Info className="size-3" />Explains the model, not the patient</Badge>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
        {[['why', 'Why this score'], ['values', `What each value tells us${abnormal ? ` (${abnormal} out of range)` : ''}`]].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`xai-tab-${key}`}
                  className={`min-h-9 rounded-md px-2 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm ${
                    tab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'why' && (explanation.available
        ? <Attribution explanation={explanation} scores={scores} />
        : <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground" data-testid="xai-unavailable">
            The model's per-value attribution is not available for this result ({explanation.unavailableReason}).
            The value readings are still shown in the other tab.
          </p>)}
      {tab === 'values' && <Readings explanation={explanation} />}
    </section>
  );
}
