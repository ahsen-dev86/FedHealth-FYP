// frontend/src/model-health/LiveFederation.jsx
// "Federated training (live)": a real federated-learning run streamed as it
// happens (Module 4 FL/live_federation.py via /model-health/federation).
// Five simulated labs each hold a share of the training rows; every round the
// global network goes out, each lab trains on its own rows, only the weight
// update comes back (optionally Paillier-encrypted), the server averages them,
// and the new global network is scored on the held-out validation split.
//
// Administrators (model:register) start and stop runs; health officials watch.
// A run is a demonstration: it never changes the model that serves doctors.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Square, Lock, LockOpen, Database, Server, ShieldCheck, Info, History, ArrowRight,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CLASSES } from '../lib/contract';
import { conditionColor, conditionLabel, pct1, relativeTime } from '../lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';

const SPLITS = {
  iid: { label: 'Even split', hint: 'Every lab gets a similar mix of the four conditions, like labs serving similar populations.' },
  source: { label: 'One real dataset per lab', hint: 'Each lab holds one of the five source datasets. Realistic and much harder: the labs\' data differ (non-IID).' },
};
const STARTS = {
  scratch: { label: 'From scratch', hint: 'A fresh, untrained global network, so you can watch it learn round by round.' },
  deployed: { label: 'Fine-tune the deployed network', hint: 'Start from the centrally trained network, as in the evaluated experiments. Changes are small.' },
};
const ENCRYPTION = {
  none: { label: 'None', hint: 'Updates are averaged in plain form.', perRound: 11 },
  'paillier-1024': { label: 'Paillier 1024-bit (demo speed)', hint: 'Encrypted, faster key size. Below production strength.', perRound: 45 },
  'paillier-2048': { label: 'Paillier 2048-bit', hint: 'Production-strength encryption; about 3.5 minutes per round on this server.', perRound: 210 },
};
const STARTUP_SECONDS = 40;
const LAB_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-5)', 'var(--chart-4)'];

const fmtBytes = (n) => (n == null ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);
const fmtDuration = (s) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

// ---------------------------------------------------------------------------
// Turn the event stream into the dashboard's state.
function reduce(events) {
  const st = {
    status: null, settings: null, setup: null, round: 0, phase: 'idle', curve: [], labs: {}, log: [],
    exchanged: 0, done: null, error: null, keys: null, lastAggregate: null,
  };
  for (const e of events) {
    switch (e.type) {
      case 'status':
        st.status = e.status; if (e.settings) st.settings = e.settings; if (e.error) st.error = e.error;
        if (e.status !== 'running') st.phase = e.status;
        break;
      case 'keys': st.keys = e; st.log.push({ e, text: `Generated a ${e.bits}-bit Paillier key pair` }); break;
      case 'setup':
        st.setup = e;
        for (const lab of e.labs) st.labs[lab.id] = { ...lab, state: 'waiting', losses: [], lastUpdate: null };
        st.log.push({ e, text: `${e.labs.length} labs ready; ${e.train_rows.toLocaleString()} training rows split between them. Patient rows stay in each lab.` });
        break;
      case 'round_start':
        st.round = e.round; st.phase = 'training';
        Object.values(st.labs).forEach((l) => { l.state = 'waiting'; });
        st.log.push({ e, text: `Round ${e.round}: server sends the global network to every lab` });
        break;
      case 'lab_receive': if (st.labs[e.lab]) st.labs[e.lab].state = 'training'; break;
      case 'lab_update': {
        const lab = st.labs[e.lab];
        if (lab) {
          lab.state = 'sent'; lab.losses.push({ round: e.round, loss: e.local_loss }); lab.lastUpdate = e;
        }
        st.exchanged += e.update_bytes;
        st.log.push({ e, text: `${lab?.name || e.lab} trained on its ${e.rows} rows (${e.train_seconds}s${e.encrypt_seconds != null ? `, encrypted in ${e.encrypt_seconds}s` : ''}) and sent a ${fmtBytes(e.update_bytes)} update · 0 patient rows` });
        break;
      }
      case 'aggregate':
        st.phase = 'aggregating'; st.lastAggregate = e;
        Object.values(st.labs).forEach((l) => { l.state = 'merged'; });
        st.log.push({ e, text: e.encrypted
          ? `Server added ${e.labs} encrypted updates without decrypting them (difference from plain averaging: ${e.max_difference_from_plain_fedavg})`
          : `Server averaged ${e.labs} updates, weighted by each lab's rows (FedAvg)` });
        break;
      case 'validation':
        st.curve.push({ round: e.round, accuracy: +(e.accuracy * 100).toFixed(1), macroF1: +(e.macro_f1 * 100).toFixed(1),
                        loss: +e.log_loss.toFixed(3), recall: e.per_class_recall });
        if (e.round > 0) st.phase = 'validated';
        st.log.push({ e, text: e.round === 0
          ? `Starting global network: ${pct1(e.accuracy)} validation accuracy`
          : `Round ${e.round} global network: ${pct1(e.accuracy)} validation accuracy, macro-F1 ${pct1(e.macro_f1)}` });
        break;
      case 'done': st.done = e; st.phase = 'finished'; break;
      case 'error': st.error = e.message; break;
      default: break;
    }
  }
  return st;
}

