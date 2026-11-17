// DEMO-ONLY: the "Federated training (live)" tab without a backend.
// Replays real runs of Module 4 FL/live_federation.py (5 labs, from scratch,
// seed 42, measured 2026-11-17) at demo speed. The live server runs the
// training for real; nothing here is computed.
import { CLASSES } from '../lib/contract.js';

// Validation accuracy per round (round 0 = untrained network) of the recorded runs.
const RECORDED = {
  iid: [0.25, 0.769, 0.804, 0.802, 0.812, 0.823, 0.827, 0.833, 0.840],
  source: [0.25, 0.519, 0.508, 0.506, 0.506, 0.517, 0.531, 0.531, 0.540, 0.546, 0.546],
};
const even = { healthy: 112, anemia: 112, thalassemia: 112, leukemia: 112 };
// Real training rows per source dataset (Dataset/fedhealth_cbc_4class_provenance.csv).
const LABS = {
  iid: [0, 1, 2, 3, 4].map((i) => ({
    id: `lab-0${i}`, name: `Lab ${i + 1}`, data: '5 sources (even split)', rows: 448, class_counts: even,
  })),
  source: [
    ['Kaggle anaemia dataset', 557, { healthy: 107, anemia: 413, thalassemia: 0, leukemia: 37 }],
    ['LetsLive dataset', 111, { healthy: 0, anemia: 0, thalassemia: 111, leukemia: 0 }],
    ['LeukoAlert dataset', 953, { healthy: 283, anemia: 147, thalassemia: 0, leukemia: 523 }],
    ['Mendeley thalassaemia dataset', 184, { healthy: 0, anemia: 0, thalassemia: 184, leukemia: 0 }],
    ['Plenoi dataset', 435, { healthy: 170, anemia: 0, thalassemia: 265, leukemia: 0 }],
  ].map(([data, rows, class_counts], i) => ({ id: `lab-0${i}`, name: `Lab ${i + 1}`, data, rows, class_counts })),
};
const CENTRAL = { accuracy: 0.8667, macro_f1: 0.866, log_loss: 0.381, sick_called_healthy: 28, per_class_recall: {} };

const runs = [];
let active = null;

function schedule(settings) {
  const curve = RECORDED[settings.split] || RECORDED.iid;
  const labs = LABS[settings.split] || LABS.iid;
  const enc = settings.encryption !== 'none';
  // Measured update sizes: 11.7 KB plain, 1.8 MB at 1024-bit, 3.6 MB at 2048-bit.
  const bytes = !enc ? 11664 : settings.encryption === 'paillier-1024' ? 1829200 : 3626600;
  const acc = (r) => curve[Math.min(r, curve.length - 1)];
  const val = (r) => ({
    type: 'validation', round: r, accuracy: acc(r), macro_f1: Math.max(0, acc(r) - 0.01), log_loss: +(1.39 - acc(r)).toFixed(3),
    sick_called_healthy: 30,
    per_class_recall: Object.fromEntries(CLASSES.map((c, i) => [c, Math.min(0.97, Math.max(0, acc(r) + (i - 1.5) * 0.03))])),
  });
  const out = [];
  let t = 0;
  const at = (ms, e) => { t += ms; out.push({ at: t, ...e }); };
  at(0, { type: 'status', status: 'running', settings });
  if (enc) at(800, { type: 'keys', bits: settings.encryption === 'paillier-1024' ? 1024 : 2048, seconds: 0.1 });
  at(1500, {
    type: 'setup', rounds: settings.rounds, mode: settings.split, start: settings.start, encrypted: enc, labs, parameters: 2916,
    update_bytes_plain: 11664, train_rows: 2240, validation_rows: 480, central_reference: CENTRAL,
  });
  at(300, val(0));
  for (let r = 1; r <= settings.rounds; r += 1) {
    at(400, { type: 'round_start', round: r });
    labs.forEach((lab, i) => {
      at(150, { type: 'lab_receive', round: r, lab: lab.id });
      at(enc ? 900 : 550, {
        type: 'lab_update', round: r, lab: lab.id, rows: lab.rows, local_loss: +Math.max(0.2, 1.2 - acc(r) + i * 0.05).toFixed(3),
        train_seconds: 1.8, encrypt_seconds: !enc ? null : settings.encryption === 'paillier-1024' ? 5 : 36, update_bytes: bytes, patient_rows_sent: 0,
      });
    });
    at(400, {
      type: 'aggregate', round: r, labs: labs.length, total_examples: 2240, seconds: enc ? 12 : 0.01, encrypted: enc,
      ...(enc ? { aggregator_saw_plaintext: false, max_difference_from_plain_fedavg: 0 } : {}),
    });
    at(300, { ...val(r), round_seconds: 10 });
  }
  at(300, {
    type: 'done', rounds: settings.rounds, best_round: settings.rounds, final: val(settings.rounds), central_reference: CENTRAL,
    model_files_unchanged: true, model_files_checked: 6,
    seconds: Math.round(t / 1000), deployed: false,
  });
  at(10, { type: 'status', status: 'finished' });
  return out;
}

