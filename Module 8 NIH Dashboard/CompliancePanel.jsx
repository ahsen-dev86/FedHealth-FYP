// frontend/src/surveillance/CompliancePanel.jsx
// Regulatory oversight (PDPB 2023). Verifies the immutable audit log's hash
// chain and shows the most recent entries. The "verified" badge is backed by the
// backend recomputing the whole SHA-256 chain (GET /audit/verify).
import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Renders the audit-chain integrity badge plus a table of recent audit entries.
export default function CompliancePanel() {
  const [chain, setChain] = useState(null);
  const [log, setLog] = useState(null);
  const [err, setErr] = useState('');

  // Two independent fetches on mount: chain verification result, and the
  // most recent log rows to display below it.
  useEffect(() => {
    api.get('/audit/verify').then(setChain).catch((e) => { setChain({ ok: false }); setErr(e.message); });
    api.get('/audit?limit=50').then(setLog).catch(() => setLog([]));
  }, []);

  const ok = chain?.ok;

  return (
    <div>
      <div className="fh-flag" style={{
        background: ok ? '#EAF6EF' : '#FBEEEC',
        border: `1px solid ${ok ? '#C4E6D2' : '#EEC9C3'}`, marginBottom: 16 }}>
        <div>
          <div className="fh-flag__title" style={{ color: ok ? 'var(--ok)' : 'var(--risk)' }}>
            {chain == null ? 'Verifying audit chain…'
              : ok ? 'Audit chain verified — tamper-evident and intact'
                   : `Audit chain BROKEN at entry ${chain.broken_at ?? '?'}`}
          </div>
          <div className="fh-flag__body">
            Each log entry is hash-chained to the previous one; any edit or deletion
            breaks every later hash and is detected here.
          </div>
        </div>
      </div>

      {err && <p className="fh-error">{err}</p>}

      <div className="fh-eyebrow" style={{ marginBottom: 8 }}>Recent activity</div>
      {!log && <p className="fh-muted">Loading log…</p>}
      {log && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--ink-soft)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Time</th>
                <th style={{ padding: '6px 8px' }}>Actor role</th>
                <th style={{ padding: '6px 8px' }}>Action</th>
                <th style={{ padding: '6px 8px' }}>Resource</th>
              </tr>
            </thead>
            <tbody>
              {log.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--line-soft)' }}>
                  <td className="fh-num" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {new Date(e.ts).toLocaleString()}
                  </td>
                  <td style={{ padding: '6px 8px' }}>{e.actor_role || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{e.action}</td>
                  <td style={{ padding: '6px 8px' }}>{e.resource_type || ''} {e.resource_id || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
