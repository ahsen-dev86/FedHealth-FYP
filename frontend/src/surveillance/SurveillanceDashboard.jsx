// frontend/src/surveillance/SurveillanceDashboard.jsx
// National surveillance workspace (scope Module 6.5). Three views:
//   * Surveillance — geospatial clusters (map) + filters + summary stats
//   * Alerts       — the predictive-alert feed with acknowledgement
//   * Compliance   — immutable audit-log oversight
// Everything shown is aggregated + anonymized; the surveillance role cannot
// reach individual reports or predictions (enforced by backend RBAC).
// Conditions are the model's classes; clusters group screening results by their
// highest score (not confirmed diagnoses), and 'healthy' results are not shown
// as disease clusters.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import ClusterMap from './ClusterMap';
import AlertsFeed from './AlertsFeed';
import CompliancePanel from './CompliancePanel';
import { conditionLabel, conditionColor } from '../lib/format';
import { CLASSES } from '../lib/contract';
import { PROVINCES } from '../lib/districts';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';

// Disease classes only; 'healthy' results aren't shown as surveillance clusters.
const CONDITIONS = CLASSES.filter((c) => c !== 'healthy');

// Screening flags for one condition: results whose top score is that condition.
// Leukemia also counts risk-flagged results where another class is top (the same
// rule the cluster alerts use), which is why `rows` must include every class.
function conditionFlags(rows, condition) {
  return rows.reduce((n, c) => {
    if (c.condition === condition) return n + (Number(c.case_count) || 0);
    if (condition === 'leukemia') return n + (Number(c.high_risk_count) || 0);
    return n;
  }, 0);
}

export default function SurveillanceDashboard() {
  const [tab, setTab] = useState('surveillance');
  const [rows, setRows] = useState(null); // every class for the province, healthy included
  const [filters, setFilters] = useState({ province: '__all', condition: '__all' });
  const [mapMode, setMapMode] = useState('markers');
  const [openAlertCount, setOpenAlertCount] = useState(null);
  const [err, setErr] = useState('');

  // Fetched per province only; the condition filter is applied below so the
  // leukemia flag count can still see risk flags on other classes' results.
  const loadClusters = useCallback(async () => {
    setErr('');
    const qs = new URLSearchParams();
    if (filters.province !== '__all') qs.set('province', filters.province);
    try {
      setRows(await api.get(`/nih/clusters?${qs.toString()}`));
    } catch (e) { setErr(e.message); setRows([]); }
  }, [filters.province]);

  useEffect(() => { loadClusters(); }, [loadClusters]);

  // Clusters actually shown on the map/table: healthy rows dropped, then the
  // condition filter applied (separately from `rows`, so stats above can still
  // see all classes for the leukemia flag count).
  const clusters = useMemo(() => rows && rows.filter((c) => c.condition !== 'healthy'
    && (filters.condition === '__all' || c.condition === filters.condition)), [rows, filters.condition]);

  // Aggregate summary across the returned clusters (numbers arrive as strings).
  const stats = useMemo(() => {
    const shown = clusters || [];
    const cases = shown.reduce((a, c) => a + (Number(c.case_count) || 0), 0);
    const flagged = filters.condition === '__all' ? CONDITIONS : [filters.condition];
    const flags = flagged.reduce((a, cond) => a + conditionFlags(rows || [], cond), 0);
    const districts = new Set(shown.map((c) => c.district).filter(Boolean)).size;
    return { cases, flags, districts };
  }, [rows, clusters, filters.condition]);
  const flagsLabel = filters.condition === '__all'
    ? 'Total disease flags' : `${conditionLabel(filters.condition)} flags`;

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
            {[['cases', 'Screening results (non-healthy)', stats.cases], ['flags', flagsLabel, stats.flags],
              ['districts', 'Districts reporting', stats.districts]].map(([id, label, val]) => (
              <Card key={id} data-testid={`stat-${id}`}>
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
                    <SelectValue>{(v) => (v === '__all' ? 'All conditions' : conditionLabel(v))}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All conditions</SelectItem>
                    {CONDITIONS.map((c) => <SelectItem key={c} value={c}>{conditionLabel(c)}</SelectItem>)}
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
            <CardContent className="pt-2">
              {err && <p className="mb-2 text-sm text-destructive">{err}</p>}
              {clusters == null
                ? <p className="text-sm text-muted-foreground">Loading map…</p>
                : <ClusterMap clusters={clusters} mode={mapMode} />}
              {/* Map legend: one colored dot per condition, plus the risk-flag ring meaning */}
              <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                {CONDITIONS.map((c) => (
                  <span key={c}><span style={{ color: conditionColor(c) }}>●</span> {conditionLabel(c)}</span>
                ))}
                <span>marker size ∝ cases · thick red ring = leukemia risk flags</span>
              </div>

              {/* Cluster table */}
              {clusters?.length > 0 && (
                <Table className="mt-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>District</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead className="text-right">Cases</TableHead>
                      <TableHead className="text-right">Risk flags</TableHead>
                      <TableHead className="text-right">Avg top score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clusters.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell>{c.district || '—'}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-full" style={{ background: conditionColor(c.condition) }} />
                            {conditionLabel(c.condition)}
                          </span>
                        </TableCell>
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