// The events of a run that "have happened" by now.
function visible(run) {
  const cutoff = run.stoppedAt ?? (Date.now() - run.started);
  const list = run.events.filter((e) => e.at <= cutoff).map(({ at, ...e }, seq) => ({ seq, t: (run.started + at) / 1000, ...e }));
  if (run.stoppedAt != null) list.push({ seq: list.length, type: 'status', status: 'stopped', t: (run.started + run.stoppedAt) / 1000 });
  const last = [...list].reverse().find((e) => e.type === 'status');
  const status = last?.status || 'running';
  if (status !== 'running' && active === run) active = null;
  const lastVal = [...list].reverse().find((e) => e.type === 'validation');
  return {
    list,
    summary: {
      id: run.id, status, settings: run.settings, startedAt: new Date(run.started).toISOString(), endedAt: null, events: list.length,
      error: null, progress: { accuracy: lastVal?.accuracy, completedRound: lastVal?.round, rounds: run.settings.rounds },
    },
  };
}

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Returns a response for a federation route, or undefined for any other path. */
export function federationRoute({ method, pathname, params, body, session }) {
  if (!pathname.startsWith('/model-health/federation')) return undefined;
  if (!['admin', 'nih_official'].includes(session?.role)) throw fail(403, 'Missing permission(s): nih:dashboard');
  if (pathname === '/model-health/federation' && method === 'GET') {
    if (active) visible(active);
    return {
      demonstrationOnly: true,
      available: { ok: true, missing: [] },
      active: active ? visible(active).summary : null,
      recent: [...runs].reverse().map((r) => visible(r).summary),
      choices: { split: ['iid', 'source'], start: ['scratch', 'deployed'], encryption: ['none', 'paillier-1024', 'paillier-2048'], maxRounds: 30 },
    };
  }
  const ev = pathname.match(/^\/model-health\/federation\/runs\/([^/]+)\/events$/);
  if (ev && method === 'GET') {
    const run = runs.find((r) => r.id === ev[1]);
    if (!run) throw fail(404, 'Run not found');
    const { list, summary } = visible(run);
    const after = Math.max(0, Number(params.get('after')) || 0);
    return { run: summary, events: list.slice(after), next: list.length };
  }
  if (pathname === '/model-health/federation/runs' && method === 'POST') {
    if (session.role !== 'admin') throw fail(403, 'Missing permission(s): model:register');
    if (active) throw fail(409, 'A federated run is already in progress');
    const settings = {
      split: body.split || 'iid', start: body.start || 'scratch', encryption: body.encryption || 'none',
      rounds: Number(body.rounds) || 10, labs: 5,
    };
    const run = { id: crypto.randomUUID(), settings, started: Date.now(), events: schedule(settings), stoppedAt: null };
    runs.push(run);
    active = run;
    return visible(run).summary;
  }
  const stop = pathname.match(/^\/model-health\/federation\/runs\/([^/]+)\/stop$/);
  if (stop && method === 'POST') {
    if (session.role !== 'admin') throw fail(403, 'Missing permission(s): model:register');
    const run = runs.find((r) => r.id === stop[1]);
    if (!run) throw fail(404, 'Run not found');
    if (active === run) { run.stoppedAt = Date.now() - run.started; active = null; }
    return visible(run).summary;
  }
  throw fail(404, `(preview mock) No dummy handler for ${method} ${pathname}`);
}
