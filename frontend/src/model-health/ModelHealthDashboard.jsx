// frontend/src/model-health/ModelHealthDashboard.jsx
// AI Model Health (NIH/admin tier, 'nih:dashboard'). Shows the REGISTERED model
// and its measured test results, the imported federated runs (validation per
// round), encryption per run, the FL lab partitions and
// what they held, the training data, and this deployment's live intake.
// Everything is aggregate. Charts without a real source are labelled
// "Sample data" (see sampleData.js); nothing illustrative is shown unlabelled.
import { useEffect, useState } from 'react';
import { Activity, Gauge, HeartPulse, ShieldAlert, Cpu } from 'lucide-react';
import { api } from '../api/client';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import { pct1 } from '../lib/format';
import ModelCard from './ModelCard';
import AccuracyChart from './AccuracyChart';
import EncryptionStatusCard from './EncryptionStatusCard';
import FederatedRunsTable from './FederatedRunsTable';
import NodeStatusTable, { SampleNodeStatus } from './NodeStatusTable';
import NodeContributionChart from './NodeContributionChart';
import TrainingDataCharts from './TrainingDataCharts';
import DataIntakeCharts from './DataIntakeCharts';
import ModelServingCard from './ModelServingCard';

const SPANS = [
  ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'],
];

// Small icon + label + value tile used for the top summary-stat row.
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

export default function ModelHealthDashboard() {
  const [summary, setSummary] = useState(null);
  const [runs, setRuns] = useState(null);
  const [runId, setRunId] = useState(null);
  const [history, setHistory] = useState(null);
  const [nodes, setNodes] = useState(null);
  const [contribution, setContribution] = useState(null);
  const [trainingData, setTrainingData] = useState(null);
  const [encryption, setEncryption] = useState(null);
  const [intake, setIntake] = useState(null);
  const [days, setDays] = useState('30');
  const [err, setErr] = useState('');

  // Load every panel's data independently on mount so one failing endpoint
  // doesn't block the others from rendering.
  useEffect(() => {
    const fail = (e) => setErr(e.message);
    api.get('/model-health/summary').then(setSummary).catch((e) => { fail(e); setSummary({}); });
    api.get('/model-health/runs').then(setRuns).catch(() => setRuns([]));
    api.get('/model-health/nodes').then(setNodes).catch(() => setNodes([]));
    api.get('/model-health/node-contribution').then(setContribution).catch(() => setContribution([]));
    api.get('/model-health/training-data').then(setTrainingData).catch(() => setTrainingData(null));
    api.get('/model-health/encryption').then(setEncryption).catch(() => setEncryption({}));
  }, []);

  // Reload the accuracy-history chart whenever a different federated run is selected.
  useEffect(() => {
    setHistory(null);
    api.get(`/model-health/accuracy-history${runId ? `?run=${runId}` : ''}`)
      .then(setHistory).catch(() => setHistory({ points: [] }));
  }, [runId]);

  // Reload the data-intake charts when the selected time window changes.
  useEffect(() => {
    setIntake(null);
    api.get(`/model-health/data-intake?days=${days}`).then(setIntake).catch(() => setIntake({ days: Number(days) }));
  }, [days]);

  const model = summary ? summary.activeModel ?? null : undefined;
  const m = model?.metrics || {};
  const measured = m.split === 'test';
  const sick = m.test_rows && m.per_class?.healthy ? m.test_rows - m.per_class.healthy.support : null;
  const runsInfo = summary?.trainingRuns;

  return (
    <div>
      <div className="mb-4.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Registered model · federated learning records</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">AI Model Health</h1>
        {err && <p className="mt-1 text-sm text-destructive">{err}</p>}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        <StatCard icon={Gauge} label="Test accuracy (hybrid)" testId="stat-accuracy"
                  value={measured ? pct1(m.accuracy) : '—'} sub={measured ? `frozen ${m.test_rows}-row test split` : 'no measured metrics'} />
        <StatCard icon={Activity} label="Macro-F1 (test)" value={measured ? pct1(m.macro_f1) : '—'}
                  sub={measured && m.ece_15_bins != null ? `ECE ${m.ece_15_bins.toFixed(3)}` : undefined} />
        <StatCard icon={HeartPulse} label="Leukemia recall (test)" value={measured ? pct1(m.per_class_recall?.leukemia) : '—'} />
        <StatCard icon={ShieldAlert} label="Sick called healthy (test)" value={measured ? m.sick_called_healthy : '—'}
                  sub={sick ? `of ${sick} sick test cases` : undefined} />
        <StatCard icon={Cpu} label="Predictions served (this deployment)" value={summary?.totalPredictions ?? '—'}
                  sub={summary?.avgInferenceMs != null ? `avg ${summary.avgInferenceMs} ms · ${summary.totalLabReports} reports` : undefined} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Registered model</CardTitle></CardHeader>
          <CardContent><ModelCard model={model} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Encryption of federated updates</CardTitle></CardHeader>
          <CardContent><EncryptionStatusCard status={encryption} /></CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle>Model serving: primary and backup</CardTitle></CardHeader>
        <CardContent><ModelServingCard /></CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Validation accuracy & loss per federated round</CardTitle>
        </CardHeader>
        <CardContent><AccuracyChart history={history} runId={runId} onRunChange={setRunId} /></CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>
            Federated runs
            {runsInfo && <span className="ml-2 text-sm font-normal text-muted-foreground">
              {runsInfo.total} imported · round 0 kept in {runsInfo.keptRoundZero}
            </span>}
          </CardTitle>
        </CardHeader>
        <CardContent><FederatedRunsTable runs={runs} /></CardContent>
      </Card>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Federated lab partitions</CardTitle></CardHeader>
          <CardContent><NodeStatusTable nodes={nodes} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Training rows per lab and run</CardTitle></CardHeader>
          <CardContent><NodeContributionChart rows={contribution} /></CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle>Live node status</CardTitle></CardHeader>
        <CardContent><SampleNodeStatus /></CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader><CardTitle>Training data</CardTitle></CardHeader>
        <CardContent><TrainingDataCharts data={trainingData} /></CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Data intake (this deployment)</CardTitle>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[150px]">
              <SelectValue>{(v) => SPANS.find(([val]) => val === v)?.[1] || v}</SelectValue>
            </SelectTrigger>
            <SelectContent>{SPANS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </CardHeader>
        <CardContent><DataIntakeCharts intake={intake} /></CardContent>
      </Card>
    </div>
  );
}
