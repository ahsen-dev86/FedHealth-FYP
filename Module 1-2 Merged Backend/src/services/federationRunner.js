// backend/src/services/federationRunner.js
// ---------------------------------------------------------------------------
// Runs the live federated-learning demonstration (Module 4 FL/live_federation.py)
// as a child process and keeps its event stream for the Model Health
// "Federated training (live)" tab.
//
//   * One run at a time. Arguments come only from fixed choices (no shell, no
//     free text), so a request cannot inject a command.
//   * Every "@@FL {json}" line the script prints becomes an event; other
//     output is kept as a short log tail for error reports.
//   * Events are also appended to run-results/federation/<id>.jsonl, so the
//     last runs survive a backend restart and can be replayed.
//   * A run is a demonstration: it never registers or activates a model.
// ---------------------------------------------------------------------------
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { federation } = require('../config');

const CHOICES = {
  split: { iid: 'iid', source: 'source' },
  start: { scratch: 'scratch', deployed: 'deployed' },
  encryption: { none: null, 'paillier-1024': 1024, 'paillier-2048': 2048 },
};
const MAX_ROUNDS = 30;
const KEEP_RUNS = 10;

const runs = new Map(); // id -> run (newest last)
let active = null;

const summary = (run) => run && ({
  id: run.id, status: run.status, settings: run.settings, startedAt: run.startedAt, endedAt: run.endedAt,
  startedBy: run.startedBy, events: run.events.length, error: run.error,
  progress: run.progress,
});

function available() {
  const missing = [];
  if (!fs.existsSync(federation.python) && !/^python3?$/.test(federation.python)) missing.push('Python environment');
  if (!fs.existsSync(federation.script)) missing.push('live_federation.py');
  if (!fs.existsSync(path.join(federation.modelDir, 'preprocessor.joblib'))) missing.push('model bundle');
  return { ok: missing.length === 0, missing };
}

/** Validate a start request against the fixed choices. */
function parseSettings(body = {}) {
  const split = body.split ?? 'iid';
  const start = body.start ?? 'scratch';
  const encryption = body.encryption ?? 'none';
  const rounds = Number(body.rounds ?? 10);
  if (!(split in CHOICES.split)) throw Object.assign(new Error('split must be iid or source'), { status: 400 });
  if (!(start in CHOICES.start)) throw Object.assign(new Error('start must be scratch or deployed'), { status: 400 });
  if (!(encryption in CHOICES.encryption)) {
    throw Object.assign(new Error('encryption must be none, paillier-1024 or paillier-2048'), { status: 400 });
  }
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
    throw Object.assign(new Error(`rounds must be a whole number from 1 to ${MAX_ROUNDS}`), { status: 400 });
  }
  return { split, start, encryption, rounds, labs: 5 };
}

function persist(run, event) {
  try {
    fs.mkdirSync(federation.eventsDir, { recursive: true });
    fs.appendFileSync(path.join(federation.eventsDir, `${run.id}.jsonl`), `${JSON.stringify(event)}\n`);
  } catch { /* the in-memory copy still serves the dashboard */ }
}

function record(run, event) {
  const seq = run.events.length;
  const withSeq = { seq, ...event };
  run.events.push(withSeq);
  if (event.type === 'round_start') run.progress = { ...run.progress, round: event.round };
  if (event.type === 'validation') run.progress = { ...run.progress, accuracy: event.accuracy, completedRound: event.round };
  if (event.type === 'setup') run.progress = { ...run.progress, rounds: event.rounds };
  persist(run, withSeq);
}

function finish(run, status, error = null) {
  if (run.status !== 'running') return;
  run.status = status;
  run.error = error;
  run.endedAt = new Date().toISOString();
  record(run, { type: 'status', status, error, t: Date.now() / 1000 });
  if (active === run) active = null;
}

