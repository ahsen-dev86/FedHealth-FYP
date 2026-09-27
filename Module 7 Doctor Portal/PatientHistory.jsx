// frontend/src/doctor/PatientHistory.jsx
// Longitudinal view for a pseudonymous patient: fetches prior visits and shows a
// trend chart plus a compact visit table. Loaded on demand by patient_ref.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import TrendChart from '../components/TrendChart';

// Fetches and renders the visit history for one patientRef: a trend chart
// (delegated to TrendChart) plus a compact table of recent CBC values.
export default function PatientHistory({ patientRef }) {
  const [reports, setReports] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!patientRef) return;
    // `active` guards against setting state after the effect is cleaned up
    // (e.g. patientRef changes again before this fetch resolves).
    let active = true;
    setReports(null); setErr('');
    api.get(`/patients/${encodeURIComponent(patientRef)}/history`)
      .then((r) => { if (active) setReports(r); })
      .catch((e) => { if (active) setErr(e.message); });
    return () => { active = false; };
  }, [patientRef]);

  if (!patientRef) return null;
  if (err) return <p className="fh-error">{err}</p>;
  if (!reports) return <p className="fh-muted">Loading history…</p>;
  if (reports.length === 0) return <p className="fh-muted">No prior visits recorded for this patient.</p>;

  return (
    <div>
      <TrendChart reports={reports} />
      <hr className="fh-hr" />
      <div className="fh-eyebrow">Visits ({reports.length})</div>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'right', color: 'var(--ink-soft)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Date</th>
              <th style={{ padding: '6px 8px' }}>HGB</th>
              <th style={{ padding: '6px 8px' }}>MCV</th>
              <th style={{ padding: '6px 8px' }}>PLT</th>
              <th style={{ padding: '6px 8px' }}>WBC</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--line-soft)' }}>
                <td style={{ padding: '6px 8px' }}>{(r.collected_at || r.created_at || '').slice(0, 10)}</td>
                {['HGB', 'MCV', 'PLT', 'WBC'].map((k) => (
                  <td key={k} className="fh-num" style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {r.cbc?.[k] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
