// backend/src/services/labTelemetry.js
// ---------------------------------------------------------------------------
// What the Lab Node dashboard (GET /lab/dashboard) shows about one lab's
// federated-learning node: is it live, how much data it has sent, how it took
// part in training rounds, and the quality of what it ingested.
//
// TODAY this is SAMPLE data: nothing reports from a lab yet, so every figure is
// generated here, deterministically per lab (same lab -> same numbers, different
// labs differ) and always labelled `source: 'sample'` so the UI shows a
// "Sample data" badge. Only the `lab` identity block in the route response is real.
//
// THE SEAM for deployment: when the Dockerized Flower client (Module 4) starts
// reporting, replace `sampleLabTelemetry` with a function that reads those
// reports and returns the SAME shape with `source: 'live'`. The route and the
// frontend need no other change. The shape is the contract:
//
//   node        { status: online|degraded|offline, last_heartbeat_at, started_at,
//                 uptime_30d_pct, client_version, container_state,
//                 encryption {scheme, key_bits, key_loaded, transport},
//                 heartbeats_24h [{ at, up }] (48 half-hour slots, oldest first) }
//   data        { reports_total, reports_24h, reports_7d, reports_30d, last_report_at,
//                 by_day [{ day, count }] (30), by_source [{ source, count }],
//                 by_condition [{ condition, count }],
//                 quality { accepted_pct, flagged [{ reason, count }] } }
//   federation  { current_round, total_rounds, rounds_participated, last_round_sent,
//                 last_update_sent_at, local_train_rows,
//                 recent_rounds [{ round, sent_at, samples, payload_kb, duration_s,
//                                  status: aggregated|late|failed }] (newest first) }
//   events      [{ at, level: info|warn|error, message }] (newest first)
//
// Aggregates only: no patient rows, refs or names ever appear here.
// ---------------------------------------------------------------------------
const { CLASSES } = require('../contract');

const STATES = ['online', 'degraded', 'offline'];
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TOTAL_ROUNDS = 20; // matches the imported federated runs (Module 4 default)

// FNV-1a: stable string -> uint32 so a lab always gets the same sample numbers.
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// mulberry32: small seeded PRNG (the sample must not change between page loads).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms) => new Date(ms).toISOString();
const between = (r, lo, hi) => lo + r() * (hi - lo);

