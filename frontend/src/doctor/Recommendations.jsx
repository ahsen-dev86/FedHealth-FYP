// frontend/src/doctor/Recommendations.jsx
// Guideline-based next steps for the condition with the highest screening
// score. Two exports:
//   RecommendationsCard  the short version inside the assessment card, with a
//                        button that opens the full guidance in its own window
//   GuidanceBody         the full text (used by RecommendationsPage)
// Content comes from the API (services/guidance.js): summaries of WHO, TIF,
// NICE and ELN guidance with every item citing its source. Decision support
// only; the doctor decides.
import { ExternalLink, FlaskConical, ListChecks, TriangleAlert, BookOpenText, Maximize2 } from 'lucide-react';
import { Button } from '../components/ui/button';

const URGENCY = {
  routine: 'border-success/40 bg-success/10 text-success',
  soon: 'border-warning/50 bg-warning/10 text-warning',
  urgent: 'border-destructive/40 bg-destructive/10 text-destructive',
};

export function UrgencyBadge({ guidance }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${URGENCY[guidance.urgency] || URGENCY.soon}`}
          data-testid="guidance-urgency">
      {guidance.urgencyLabel}
    </span>
  );
}

// Superscript citation markers for an item, numbered by the guidance's source list.
function Cites({ ids, sources }) {
  const nums = (ids || []).map((id) => sources.findIndex((s) => s.id === id) + 1).filter((n) => n > 0);
  if (!nums.length) return null;
  return <sup className="ml-0.5 font-mono text-[10px] text-primary">[{nums.join(',')}]</sup>;
}

/** Open the full guidance in a separate, resizable window (falls back to a new tab). */
export function openGuidanceWindow(condition, context = {}) {
  const qs = new URLSearchParams(Object.entries(context).filter(([, v]) => v != null && v !== ''));
  const url = `/recommendations/${condition}${qs.toString() ? `?${qs}` : ''}`;
  const w = Math.min(1040, window.screen.availWidth - 40);
  const h = Math.min(900, window.screen.availHeight - 60);
  const win = window.open(url, 'fedhealth-guidance', `popup=yes,width=${w},height=${h},left=${Math.max(0, window.screen.availWidth - w - 20)},top=20,resizable=yes,scrollbars=yes`);
  if (win) win.focus(); else window.open(url, '_blank', 'noopener');
}

export function RecommendationsCard({ guidance, context }) {
  if (!guidance?.confirmatoryTests) return null;
  return (
    <section className="mt-4 rounded-xl border border-border bg-muted/30 p-3.5 sm:p-4" data-testid="recommendations-card" aria-label="Recommended next steps">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Recommended next steps</div>
          <h4 className="mt-1 text-sm font-semibold text-foreground">{guidance.title}</h4>
        </div>
        <UrgencyBadge guidance={guidance} />
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {guidance.confirmatoryTests.slice(0, 3).map((t) => (
          <li key={t.test} className="flex gap-2 text-sm text-foreground">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>{t.test}</span>
          </li>
        ))}
      </ul>
      {guidance.confirmatoryTests.length > 3 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          + {guidance.confirmatoryTests.length - 3} more tests and {guidance.management.length} management points in the full guidance.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" className="h-9" onClick={() => openGuidanceWindow(guidance.condition, context)} data-testid="open-guidance">
          <Maximize2 /> Open full guidance in a separate window
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Sources: {[...new Set(guidance.sources.map((s) => s.org.replace(/ \(.*\)$/, '')))].join(', ')}
        </span>
      </div>
    </section>
  );
}

export function GuidanceBody({ guidance }) {
  const { sources } = guidance;
  return (
    <div data-testid="guidance-body">
      <p className="text-base leading-relaxed text-foreground">{guidance.summary}</p>

      <h2 className="mt-8 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <FlaskConical className="size-5 text-primary" /> Tests to confirm or exclude
      </h2>
      <ol className="mt-3 space-y-3">
        {guidance.confirmatoryTests.map((t, i) => (
          <li key={t.test} className="flex gap-3 rounded-xl border border-border bg-card p-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{i + 1}</span>
            <div>
              <h3 className="text-base font-semibold leading-snug text-foreground">{t.test}<Cites ids={t.sources} sources={sources} /></h3>
              <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{t.why}</p>
            </div>
          </li>
        ))}
      </ol>

      <h2 className="mt-8 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <ListChecks className="size-5 text-primary" /> Management principles
      </h2>
      <ol className="mt-3 space-y-3">
        {guidance.management.map((m, i) => (
          <li key={m.step} className="flex gap-3 rounded-xl border border-border bg-card p-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">{i + 1}</span>
            <div>
              <h3 className="text-base font-semibold leading-snug text-foreground">{m.step}<Cites ids={m.sources} sources={sources} /></h3>
              <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{m.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {guidance.redFlags?.length > 0 && (
        <>
          <h2 className="mt-8 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <TriangleAlert className="size-5 text-destructive" /> Red flags: act sooner
          </h2>
          <ul className="mt-3 space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            {guidance.redFlags.map((f) => (
              <li key={f} className="flex gap-2 text-[15px] leading-relaxed text-foreground">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive" />{f}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        <BookOpenText className="size-5 text-primary" /> Sources
      </h2>
      <ol className="mt-3 space-y-2">
        {sources.map((s, i) => (
          <li key={s.id} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
            <span className="font-mono text-primary">[{i + 1}]</span>
            <span>
              {s.org}. <span className="text-foreground">{s.title}</span> ({s.year}).{' '}
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all font-medium text-primary underline-offset-2 hover:underline">
                Open source <ExternalLink className="size-3" />
              </a>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-6 rounded-xl bg-muted p-4 text-sm leading-relaxed text-muted-foreground">
        {guidance.disclaimer} {guidance.reviewNote} <span className="whitespace-nowrap">Guidance version {guidance.version}.</span>
      </p>
    </div>
  );
}
