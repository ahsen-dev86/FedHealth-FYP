// frontend/src/model-health/ModelHealthDashboard.jsx
// AI Model Health dashboard (NIH/admin tier, same 'nih:dashboard' permission
// as Surveillance): model accuracy/loss over training rounds, incoming data
// volume + nature, per-node status and contribution, and the encryption
// configuration used by the last FL run. Everything here is aggregate.
import { useEffect, useState } from 'react';
import { Activity, Cpu, Gauge, Database } from 'lucide-react';
import { api } from '../api/client';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import AccuracyChart from './AccuracyChart';
import NodeStatusTable from './NodeStatusTable';
import DataIntakeCharts from './DataIntakeCharts';
import NodeContributionChart from './NodeContributionChart';
import EncryptionStatusCard from './EncryptionStatusCard';

const SPANS = [
  ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'],
];

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate font-mono text-lg tabular-nums text-foreground">{value}</div>
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ModelHealthDashboard() {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState(null);
  const [nodes, setNodes] = useState(null);
  const [intake, setIntake] = useState(null);
  const [contribution, setContribution] = useState(null);
  const [encryption, setEncryption] = useState(null);
  const [days, setDays] = useState('30');

  useEffect(() => {
    api.get('/model-health/summary').then(setSummary).catch(() => setSummary({}));
    api.get('/model-health/accuracy-history').then(setHistory).catch(() => setHistory({ points: [] }));
    api.get('/model-health/nodes').then(setNodes).catch(() => setNodes([]));
    api.get('/model-health/encryption').then(setEncryption).catch(() => setEncryption(null));
  }, []);

  useEffect(() => {
    setIntake(null); setContribution(null);
    api.get(`/model-health/data-intake?days=${days}`).then(setIntake).catch(() => setIntake(null));
    api.get(`/model-health/node-contribution?days=${days}`).then(setContribution).catch(() => setContribution([]));
  }, [days]);

  const model = summary?.activeModel;
  const accuracyPct = model?.metrics?.accuracy != null ? `${Math.round(model.metrics.accuracy * 100)}%` : '—';
  const f1Pct = model?.metrics?.macro_f1 != null ? `${Math.round(model.metrics.macro_f1 * 100)}%` : null;

  return (
    <div>
      <div className="mb-4.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Federated learning telemetry</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">AI Model Health</h1>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard icon={Gauge} label="Active model accuracy" value={accuracyPct}
                  sub={model ? `${model.name} · ${model.version}` : undefined} />
        <StatCard icon={Activity} label="Macro F1" value={f1Pct || '—'} />
        <StatCard icon={Cpu} label="Predictions served" value={summary?.totalPredictions ?? '—'}
                  sub={summary?.avgInferenceMs != null ? `avg ${summary.avgInferenceMs} ms` : undefined} />
        <StatCard icon={Database} label="Lab reports ingested" value={summary?.totalLabReports ?? '—'} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Accuracy & loss over training rounds</CardTitle></CardHeader>
          <CardContent><AccuracyChart history={history} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Encryption status</CardTitle></CardHeader>
          <CardContent><EncryptionStatusCard status={encryption} /></CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle>Federated nodes</CardTitle></CardHeader>
        <CardContent><NodeStatusTable nodes={nodes} /></CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Node contribution</CardTitle>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[150px]">
              <SelectValue>{(v) => SPANS.find(([val]) => val === v)?.[1] || v}</SelectValue>
            </SelectTrigger>
            <SelectContent>{SPANS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </CardHeader>
        <CardContent><NodeContributionChart rows={contribution} /></CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader><CardTitle>Data intake</CardTitle></CardHeader>
        <CardContent><DataIntakeCharts intake={intake} /></CardContent>
      </Card>
    </div>
  );
}