/** Start a run; throws 409 while another run is in progress. */
function start(body, actor) {
  if (active) throw Object.assign(new Error('A federated run is already in progress'), { status: 409 });
  const ready = available();
  if (!ready.ok) {
    throw Object.assign(new Error(`Federated demo is not available on this server (missing: ${ready.missing.join(', ')})`), { status: 503 });
  }
  const settings = parseSettings(body);
  const bits = CHOICES.encryption[settings.encryption];
  const args = [federation.script, '--model', federation.modelDir, '--rounds', String(settings.rounds),
    '--labs', String(settings.labs), '--mode', CHOICES.split[settings.split], '--start', CHOICES.start[settings.start]];
  if (bits) args.push('--encrypted', '--bits', String(bits));

  const run = {
    id: crypto.randomUUID(), status: 'running', settings, startedAt: new Date().toISOString(), endedAt: null,
    startedBy: actor?.full_name || actor?.email || null, events: [], error: null, progress: { round: 0 }, logTail: [],
  };
  const child = spawn(federation.python, args, {
    cwd: federation.root,
    env: { ...process.env, TF_CPP_MIN_LOG_LEVEL: '2', TF_ENABLE_ONEDNN_OPTS: '0', PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  run.child = child;
  runs.set(run.id, run);
  while (runs.size > KEEP_RUNS) runs.delete(runs.keys().next().value);
  active = run;
  record(run, { type: 'status', status: 'running', settings, t: Date.now() / 1000 });

  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('@@FL ')) continue;
      try {
        const event = JSON.parse(line.slice(5));
        record(run, event);
        if (event.type === 'done') finish(run, 'finished');
        if (event.type === 'error') finish(run, 'failed', event.message);
      } catch { /* a malformed line is ignored, never fatal */ }
    }
  });
  child.stderr.on('data', (chunk) => {
    run.logTail.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean));
    run.logTail = run.logTail.slice(-40);
  });
  child.on('error', (e) => finish(run, 'failed', `could not start Python: ${e.message}`));
  child.on('exit', (code, signal) => {
    if (run.status === 'running') {
      finish(run, run.stopping ? 'stopped' : 'failed',
        run.stopping ? null : `the training process exited (${signal || `code ${code}`}): ${run.logTail.slice(-3).join(' | ')}`);
    }
    delete run.child;
  });
  return summary(run);
}

function stop(id) {
  const run = runs.get(id);
  if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
  if (run.status !== 'running') return summary(run);
  run.stopping = true;
  run.child?.kill();
  return summary(run);
}

function events(id, after = 0) {
  const run = runs.get(id);
  if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
  const from = Math.max(0, Math.min(Number(after) || 0, run.events.length));
  return { run: summary(run), events: run.events.slice(from), next: run.events.length };
}

function overview() {
  return {
    available: available(),
    active: summary(active),
    recent: [...runs.values()].reverse().map(summary),
    choices: { split: Object.keys(CHOICES.split), start: Object.keys(CHOICES.start), encryption: Object.keys(CHOICES.encryption), maxRounds: MAX_ROUNDS },
  };
}

/** Reload the last runs from disk at startup (read-only replays). */
function loadSaved() {
  try {
    const files = fs.readdirSync(federation.eventsDir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, m: fs.statSync(path.join(federation.eventsDir, f)).mtimeMs }))
      .sort((a, b) => a.m - b.m).slice(-KEEP_RUNS);
    for (const { f } of files) {
      const evts = fs.readFileSync(path.join(federation.eventsDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const first = evts.find((e) => e.type === 'status' && e.settings);
      const last = [...evts].reverse().find((e) => e.type === 'status');
      if (!first) continue;
      const run = {
        id: f.replace(/\.jsonl$/, ''), status: last?.status === 'running' ? 'interrupted' : last?.status || 'interrupted',
        settings: first.settings, startedAt: new Date(first.t * 1000).toISOString(),
        endedAt: last ? new Date(last.t * 1000).toISOString() : null, startedBy: null, events: evts,
        error: last?.error || null, progress: {}, logTail: [],
      };
      for (const e of evts) {
        if (e.type === 'validation') run.progress = { ...run.progress, accuracy: e.accuracy, completedRound: e.round };
        if (e.type === 'setup') run.progress = { ...run.progress, rounds: e.rounds };
      }
      runs.set(run.id, run);
    }
  } catch { /* no saved runs yet */ }
}
loadSaved();

/** Stop a running child when the backend shuts down. */
process.once('exit', () => active?.child?.kill());

module.exports = { start, stop, events, overview, parseSettings, MAX_ROUNDS };
