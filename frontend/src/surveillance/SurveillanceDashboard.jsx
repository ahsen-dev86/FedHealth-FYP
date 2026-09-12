// frontend/src/surveillance/SurveillanceDashboard.jsx
// National surveillance workspace (scope Module 6.5). Three views:
//   * Surveillance — geospatial clusters (map) + filters + summary stats
//   * Alerts       — the predictive-alert feed with acknowledgement
//   * Compliance   — immutable audit-log oversight
// Everything shown is aggregated + anonymized; the surveillance role cannot
// reach individual reports or predictions (enforced by backend RBAC).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import ClusterMap from './ClusterMap';
import AlertsFeed from './AlertsFeed';
import CompliancePanel from './CompliancePanel';
import { CONDITION_LABELS, conditionLabel } from '../lib/format';

const PROVINCES = ['Punjab', 'Sindh', 'KPK', 'Balochistan', 'Islamabad', 'Gilgit-Baltistan', 'AJK'];
const CONDITIONS = ['leukemia', 'leukemia_with_thrombocytopenia', 'thrombocytopenia',
  'iron_deficiency_anemia', 'other_microcytic_anemia', 'macrocytic_anemia', 'beta_thal_trait'];

const TABS = [
  ['surveillance', 'Surveillance'],
  ['alerts', 'Alerts'],
  ['compliance', 'Compliance'],
];

export default function SurveillanceDashboard() {
  const [tab, setTab] = useState('surveillance');
  const [clusters, setClusters] = useState(null);
  const [filters, setFilters] = useState({ province: '', condition: '' });
  const [mapMode, setMapMode] = useState('markers');
  const [openAlertCount, setOpenAlertCount] = useState(null);
  const [err, setErr] = useState('');

  const loadClusters = useCallback(async () => {
    setErr('');
    const qs = new URLSearchParams();
    if (filters.province) qs.set('province', filters.province);
    if (filters.condition) qs.set('condition', filters.condition);
    try {
      setClusters(await api.get(`/nih/clusters?${qs.toString()}`));
    } catch (e) { setErr(e.message); setClusters([]); }
  }, [filters]);

  useEffect(() => { loadClusters(); }, [loadClusters]);

  // Aggregate summary across the returned clusters (numbers arrive as strings).
  const stats = useMemo(() => {
    const rows = clusters || [];
    const cases = rows.reduce((a, c) => a + (Number(c.case_count) || 0), 0);
    const highRisk = rows.reduce((a, c) => a + (Number(c.high_risk_count) || 0), 0);
    const districts = new Set(rows.map((c) => c.district).filter(Boolean)).size;
    return { cases, highRisk, districts };
  }, [clusters]);

  return (
    <div>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="fh-eyebrow">National epidemiological intelligence</div>
          <h1 style={{ fontSize: 24, marginTop: 4 }}>Surveillance Dashboard</h1>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {TABS.map(([id, label]) => (
            <button key={id} className={`fh-btn ${tab === id ? 'fh-btn--primary' : 'fh-btn--ghost'}`}
                    onClick={() => setTab(id)}>
              {label}{id === 'alerts' && openAlertCount ? ` (${openAlertCount})` : ''}
            </button>
          ))}
        </div>
      </div>

      {tab === 'surveillance' && (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14, marginBottom: 16 }}>
            {[['Predictions', stats.cases], ['High-risk cases', stats.highRisk], ['Districts reporting', stats.districts]].map(([label, val]) => (
              <div key={label} className="fh-card"><div className="fh-card__body">
                <div className="fh-muted" style={{ fontSize: 12 }}>{label}</div>
                <div className="fh-num" style={{ fontSize: 28, color: 'var(--teal)' }}>{val}</div>
              </div></div>
            ))}
          </div>

          <div className="fh-card">
            <div className="fh-card__head">
              <h3 style={{ fontSize: 15 }}>Prediction clusters</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="fh-select" style={{ width: 'auto' }}
                        value={filters.province} onChange={(e) => setFilters((f) => ({ ...f, province: e.target.value }))}>
                  <option value="">All provinces</option>
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select className="fh-select" style={{ width: 'auto' }}
                        value={filters.condition} onChange={(e) => setFilters((f) => ({ ...f, condition: e.target.value }))}>
                  <option value="">All conditions</option>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c] || c}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['markers', 'heat'].map((m) => (
                    <button key={m} className={`fh-btn ${m === mapMode ? 'fh-btn--primary' : 'fh-btn--ghost'}`}
                            style={{ padding: '6px 12px', textTransform: 'capitalize' }}
                            onClick={() => setMapMode(m)}>{m}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="fh-card__body">
              {err && <p className="fh-error">{err}</p>}
              {clusters == null
                ? <p className="fh-muted">Loading map…</p>
                : <ClusterMap clusters={clusters} mode={mapMode} />}
              <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--ink-soft)' }}>
                <span><span style={{ color: '#0E7C7B' }}>●</span> cluster (marker size ∝ cases)</span>
                <span><span style={{ color: '#B4453C' }}>●</span> contains high-risk cases</span>
              </div>

              {/* Cluster table */}
              {clusters?.length > 0 && (
                <div style={{ overflowX: 'auto', marginTop: 16 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ color: 'var(--ink-soft)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px' }}>District</th>
                      <th style={{ padding: '6px 8px' }}>Condition</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cases</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>High-risk</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Avg conf.</th>
                    </tr></thead>
                    <tbody>
                      {clusters.map((c, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--line-soft)' }}>
                          <td style={{ padding: '6px 8px' }}>{c.district || '—'}</td>
                          <td style={{ padding: '6px 8px' }}>{conditionLabel(c.condition)}</td>
                          <td className="fh-num" style={{ padding: '6px 8px', textAlign: 'right' }}>{Number(c.case_count)}</td>
                          <td className="fh-num" style={{ padding: '6px 8px', textAlign: 'right', color: Number(c.high_risk_count) ? 'var(--risk)' : 'inherit' }}>{Number(c.high_risk_count)}</td>
                          <td className="fh-num" style={{ padding: '6px 8px', textAlign: 'right' }}>{Math.round(Number(c.avg_confidence) * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'alerts' && (
        <div className="fh-card"><div className="fh-card__body">
          <AlertsFeed onData={(rows) => setOpenAlertCount(rows.filter((a) => a.status === 'open').length)} />
        </div></div>
      )}

      {tab === 'compliance' && (
        <div className="fh-card"><div className="fh-card__body">
          <CompliancePanel />
        </div></div>
      )}
    </div>
  );
}
