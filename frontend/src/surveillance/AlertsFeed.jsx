// frontend/src/surveillance/AlertsFeed.jsx
// The predictive-alerting feed (scope 6.5.2): outbreak clusters + high-risk
// cases raised by the backend. Health officials can filter by status and
// acknowledge alerts. All alert content is aggregate/anonymized. A high-risk
// case alert means the leukemia screening score crossed the demo threshold;
// it is a screening flag, not a diagnosis.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { conditionLabel, conditionColor } from '../lib/format';

// Tailwind classes per alert severity: card background/border, then text color.
const SEV_VARIANT = {
  critical: 'border-destructive/30 bg-destructive/10',
  high: 'border-warning/30 bg-warning/10',
  medium: 'border-border bg-muted/50',
  low: 'border-border bg-muted/30',
};
const SEV_TEXT = {
  critical: 'text-destructive',
  high: 'text-warning',
  medium: 'text-foreground',
  low: 'text-muted-foreground',
};

// Renders the status-filtered alert list and lets officials acknowledge open alerts.
export default function AlertsFeed({ onData }) {
  const [alerts, setAlerts] = useState(null);
  const [status, setStatus] = useState('open');
  const [err, setErr] = useState('');

  // Fetch alerts for the currently selected status and report them to the
  // parent (used to show an open-alert count badge on the tab).
  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await api.get(`/nih/alerts?status=${status}`);
      setAlerts(r);
      onData?.(r);
    } catch (e) { setErr(e.message); }
  }, [status, onData]);

  useEffect(() => { load(); }, [load]);

  // Mark an alert acknowledged on the backend, then reload the list.
  async function acknowledge(id) {
    try { await api.post(`/nih/alerts/${id}/ack`, {}); await load(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {['open', 'acknowledged', 'resolved'].map((s) => (
          <Button key={s} size="sm" variant={s === status ? 'default' : 'outline'}
                  className="capitalize" onClick={() => setStatus(s)}>{s}</Button>
        ))}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {!alerts && <p className="text-sm text-muted-foreground">Loading alerts…</p>}
      {alerts && alerts.length === 0 && <p className="text-sm text-muted-foreground">No {status} alerts.</p>}

      <div className="flex flex-col gap-2.5">
        {alerts?.map((a) => (
          <div key={a.id} className={`rounded-lg border px-3.5 py-3 ${SEV_VARIANT[a.severity] || SEV_VARIANT.low}`}>
            <div className="flex justify-between gap-2.5">
              <div className="min-w-0">
                <div className={`font-semibold ${SEV_TEXT[a.severity] || SEV_TEXT.low}`}>{a.title}</div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">{a.description}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline" className="capitalize">{a.type.replace(/_/g, ' ')}</Badge>
                  {/* Condition badge: colored dot + label, only when the alert names a condition */}
                  {a.condition && (
                    <Badge variant="outline" className="gap-1">
                      <span className="size-2 rounded-full" style={{ background: conditionColor(a.condition) }} />
                      {conditionLabel(a.condition)}
                    </Badge>
                  )}
                  {a.district ? `${a.district} · ` : ''}{new Date(a.created_at).toLocaleString()}
                </div>
              </div>
              {status === 'open' && (
                <Button variant="outline" size="sm" className="h-fit shrink-0 whitespace-nowrap"
                        onClick={() => acknowledge(a.id)}>Acknowledge</Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
