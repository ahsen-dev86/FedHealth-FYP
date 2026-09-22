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
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';

const PROVINCES = ['Punjab', 'Sindh', 'KPK', 'Balochistan', 'Islamabad', 'Gilgit-Baltistan', 'AJK'];
const CONDITIONS = ['leukemia', 'leukemia_with_thrombocytopenia', 'thrombocytopenia',
  'iron_deficiency_anemia', 'other_microcytic_anemia', 'macrocytic_anemia', 'beta_thal_trait'];

export default function SurveillanceDashboard() {
  const [tab, setTab] = useState('surveillance');
  const [clusters, setClusters] = useState(null);
  const [filters, setFilters] = useState({ province: '__all', condition: '__all' });
  const [mapMode, setMapMode] = useState('markers');
  const [openAlertCount, setOpenAlertCount] = useState(null);
  const [err, setErr] = useState('');

  const loadClusters = useCallback(async () => {
    setErr('');
    const qs = new URLSearchParams();
    if (filters.province !== '__all') qs.set('province', filters.province);
    if (filters.condition !== '__all') qs.set('condition', filters.condition);
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
      <div className="mb-4.5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">National epidemiological intelligence</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Surveillance Dashboard</h1>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line">
          <TabsTrigger value="surveillance">Surveillance</TabsTrigger>
          <TabsTrigger value="alerts">Alerts{openAlertCount ? ` (${openAlertCount})` : ''}</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="surveillance" className="mt-4">
          {/* Summary stats */}
          <div className="mb-4 grid grid-cols-3 gap-3.5">
            {[['Predictions', stats.cases], ['High-risk cases', stats.highRisk], ['Districts reporting', stats.districts]].map(([label, val]) => (
              <Card key={label}>
                <CardContent>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 font-mono text-[28px] tabular-nums text-primary">{val}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle>Prediction clusters</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={filters.province} onValueChange={(v) => setFilters((f) => ({ ...f, province: v }))}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue>{(v) => (v === '__all' ? 'All provinces' : v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All provinces</SelectItem>
                    {PROVINCES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filters.condition} onValueChange={(v) => setFilters((f) => ({ ...f, condition: v }))}>
                  <SelectTrigger className="w-[190px]">
                    <SelectValue>{(v) => (v === '__all' ? 'All conditions' : (CONDITION_LABELS[v] || v))}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All conditions</SelectItem>
                    {CONDITIONS.map((c) => <SelectItem key={c} value={c}>{CONDITION_LABELS[c] || c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex gap-1">
                  {['markers', 'heat'].map((m) => (
                    <Button key={m} size="sm" variant={m === mapMode ? 'default' : 'outline'}
                            className="capitalize" onClick={() => setMapMode(m)}>{m}</Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {err && <p className="mb-2 text-sm text-destructive">{err}</p>}
              {clusters == null
                ? <p className="text-sm text-muted-foreground">Loading map…</p>
                : <ClusterMap clusters={clusters} mode={mapMode} />}
              <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                <span><span className="text-primary">●</span> cluster (marker size ∝ cases)</span>
                <span><span className="text-destructive">●</span> contains high-risk cases</span>
              </div>

              {/* Cluster table */}
              {clusters?.length > 0 && (
                <Table className="mt-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>District</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead className="text-right">Cases</TableHead>
                      <TableHead className="text-right">High-risk</TableHead>
                      <TableHead className="text-right">Avg conf.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clusters.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell>{c.district || '—'}</TableCell>
                        <TableCell>{conditionLabel(c.condition)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{Number(c.case_count)}</TableCell>
                        <TableCell className={`text-right font-mono tabular-nums ${Number(c.high_risk_count) ? 'text-destructive' : ''}`}>
                          {Number(c.high_risk_count)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{Math.round(Number(c.avg_confidence) * 100)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <Card>
            <CardContent>
              <AlertsFeed onData={(rows) => setOpenAlertCount(rows.filter((a) => a.status === 'open').length)} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance" className="mt-4">
          <Card>
            <CardContent>
              <CompliancePanel />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