// ---------------------------------------------------------------------------
// The hub-and-labs diagram. Packets travel out while labs train and back as
// they send updates; a lock marks encrypted updates.
function FederationDiagram({ st }) {
  const labs = st.setup?.labs || [];
  const W = 480; const H = 380; const cx = W / 2; const cy = H / 2 + 4; const R = 138;
  const pos = labs.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, labs.length);
    return { x: cx + R * 1.2 * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  const encrypted = !!st.setup?.encrypted;
  const running = st.status === 'running';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Global model with five labs exchanging updates" data-testid="fl-diagram">
      <style>{`
        .fl-out { stroke-dasharray: 4 140; animation: fl-dash 1.2s linear infinite; }
        .fl-back { stroke-dasharray: 4 140; animation: fl-dash 1.2s linear infinite reverse; }
        @keyframes fl-dash { from { stroke-dashoffset: 144; } to { stroke-dashoffset: 0; } }
        .fl-pulse { transform-box: fill-box; transform-origin: center; animation: fl-pulse 1.1s ease-in-out infinite; }
        @keyframes fl-pulse { 50% { transform: scale(1.08); } }
        @media (prefers-reduced-motion: reduce) { .fl-out, .fl-back, .fl-pulse { animation: none; } }
      `}</style>
      {labs.map((lab, i) => {
        const p = pos[i];
        const s = st.labs[lab.id]?.state;
        const d = `M${cx},${cy} L${p.x},${p.y}`;
        return (
          <g key={lab.id}>
            <path d={d} stroke="var(--border)" strokeWidth="2" fill="none" />
            {running && s === 'training' && <path d={d} className="fl-out" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" fill="none" />}
            {running && s === 'sent' && <path d={d} className="fl-back" stroke={LAB_COLORS[i]} strokeWidth="3" strokeLinecap="round" fill="none" />}
          </g>
        );
      })}
      <g className={running && st.phase === 'aggregating' ? 'fl-pulse' : ''}>
        <circle cx={cx} cy={cy} r="54" fill="var(--primary)" opacity="0.12" />
        <circle cx={cx} cy={cy} r="43" fill="var(--primary)" />
        <foreignObject x={cx - 14} y={cy - 26} width="28" height="28">
          {encrypted ? <Lock className="size-7 text-primary-foreground" /> : <Server className="size-7 text-primary-foreground" />}
        </foreignObject>
        <text x={cx} y={cy + 21} textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--primary-foreground)">
          {st.round ? `round ${st.round}` : 'global'}
        </text>
        <text x={cx} y={cy + 72} textAnchor="middle" fontSize="13" fill="var(--muted-foreground)">
          {encrypted ? 'adds encrypted updates' : 'averages updates (FedAvg)'}
        </text>
      </g>
      {labs.map((lab, i) => {
        const p = pos[i];
        const s = st.labs[lab.id]?.state;
        return (
          <g key={`${lab.id}-node`} className={running && s === 'training' ? 'fl-pulse' : ''}>
            <circle cx={p.x} cy={p.y} r="31" fill="var(--card)" stroke={LAB_COLORS[i]} strokeWidth={s === 'training' ? 4.5 : 2.5} />
            <foreignObject x={p.x - 11} y={p.y - 19} width="22" height="22">
              <Database className="size-[22px]" style={{ color: LAB_COLORS[i] }} />
            </foreignObject>
            <text x={p.x} y={p.y + 18} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)">{lab.name}</text>
            <text x={p.x} y={p.y + 49} textAnchor="middle" fontSize="13" fill="var(--muted-foreground)">
              {s === 'training' ? 'training locally…' : s === 'sent' ? (encrypted ? 'sent encrypted update' : 'sent update') : s === 'merged' ? 'merged' : `${lab.rows} rows`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ClassMix({ counts }) {
  const total = CLASSES.reduce((a, c) => a + (counts?.[c] || 0), 0) || 1;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {CLASSES.map((c) => <div key={c} style={{ width: `${((counts?.[c] || 0) / total) * 100}%`, background: conditionColor(c) }} />)}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {CLASSES.map((c) => `${conditionLabel(c)} ${counts?.[c] || 0}`).join(' · ')}
      </div>
    </div>
  );
}

function LabCard({ lab, index, encrypted }) {
  const last = lab.lastUpdate;
  const losses = lab.losses.map((l) => l.loss);
  const max = Math.max(...losses, 0.01);
  return (
    <div className="rounded-xl border border-border p-3" data-testid={`fl-lab-${lab.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: LAB_COLORS[index] }} />{lab.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">{lab.data}</div>
        </div>
        <Badge variant="outline" className="shrink-0 text-[11px] font-normal">{lab.rows} rows</Badge>
      </div>
      <div className="mt-2.5"><ClassMix counts={lab.class_counts} /></div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">Local training loss</div>
          <div className="flex items-end gap-0.5 pt-1" aria-label={`Local loss per round: ${losses.map((l) => l.toFixed(2)).join(', ')}`}>
            {losses.length === 0 && <span className="text-muted-foreground">—</span>}
            {losses.slice(-12).map((l, i) => (
              <span key={i} className="w-1.5 rounded-sm" style={{ height: `${6 + (l / max) * 20}px`, background: LAB_COLORS[index] }} />
            ))}
            {losses.length > 0 && <span className="ml-1 font-mono text-foreground">{losses[losses.length - 1].toFixed(2)}</span>}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Last update sent</div>
          <div className="mt-1 flex items-center gap-1 font-mono text-foreground">
            {encrypted ? <Lock className="size-3 text-primary" /> : <LockOpen className="size-3 text-muted-foreground" />}{fmtBytes(last?.update_bytes)}
          </div>
          <div className="text-[11px] text-success">0 patient rows sent</div>
        </div>
      </div>
    </div>
  );
}

function Curve({ st }) {
  const central = st.setup?.central_reference;
  if (!st.curve.length) return <p className="text-sm text-muted-foreground">The learning curve appears after the first validation.</p>;
  return (
    <div data-testid="fl-curve">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={st.curve} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="round" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} allowDecimals={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} unit="%" />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)' }}
                   formatter={(v, n) => [`${v}%`, n]} labelFormatter={(r) => `Round ${r}`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {central && (
            <ReferenceLine y={+(central.accuracy * 100).toFixed(1)} stroke="var(--muted-foreground)" strokeDasharray="5 4"
                           label={{ value: `trained centrally: ${pct1(central.accuracy)}`, position: 'insideBottomRight', fontSize: 10, fill: 'var(--muted-foreground)' }} />
          )}
          <Line type="monotone" dataKey="accuracy" name="Federated accuracy" stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="macroF1" name="Macro-F1" stroke="var(--chart-2)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-muted-foreground">
        Held-out validation split ({st.setup?.validation_rows} rows) after each round. The dashed line is the same network trained with all rows in one place.
      </p>
    </div>
  );
}

function RecallTable({ st }) {
  const last = st.curve[st.curve.length - 1];
  if (!last?.recall || !Object.keys(last.recall).length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="fl-recall">
      {CLASSES.map((c) => (
        <div key={c} className="rounded-lg bg-muted/50 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: conditionColor(c) }} />{conditionLabel(c)} found
          </div>
          <div className="font-mono text-base text-foreground">{pct1(last.recall[c])}</div>
        </div>
      ))}
    </div>
  );
}

// A labelled group of radio options, one per choice.
function Choice({ name, options, value, onChange }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-xs font-medium text-foreground">{name}</legend>
      {Object.entries(options).map(([key, o]) => (
        <label key={key} className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 text-sm transition-colors ${value === key ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}>
          <input type="radio" className="mt-1 accent-[var(--primary)]" name={name} value={key} checked={value === key} onChange={() => onChange(key)} />
          <span><span className="font-medium text-foreground">{o.label}</span><span className="block text-xs text-muted-foreground">{o.hint}</span></span>
        </label>
      ))}
    </fieldset>
  );
}

function Controls({ onStart, busy, disabled }) {
  const [split, setSplit] = useState('iid');
  const [start, setStart] = useState('scratch');
  const [encryption, setEncryption] = useState('none');
  const [rounds, setRounds] = useState(10);
  const estimate = STARTUP_SECONDS + rounds * ENCRYPTION[encryption].perRound;
  return (
    <div className="space-y-4" data-testid="fl-controls">
      <div className="grid gap-4 lg:grid-cols-3">
        <Choice name="How the data is split" options={SPLITS} value={split} onChange={setSplit} />
        <Choice name="Starting point" options={STARTS} value={start} onChange={setStart} />
        <Choice name="Encryption of updates" options={ENCRYPTION} value={encryption} onChange={setEncryption} />
      </div>
      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
        <label className="text-xs font-medium text-foreground">
          Rounds
          <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} data-testid="fl-rounds"
                  className="mt-1 block h-9 rounded-lg border border-input bg-transparent px-2 text-sm">
            {[1, 3, 5, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <Button className="h-9" disabled={busy || disabled} data-testid="fl-start" title="Starts a demonstration run; the real model is not changed"
                onClick={() => onStart({ split, start, encryption, rounds })}>
          <Play /> {busy ? 'Starting…' : 'Start demo run'}
        </Button>
        <span className="text-xs text-muted-foreground">About {fmtDuration(estimate)} on this server. The model doctors use is not changed.</span>
      </div>
    </div>
  );
}

export default function LiveFederation() {
  const { can } = useAuth();
  const canRun = can('model:register');
  const [overview, setOverview] = useState(null);
  const [runId, setRunId] = useState(null);
  const [events, setEvents] = useState([]);
  const [runMeta, setRunMeta] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const next = useRef(0);
  const logBox = useRef(null);

  const loadOverview = useCallback(() => api.get('/model-health/federation').then((o) => {
    setOverview(o);
    // Follow the active run, else show the latest finished one.
    setRunId((cur) => cur || o.active?.id || o.recent?.[0]?.id || null);
    return o;
  }).catch((e) => setErr(e.message)), []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  // Reset the stream when a different run is chosen.
  useEffect(() => { next.current = 0; setEvents([]); setRunMeta(null); }, [runId]);

  // Poll the chosen run's events: every second while running, once otherwise.
  useEffect(() => {
    if (!runId) return undefined;
    let stopped = false;
    let timer;
    const tick = async () => {
      try {
        const r = await api.get(`/model-health/federation/runs/${runId}/events?after=${next.current}`);
        if (stopped) return;
        next.current = r.next;
        if (r.events.length) setEvents((prev) => [...prev, ...r.events]);
        setRunMeta(r.run);
        if (r.run.status === 'running') timer = setTimeout(tick, 1000);
        else loadOverview();
      } catch (e) {
        if (!stopped) { setErr(e.message); timer = setTimeout(tick, 3000); }
      }
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [runId, loadOverview]);

  // While nothing is selected, notice a run started from another browser.
  useEffect(() => {
    if (runMeta?.status === 'running') return undefined;
    const t = setInterval(() => loadOverview().then((o) => {
      if (o?.active && o.active.id !== runId) setRunId(o.active.id);
    }), 5000);
    return () => clearInterval(t);
  }, [runMeta?.status, runId, loadOverview]);

  const st = useMemo(() => reduce(events), [events]);
  // Keep the newest step in view by scrolling the log box only (never the page),
  // and only when the reader is already at the bottom of it.
  useEffect(() => {
    const box = logBox.current;
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 80) box.scrollTop = box.scrollHeight;
  }, [st.log.length]);

  async function startRun(settings) {
    setBusy(true); setErr('');
    try {
      const run = await api.post('/model-health/federation/runs', settings);
      setRunId(run.id);
      loadOverview();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function stopRun() {
    try { await api.post(`/model-health/federation/runs/${runId}/stop`, {}); } catch (e) { setErr(e.message); }
  }

  const running = runMeta?.status === 'running';
  const settings = runMeta?.settings || st.settings;
  const lastAcc = st.curve[st.curve.length - 1];
  const firstAcc = st.curve[0];
  const unavailable = overview && !overview.available?.ok;

  return (
    <div className="space-y-5">
      <Alert className="border-warning/40 bg-warning/5" data-testid="fl-demo-notice">
        <ShieldCheck className="text-warning" />
        <AlertTitle>Demonstration only: does not affect the real model</AlertTitle>
        <AlertDescription>
          Runs here never change the model doctors use: nothing is saved, registered or deployed, and each run checks
          that the deployed model files are byte-for-byte unchanged. Real federated training will run on lab devices.
        </AlertDescription>
      </Alert>
      <Alert className="border-primary/30 bg-primary/5">
        <Info className="text-primary" />
        <AlertDescription>
          A real federated training run, streamed as it happens. Five simulated labs each keep their own share of the
          2,240 training rows; each round they train the shared network locally and send back only the weights. The
          labs run as separate parts of one program on this server; the data split, the training, the averaging and
          the encryption are real.
        </AlertDescription>
      </Alert>

      {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
      {unavailable && (
        <Alert className="border-warning/40"><AlertDescription>
          {overview.available.disabled
            ? 'The federated demonstration is turned off on this server.'
            : `Live runs are not available on this server (missing: ${overview.available.missing.join(', ')}).`} Recorded runs can still be replayed.
        </AlertDescription></Alert>
      )}

      {canRun && !running && (
        <Card>
          <CardHeader><CardTitle>Start a demonstration run</CardTitle></CardHeader>
          <CardContent><Controls onStart={startRun} busy={busy} disabled={unavailable || !!overview?.active} /></CardContent>
        </Card>
      )}

      {!runId && !canRun && (
        <p className="text-sm text-muted-foreground" data-testid="fl-empty">No federated run yet. An administrator can start one; it will appear here live.</p>
      )}

      {runId && (
        <>
          <Card>
            <CardHeader className="flex-col items-start gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {running ? 'Federated run in progress' : st.done ? 'Federated run finished' : runMeta ? `Federated run ${runMeta.status}` : 'Loading run…'}
                {running && <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-70" /><span className="relative inline-flex size-2.5 rounded-full bg-success" /></span>}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {settings && (
                  <span className="text-xs text-muted-foreground" data-testid="fl-settings">
                    {SPLITS[settings.split]?.label} · {STARTS[settings.start]?.label} · {ENCRYPTION[settings.encryption]?.label === 'None' ? 'no encryption' : ENCRYPTION[settings.encryption]?.label} · {settings.rounds} rounds
                  </span>
                )}
                {running && canRun && <Button variant="outline" size="sm" className="h-8" onClick={stopRun} data-testid="fl-stop"><Square /> Stop</Button>}
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" data-testid="fl-status">
                <span><span className="text-muted-foreground">Round </span><span className="font-mono text-foreground">{st.round} / {st.setup?.rounds ?? settings?.rounds ?? '—'}</span></span>
                <span><span className="text-muted-foreground">Accuracy </span><span className="font-mono text-foreground">{lastAcc ? `${lastAcc.accuracy}%` : '—'}</span>
                  {firstAcc && lastAcc && lastAcc.round > 0 && <span className="text-xs text-muted-foreground"> (from {firstAcc.accuracy}%)</span>}</span>
                <span><span className="text-muted-foreground">Exchanged </span><span className="font-mono text-foreground">{fmtBytes(st.exchanged)}</span> of weights</span>
                <span className="text-success"><ShieldCheck className="mr-1 inline size-4" />0 patient rows left any lab</span>
              </div>
              {running && st.setup == null && <p className="mb-3 text-sm text-muted-foreground" role="status">Starting the training program and loading the data (about {STARTUP_SECONDS} s)…</p>}
              {st.error && <Alert variant="destructive" className="mb-3"><AlertDescription>{st.error}</AlertDescription></Alert>}
              <div className="grid items-start gap-5 lg:grid-cols-[1.15fr_1fr]">
                <FederationDiagram st={st} />
                <Curve st={st} />
              </div>
            </CardContent>
          </Card>

          {st.done && (
            <Card data-testid="fl-summary">
              <CardHeader><CardTitle>What this run showed</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-foreground">
                  The federated network reached <strong>{pct1(st.done.final.accuracy)}</strong> validation accuracy after {st.done.rounds} rounds
                  {firstAcc ? `, up from ${firstAcc.accuracy}% at the start` : ''}. The same network trained with all rows in one place reaches{' '}
                  <strong>{pct1(st.done.central_reference.accuracy)}</strong>.
                  {settings?.split === 'source' && ' With one dataset per lab the labs\' data differ a lot, which is why federated learning struggles here; this is the main open problem the evaluation section discusses.'}
                </p>
                <p className="text-muted-foreground">
                  The labs exchanged {fmtBytes(st.exchanged)} of model weights and no patient records.
                  {st.lastAggregate?.encrypted ? ' Every update was encrypted, and the encrypted sum matched plain averaging exactly.' : ''}
                  {' '}Run time {fmtDuration(st.done.seconds)}. This run was not deployed{st.done.model_files_unchanged ? `, and all ${st.done.model_files_checked} deployed model files were verified unchanged` : ''}.
                </p>
                <RecallTable st={st} />
              </CardContent>
            </Card>
          )}

          <div className="grid items-start gap-5 xl:grid-cols-[1.5fr_1fr]">
            <Card>
              <CardHeader><CardTitle>Labs</CardTitle></CardHeader>
              <CardContent>
                {!st.setup && <p className="text-sm text-muted-foreground">Waiting for the labs…</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  {(st.setup?.labs || []).map((lab, i) => (
                    <LabCard key={lab.id} lab={st.labs[lab.id] || lab} index={i} encrypted={!!st.setup?.encrypted} />
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>What is happening</CardTitle></CardHeader>
              <CardContent>
                <ol ref={logBox} className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1 text-xs" data-testid="fl-log" aria-live="polite">
                  {st.log.map((item) => (
                    <li key={item.e.seq} className="flex gap-2">
                      <ArrowRight className="mt-0.5 size-3 shrink-0 text-primary" />
                      <span className="text-foreground">{item.text}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {overview?.recent?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4 text-primary" /> Recent runs</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm" data-testid="fl-recent">
              {overview.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 text-foreground">
                    {SPLITS[r.settings?.split]?.label} · {STARTS[r.settings?.start]?.label} · {r.settings?.encryption === 'none' ? 'plain' : r.settings?.encryption} · {r.settings?.rounds} rounds
                    <span className="block text-xs text-muted-foreground">
                      {r.status}{r.progress?.accuracy != null ? ` · final accuracy ${pct1(r.progress.accuracy)}` : ''} · {relativeTime(r.startedAt)}
                    </span>
                  </span>
                  <Button variant={r.id === runId ? 'secondary' : 'outline'} size="sm" className="h-8" onClick={() => setRunId(r.id)} disabled={r.id === runId}>
                    {r.id === runId ? 'Showing' : 'Replay'}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
