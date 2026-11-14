// frontend/src/lab/LabDashboard.jsx
// Lab Node dashboard (route: /lab, permission 'lab:dashboard') for a lab
// engineer: how THEIR lab's node is behaving in FedHealth. Is it live, how much
// data it has sent, how it took part in federated rounds, and the quality of what
// it ingested. The lab is always the engineer's own (the API never takes it from
// the request); an admin can pick any lab.
//
// Data is SAMPLE for now (source: 'sample', flagged with the Sample data badge):
// the response shape is the contract the lab's Docker FL client will fill later,
// see backend/src/services/labTelemetry.js. Aggregates only, never patient rows.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, RefreshCw, Database, Clock, Layers, ShieldCheck, Server, Lock,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import SampleBadge from '../model-health/SampleBadge';
import { relativeTime, spanBetween } from '../lib/format';
import {
  STATUS_META, HeartbeatStrip, ReportsPerDayChart, SourceBars, ConditionBars, FlaggedBars, RoundsTable, EventList,
} from './LabCharts';

const POLL_MS = 15000; // how often the dashboard re-reads the node's status
const SIMULATE = [['online', 'Online'], ['degraded', 'Degraded'], ['offline', 'Offline']];

// Small icon + label + value tile used for the top summary row.
function StatCard({ icon: Icon, label, value, sub, testId }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate font-mono text-lg tabular-nums text-foreground" data-testid={testId}>{value}</div>
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// One-sentence status line under the page title: what the node is doing right now.
function statusSentence(d) {
  const { node, federation } = d;
  if (node.status === 'online') return `Last heartbeat ${relativeTime(node.last_heartbeat_at)}. Updates are reaching the aggregation server on time.`;
  if (node.status === 'degraded') {
    return `Heartbeats are intermittent (last ${relativeTime(node.last_heartbeat_at)}). Round updates may arrive late and be held for the next aggregation.`;
  }
  return `No heartbeat for ${spanBetween(node.last_heartbeat_at)}. The last update was sent in round ${federation.last_round_sent} of ${federation.total_rounds}; `
    + `the federation is on round ${federation.current_round}. Check the node's container and its link to the aggregation server.`;
}

export default function LabDashboard() {
  const { can } = useAuth();
  const isAdmin = can('lab:manage'); // admins have no lab of their own and pick one
  const [labs, setLabs] = useState([]);
  const [labId, setLabId] = useState('');
  const [simulate, setSimulate] = useState('online');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [fetchedAt, setFetchedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, tick] = useState(0);
  const labIdRef = useRef('');
  labIdRef.current = labId;

  // Re-render every second so the "12 s ago" labels keep counting between polls.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    api.get('/labs').then(setLabs).catch(() => setLabs([]));
  }, [isAdmin]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const qs = new URLSearchParams();
      if (isAdmin && labIdRef.current) qs.set('lab', labIdRef.current);
      qs.set('simulate', simulate);
      const d = await api.get(`/lab/dashboard?${qs}`);
      setData(d);
      setErr('');
      setFetchedAt(Date.now());
      if (isAdmin && !labIdRef.current) setLabId(d.lab.id);
    } catch (e) {
      setErr(e.message); // keep showing the last good data; the banner says it is stale
    } finally {
      setRefreshing(false);
    }
  }, [isAdmin, simulate]);

  // Fetch on mount and whenever the lab or simulated state changes, then keep polling.
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, labId]);

  if (!data) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Lab Node</h1>
        {err ? <p className="mt-3 text-sm text-destructive" data-testid="lab-error">{err}</p> : (
          <div className="mt-5 space-y-4" data-testid="lab-loading">
            <Skeleton className="h-24 w-full" /><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" />
          </div>
        )}
      </div>
    );
  }

  const { lab, node, federation, source } = data;
  const status = STATUS_META[node.status];
  const StatusIcon = status.icon;
  const isSample = source === 'sample';
  const flagged = data.data.quality.flagged.reduce((s, f) => s + f.count, 0);

  return (
    <div>
      <div className="mb-4.5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            Lab node · <span className="font-mono normal-case">{lab.fl_client_id || 'not linked to an FL client'}</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground" data-testid="lab-name">{lab.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {lab.district}, {lab.province}{lab.lims_type ? ` · LIMS: ${lab.lims_type}` : ''}
            {lab.enrolled_at ? ` · enrolled ${new Date(lab.enrolled_at).toLocaleDateString()}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && labs.length > 0 && (
            <Select value={labId} onValueChange={setLabId}>
              <SelectTrigger size="sm" className="w-[220px]" aria-label="Lab">
                <SelectValue>{(v) => labs.find((l) => l.id === v)?.name || 'Choose a lab'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {labs.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={refreshing} aria-label="Refresh now">
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            <span data-testid="refreshed-at">{fetchedAt ? `Updated ${relativeTime(new Date(fetchedAt).toISOString())}` : 'Refresh'}</span>
          </Button>
        </div>
      </div>

      {isSample && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-muted-foreground"
             data-testid="sample-banner">
          <SampleBadge title="This lab's node is not reporting yet; figures are generated, not measured" />
          <span className="min-w-0 flex-1">Illustrative figures until this lab's FL client is connected. The lab details above are real.</span>
          <span className="flex items-center gap-2 text-xs">
            Preview state
            <Select value={simulate} onValueChange={setSimulate}>
              <SelectTrigger size="sm" className="w-[120px]" aria-label="Preview node state" data-testid="simulate-select">
                <SelectValue>{(v) => SIMULATE.find(([k]) => k === v)?.[1] || v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SIMULATE.map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </span>
        </div>
      )}

      {err && <p className="mb-3 text-sm text-destructive" data-testid="lab-error">Could not refresh: {err}. Showing the last data received.</p>}

      <Card className={`mb-5 border ${status.cls}`} data-testid="node-status-card">
        <CardContent className="flex items-start gap-3">
          <span className="relative mt-1 flex size-3 shrink-0">
            {node.status === 'online' && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${status.dot}`} />}
            <span className={`relative inline-flex size-3 rounded-full ${status.dot}`} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-foreground">Node {status.label.toLowerCase()}</span>
              <Badge variant="outline" className={`gap-1 ${status.cls}`} data-testid="node-status"><StatusIcon className="size-3" /> {status.label}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground" data-testid="status-sentence">{statusSentence(data)}</p>
          </div>
        </CardContent>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        <StatCard icon={Activity} label="Uptime (30 days)" testId="stat-uptime" value={`${node.uptime_30d_pct}%`}
                  sub={`since ${new Date(node.started_at).toLocaleDateString()}`} />
        <StatCard icon={Database} label="Reports sent (30 days)" testId="stat-reports" value={data.data.reports_30d.toLocaleString()}
                  sub={`${data.data.reports_24h} today · ${data.data.reports_total.toLocaleString()} all time`} />
        <StatCard icon={Clock} label="Last report received" testId="stat-last-report" value={relativeTime(data.data.last_report_at)}
                  sub={`heartbeat ${relativeTime(node.last_heartbeat_at)}`} />
        <StatCard icon={Layers} label="Training rounds" testId="stat-rounds"
                  value={`${federation.rounds_participated} / ${federation.total_rounds}`}
                  sub={`last update ${relativeTime(federation.last_update_sent_at)}`} />
        <StatCard icon={ShieldCheck} label="Reports accepted" testId="stat-accepted" value={`${data.data.quality.accepted_pct}%`}
                  sub={`${flagged} flagged in 30 days`} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Heartbeat, last 24 hours</CardTitle></CardHeader>
          <CardContent><HeartbeatStrip slots={node.heartbeats_24h} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Node</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm" data-testid="node-details">
              <dt className="flex items-center gap-1.5 text-muted-foreground"><Server className="size-3.5" /> Container</dt>
              <dd className="text-right text-foreground">{node.container_state}</dd>
              <dt className="text-muted-foreground">Client</dt>
              <dd className="text-right font-mono text-xs text-foreground">{node.client_version}</dd>
              <dt className="flex items-center gap-1.5 text-muted-foreground"><Lock className="size-3.5" /> Encryption</dt>
              <dd className="text-right text-foreground">
                {node.encryption.scheme === 'paillier' ? 'Paillier' : node.encryption.scheme} {node.encryption.key_bits}-bit
                {node.encryption.key_loaded ? '' : ' (key not loaded)'}
              </dd>
              <dt className="text-muted-foreground">Transport</dt>
              <dd className="text-right text-foreground">{node.encryption.transport}</dd>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Model updates are encrypted before they leave the lab; the aggregation server never sees plaintext weights.</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Reports sent per day</CardTitle></CardHeader>
          <CardContent><ReportsPerDayChart byDay={data.data.by_day} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Where reports come from</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <SourceBars rows={data.data.by_source} />
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Screening mix of this lab's data (model's top class)</div>
              <ConditionBars rows={data.data.by_condition} />
              <p className="mt-2 text-xs text-muted-foreground">
                Each lab's mix differs; that difference is why federated training across labs helps.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>
            Federated rounds
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {federation.local_train_rows.toLocaleString()} local training rows per round
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent><RoundsTable rounds={federation.recent_rounds} totalRounds={federation.total_rounds} /></CardContent>
      </Card>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Data quality: reports flagged (30 days)</CardTitle></CardHeader>
          <CardContent>
            <FlaggedBars rows={data.data.quality.flagged} />
            <p className="mt-3 text-xs text-muted-foreground">
              Flagged reports are the ones the lab's validation held back, for example when no unit was printed or a value was implausible.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent><EventList events={data.events} /></CardContent>
        </Card>
      </div>
    </div>
  );
}
