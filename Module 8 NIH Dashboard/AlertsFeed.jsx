// frontend/src/surveillance/AlertsFeed.jsx
// The predictive-alerting feed (scope 6.5.2): outbreak clusters + high-risk
// cases raised by the backend. Health officials can filter by status and
// acknowledge alerts. All alert content is aggregate/anonymized.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { conditionLabel } from '../lib/format';

// Background/border/text colors per alert severity, used to tint each card.
const SEV_STYLE = {
  critical: { bg: '#FBEEEC', border: '#EEC9C3', text: '#B4453C' },
  high:     { bg: '#FBF3E4', border: '#ECD9AE', text: '#B7791F' },
  medium:   { bg: '#EAF1EF', border: '#D3E2DE', text: '#0F3A3E' },
  low:      { bg: '#F1F4F3', border: '#E0E7E5', text: '#5A6B68' },
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['open', 'acknowledged', 'resolved'].map((s) => (
          <button key={s} className={`fh-btn ${s === status ? 'fh-btn--primary' : 'fh-btn--ghost'}`}
                  style={{ padding: '5px 12px', textTransform: 'capitalize' }}
                  onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>

      {err && <p className="fh-error">{err}</p>}
      {!alerts && <p className="fh-muted">Loading alerts…</p>}
      {alerts && alerts.length === 0 && <p className="fh-muted">No {status} alerts.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {alerts?.map((a) => {
          const s = SEV_STYLE[a.severity] || SEV_STYLE.low;
          return (
            <div key={a.id} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 600, color: s.text }}>
                    {a.title}
                  </div>
                  <div className="fh-muted" style={{ fontSize: 13, marginTop: 2 }}>{a.description}</div>
                  <div className="fh-muted" style={{ fontSize: 12, marginTop: 6 }}>
                    <span className="fh-pill fh-pill--muted" style={{ marginRight: 6 }}>{a.type.replace(/_/g, ' ')}</span>
                    {a.district ? `${a.district} · ` : ''}{new Date(a.created_at).toLocaleString()}
                  </div>
                </div>
                {status === 'open' && (
                  <button className="fh-btn fh-btn--ghost" style={{ height: 34, whiteSpace: 'nowrap' }}
                          onClick={() => acknowledge(a.id)}>Acknowledge</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