/** Split `total` across `weights` so the parts are whole numbers that sum to `total`. */
function split(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  parts[0] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

/**
 * @param {object} lab           a labs row ({ id, name, fl_client_id, created_at, ... })
 * @param {object} [opts]
 * @param {number} [opts.now]    epoch ms (injectable for tests)
 * @param {string} [opts.simulate]  'online' | 'degraded' | 'offline', to demo each state
 * @returns the telemetry object documented in the file header
 */
function sampleLabTelemetry(lab, { now = Date.now(), simulate } = {}) {
  const state = STATES.includes(simulate) ? simulate : 'online';
  const r = rng(hash(String(lab.id || lab.fl_client_id || lab.name)));
  const size = between(r, 0.6, 1.5); // how busy this lab is

  // --- node ---------------------------------------------------------------
  const sinceHeartbeat = state === 'online' ? between(r, 3, 25) * 1000
    : state === 'degraded' ? between(r, 4, 9) * MIN
      : between(r, 3, 9) * HOUR;
  const lastHeartbeat = now - sinceHeartbeat;

  // 48 half-hour slots, oldest first. Online loses at most one slot; degraded drops a few
  // scattered ones; offline is down for everything since the last heartbeat.
  // Own PRNG for these so the lab's history below is identical whichever state is simulated.
  const slots = rng(hash(String(lab.id || lab.name)) ^ 0x9e3779b9);
  const downScattered = state === 'online' ? (slots() < 0.3 ? [Math.floor(slots() * 40)] : [])
    : state === 'degraded' ? [5 + Math.floor(slots() * 8), 20 + Math.floor(slots() * 6), 36 + Math.floor(slots() * 8)] : [];
  const heartbeats = Array.from({ length: 48 }, (_, i) => {
    const at = now - (47 - i) * 30 * MIN;
    // A slot is the 30 minutes ending at `at`; it is up if a heartbeat landed inside it.
    const up = !downScattered.includes(i) && lastHeartbeat > at - 30 * MIN;
    return { at: iso(at), up };
  });
  const uptime = state === 'online' ? between(r, 99.0, 99.9) : state === 'degraded' ? between(r, 93.5, 97.5) : between(r, 71, 86);

  const node = {
    status: state,
    last_heartbeat_at: iso(lastHeartbeat),
    started_at: iso(now - Math.round(between(r, 6, 28) * DAY)),
    uptime_30d_pct: +uptime.toFixed(1),
    client_version: 'fedhealth-fl-client 0.4.1',
    container_state: state === 'offline' ? 'unreachable' : 'running',
    encryption: { scheme: 'paillier', key_bits: 2048, key_loaded: state !== 'offline', transport: 'TLS' },
    heartbeats_24h: heartbeats,
  };

  // --- data sent ----------------------------------------------------------
  const by_day = Array.from({ length: 30 }, (_, i) => {
    const at = now - (29 - i) * DAY;
    const weekend = [0, 6].includes(new Date(at).getUTCDay());
    let count = Math.round(size * (weekend ? between(r, 6, 14) : between(r, 22, 44)));
    if (state === 'offline' && i === 29) count = 0;
    return { day: iso(at).slice(0, 10), count };
  });
  const reports30 = by_day.reduce((s, d) => s + d.count, 0);
  const priorReports = Math.round(size * between(r, 500, 1400)); // before the 30-day window
  const reportsTotal = reports30 + priorReports;
  const sinceReport = state === 'online' ? between(r, 1, 14) * MIN : state === 'degraded' ? between(r, 25, 90) * MIN : sinceHeartbeat + between(r, 1, 20) * MIN;

  const [lims, manual, ocr] = split(reports30, [70 + r() * 8, 18 + r() * 6, 6 + r() * 5]);
  const mix = split(reports30, [48 + r() * 12, 26 + r() * 8, 6 + r() * 6, 1.5 + r() * 2.5]);
  const flaggedWeights = [['Unit not printed on the report', 5 + r() * 4], ['Value outside plausible range', 2 + r() * 3],
    ['Red-cell indices inconsistent (HGB, HCT, RBC)', 2 + r() * 3], ['Duplicate patient reference', 1 + r() * 2]];
  const flaggedTotal = Math.round(reports30 * between(r, 0.012, 0.045));
  const flagged = split(flaggedTotal, flaggedWeights.map(([, w]) => w)).map((count, i) => ({ reason: flaggedWeights[i][0], count }));

  const data = {
    reports_total: reportsTotal,
    reports_24h: by_day[29].count,
    reports_7d: by_day.slice(23).reduce((s, d) => s + d.count, 0),
    reports_30d: reports30,
    last_report_at: iso(now - sinceReport),
    by_day,
    by_source: [{ source: 'lims', count: lims }, { source: 'manual', count: manual }, { source: 'ocr', count: ocr }],
    by_condition: CLASSES.map((condition, i) => ({ condition, count: mix[i] ?? 0 })),
    quality: { accepted_pct: +(100 * (1 - flaggedTotal / Math.max(1, reports30))).toFixed(1), flagged },
  };

  // --- federated rounds ---------------------------------------------------
  const lastRoundSent = state === 'online' ? TOTAL_ROUNDS : state === 'degraded' ? TOTAL_ROUNDS - 1 : TOTAL_ROUNDS - 6;
  const trainRows = Math.round(size * between(r, 520, 980));
  const sinceUpdate = state === 'online' ? between(r, 8, 35) * MIN : state === 'degraded' ? between(r, 70, 140) * MIN : sinceHeartbeat + between(r, 20, 70) * MIN;
  const recent_rounds = Array.from({ length: Math.min(8, lastRoundSent) }, (_, i) => {
    const round = lastRoundSent - i;
    let status = 'aggregated';
    if (state === 'degraded' && (i === 0 || i === 5)) status = 'late';
    if (state === 'offline' && i === 0) status = 'failed';
    return {
      round,
      sent_at: iso(now - sinceUpdate - i * between(r, 38, 52) * MIN),
      samples: trainRows,
      payload_kb: Math.round(between(r, 860, 940)),
      duration_s: Math.round(status === 'late' ? between(r, 150, 210) : between(r, 38, 95)),
      status,
    };
  });
  const federation = {
    current_round: TOTAL_ROUNDS,
    total_rounds: TOTAL_ROUNDS,
    rounds_participated: state === 'online' ? TOTAL_ROUNDS : state === 'degraded' ? TOTAL_ROUNDS - 2 : TOTAL_ROUNDS - 7,
    last_round_sent: lastRoundSent,
    last_update_sent_at: iso(now - sinceUpdate),
    local_train_rows: trainRows,
    recent_rounds,
  };

  // --- activity log -------------------------------------------------------
  const last = recent_rounds[0];
  const events = [];
  if (state === 'online') {
    events.push(
      { at: node.last_heartbeat_at, level: 'info', message: 'Heartbeat received' },
      { at: federation.last_update_sent_at, level: 'info', message: `Round ${last.round}: encrypted update sent and aggregated (${last.samples} local rows)` },
      { at: iso(now - sinceReport), level: 'info', message: 'Report batch ingested from the LIMS' },
    );
  } else if (state === 'degraded') {
    events.push(
      { at: node.last_heartbeat_at, level: 'warn', message: 'Heartbeat resumed after a 22 min gap' },
      { at: iso(lastHeartbeat - 22 * MIN), level: 'warn', message: 'Heartbeat missed (3 consecutive)' },
      { at: federation.last_update_sent_at, level: 'warn', message: `Round ${last.round}: update arrived after the round deadline and was held for the next aggregation` },
    );
  } else {
    events.push(
      { at: iso(lastHeartbeat + 5 * MIN), level: 'error', message: 'Node marked offline: no heartbeat for over 2 hours' },
      { at: node.last_heartbeat_at, level: 'warn', message: 'Last heartbeat received' },
      { at: federation.last_update_sent_at, level: 'error', message: `Round ${last.round}: update upload failed (connection reset)` },
    );
  }
  events.push(
    { at: iso(now - DAY - between(r, 1, 6) * HOUR), level: 'info', message: 'Local validation completed: ' + `${data.quality.accepted_pct}% of the last 30 days of reports accepted` },
    { at: iso(now - 2 * DAY - between(r, 1, 6) * HOUR), level: 'info', message: 'Paillier public key refreshed (2048-bit)' },
    { at: iso(now - 3 * DAY - between(r, 1, 6) * HOUR), level: 'info', message: 'Node authenticated with the aggregation server' },
  );
  events.sort((a, b) => b.at.localeCompare(a.at));

  return { source: 'sample', generated_at: iso(now), simulated_state: STATES.includes(simulate) ? simulate : null, node, data, federation, events };
}

module.exports = { sampleLabTelemetry, STATES };
