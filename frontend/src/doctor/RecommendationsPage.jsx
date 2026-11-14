// frontend/src/doctor/RecommendationsPage.jsx
// The doctor's reading window: full guideline-based guidance for one
// condition, opened from an assessment in its own browser window so it can sit
// beside the portal (or on a second screen) and be read or printed properly.
// Route: /recommendations/:condition?ref=FH-...&score=0.70&top=thalassemia
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Printer, X, Info } from 'lucide-react';
import { api } from '../api/client';
import { CLASSES } from '../lib/contract';
import { conditionColor, conditionLabel, pct } from '../lib/format';
import { Button } from '../components/ui/button';
import { GuidanceBody, UrgencyBadge } from './Recommendations';

export default function RecommendationsPage() {
  const { condition } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [guidance, setGuidance] = useState(null);
  const [error, setError] = useState('');
  const ref = params.get('ref');
  const top = params.get('top');
  const score = params.get('score');

  useEffect(() => {
    setGuidance(null); setError('');
    if (!CLASSES.includes(condition)) { setError('No guidance for that condition.'); return; }
    let live = true;
    api.get(`/recommendations/${condition}`)
      .then((g) => { if (live) { setGuidance(g); document.title = `${conditionLabel(condition)} guidance · FedHealth`; } })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [condition]);

  const qs = params.toString();
  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur print:static">
        <div className="mx-auto flex max-w-[860px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <div className="text-base font-bold tracking-tight text-foreground">Fed<span className="text-primary">Health</span></div>
          <span className="text-sm text-muted-foreground">Clinical guidance</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="h-9 print:hidden" onClick={() => window.print()}><Printer /> Print</Button>
          <Button variant="ghost" size="sm" className="h-9 print:hidden" onClick={() => window.close()} aria-label="Close window"><X /> Close</Button>
        </div>
        <nav className="mx-auto flex max-w-[860px] gap-1.5 overflow-x-auto px-4 pb-3 sm:px-6 print:hidden" aria-label="Condition">
          {CLASSES.map((c) => (
            <button key={c} type="button" onClick={() => navigate(`/recommendations/${c}${qs ? `?${qs}` : ''}`, { replace: true })}
                    aria-current={c === condition ? 'page' : undefined} data-testid={`guidance-tab-${c}`}
                    className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                      c === condition ? 'border-transparent bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground'}`}>
              <span className="size-2 rounded-full" style={{ background: conditionColor(c) }} />
              {conditionLabel(c)}{c === top ? ' · highest score' : ''}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[860px] px-4 py-6 sm:px-6 sm:py-8">
        {error && <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
        {!guidance && !error && <p className="text-sm text-muted-foreground" role="status">Loading guidance…</p>}
        {guidance && (
          <>
            {ref && (
              <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
                <Info className="size-4 text-primary" />
                Opened from the assessment of patient <span className="font-mono text-foreground">{ref}</span>
                {top && score && <>· highest score: <span className="font-medium text-foreground">{conditionLabel(top)} {pct(Number(score))}</span></>}
              </p>
            )}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="max-w-[26ch] text-balance text-[26px] font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">{guidance.title}</h1>
              <UrgencyBadge guidance={guidance} />
            </div>
            <div className="mt-4"><GuidanceBody guidance={guidance} /></div>
          </>
        )}
      </main>
    </div>
  );
}
