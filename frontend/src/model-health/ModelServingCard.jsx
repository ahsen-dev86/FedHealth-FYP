// frontend/src/model-health/ModelServingCard.jsx
// Primary / backup model availability (GET /model-health/serving): which model
// is answering predictions right now, whether each path is up, the version and
// measured test accuracy of each model, and how often the backup actually
// served in the selected window. Shown on Model Health (read-only) and in the
// Admin Console, which passes `onDrill` to add the failover-drill switch.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ServerCog, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { api } from '../api/client';
import { pct1, relativeTime } from '../lib/format';
import { Button } from '../components/ui/button';

const STATE = {
  primary: { Icon: ShieldCheck, cls: 'border-success/40 bg-success/5', title: 'Primary model is serving',
    text: 'Predictions are answered by the primary model; the backup is standing by.' },
  backup: { Icon: ShieldAlert, cls: 'border-warning/50 bg-warning/5', title: 'Backup model is serving',
    text: 'The primary model is unavailable, so predictions are answered by the backup and labelled as such.' },
  none: { Icon: ShieldX, cls: 'border-destructive/40 bg-destructive/5', title: 'No model can serve',
    text: 'Neither model is reachable. Predictions will fail until one is restored.' },
};

function Pill({ ok, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
      ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
      <span className={`size-1.5 rounded-full ${ok ? 'bg-success' : 'bg-destructive'}`} />{children}
    </span>
  );
}

function ModelRow({ role, info, children }) {
  return (
    <div className="rounded-lg border border-border p-3" data-testid={`serving-${role}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{role === 'primary' ? 'Primary model' : 'Backup model'}</div>
        <div className="flex flex-wrap gap-1.5">{children}</div>
      </div>
      <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{info.version || 'not configured'}</div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        {info.testAccuracy != null
          ? <>Test accuracy <span className="font-medium text-foreground">{pct1(info.testAccuracy)}</span>
              {info.macroF1 != null && <> · macro-F1 <span className="font-medium text-foreground">{pct1(info.macroF1)}</span></>}</>
          : info.version ? 'No measured test metrics registered for this version.' : null}
        {info.reason && <div className="mt-0.5 text-destructive">{info.reason}</div>}
      </div>
    </div>
  );
}

export default function ModelServingCard({ days = 30, onDrill }) {
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr('');
    return api.get(`/model-health/serving?days=${days}`).then(setStatus).catch((e) => setErr(e.message));
  }, [days]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // keep availability current while the page is open
    return () => clearInterval(t);
  }, [load]);

  async function drill() {
    setBusy(true); setErr('');
    try { await onDrill(!status.drillActive); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const s = status && (STATE[status.serving] || STATE.none);
  const b = status?.backup;
  return (
    <div data-testid="model-serving">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ServerCog className="size-4 text-primary" />
          {status ? `Checked ${relativeTime(status.checkedAt)} · refreshes every 30 s` : 'Checking…'}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={load} aria-label="Refresh serving status"><RefreshCw /></Button>
      </div>

      {status && (
        <>
          <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 ${s.cls}`} data-testid="serving-state">
            <s.Icon className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 text-sm">
              <div className="font-medium text-foreground">{s.title}{status.drillActive ? ' (failover drill)' : ''}</div>
              <div className="text-muted-foreground">{s.text}</div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <ModelRow role="primary" info={status.primary}>
              <Pill ok={status.primary.available && !status.drillActive}>
                {status.primary.available ? (status.drillActive ? 'Marked down (drill)' : 'Available') : 'Unavailable'}
              </Pill>
            </ModelRow>
            <ModelRow role="backup" info={b.configured ? b : { version: null }}>
              {!b.configured && <Pill ok={false}>Not configured</Pill>}
              {b.inProcess && <Pill ok={b.inProcess.available}>Beside primary: {b.inProcess.available ? 'ready' : 'down'}</Pill>}
              {b.replica && <Pill ok={b.replica.available}>Separate replica: {b.replica.available ? 'ready' : 'down'}</Pill>}
            </ModelRow>
          </div>

          <dl className="mt-3 grid grid-cols-3 gap-2 text-center" data-testid="serving-usage">
            <div className="rounded-lg bg-muted/50 px-2 py-2">
              <dd className="text-lg font-semibold tabular-nums text-foreground">{status.usage.predictions}</dd>
              <dt className="text-[11px] text-muted-foreground">predictions, last {status.usage.days} d</dt>
            </div>
            <div className="rounded-lg bg-muted/50 px-2 py-2">
              <dd className="text-lg font-semibold tabular-nums text-foreground">{status.usage.servedByBackup}</dd>
              <dt className="text-[11px] text-muted-foreground">served by the backup</dt>
            </div>
            <div className="rounded-lg bg-muted/50 px-2 py-2">
              <dd className="text-lg font-semibold tabular-nums text-foreground">
                {status.usage.predictions ? pct1(1 - status.usage.servedByBackup / status.usage.predictions) : '—'}
              </dd>
              <dt className="text-[11px] text-muted-foreground">answered by primary</dt>
            </div>
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {status.usage.lastServedByBackupAt
              ? `The backup last answered a prediction ${relativeTime(status.usage.lastServedByBackupAt)}.`
              : 'The backup has not had to answer a prediction in this window.'}
            {status.breaker.lastPrimaryFaultAt ? ` Last primary fault ${relativeTime(status.breaker.lastPrimaryFaultAt)}.` : ''}
            {' '}The backup is an independently trained model for the same four conditions.
          </p>

          {onDrill && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button variant={status.drillActive ? 'default' : 'outline'} className="h-9" onClick={drill}
                      disabled={busy || !status.primary.reachable || (!status.drillActive && !b.inProcess?.available)}
                      data-testid="failover-drill">
                {busy ? 'Working…' : status.drillActive ? 'End drill: restore primary' : 'Run failover drill'}
              </Button>
              <span className="text-[11px] text-muted-foreground">Marks the primary as down so you can see predictions continue on the backup.</span>
            </div>
          )}
        </>
      )}
      {err && <p className="mt-2 text-sm text-destructive" role="alert">{err}</p>}
    </div>
  );
}
