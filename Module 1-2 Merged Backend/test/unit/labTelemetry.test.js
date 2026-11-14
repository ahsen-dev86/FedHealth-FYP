// Unit tests: Lab Node dashboard sample telemetry + lab-engineer registration rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleLabTelemetry, STATES } = require('../../src/services/labTelemetry');
const { registerSchema } = require('../../src/auth/validators');
const { CLASSES } = require('../../src/contract');

const LAB_A = { id: '11111111-1111-4111-8111-111111111111', name: 'Lab A', fl_client_id: 'lab-a' };
const LAB_B = { id: '22222222-2222-4222-8222-222222222222', name: 'Lab B', fl_client_id: 'lab-b' };
const NOW = Date.parse('2026-10-04T12:00:00Z');
const sum = (rows, key = 'count') => rows.reduce((s, r) => s + r[key], 0);

test('sample telemetry is labelled sample and deterministic per lab', () => {
  const a1 = sampleLabTelemetry(LAB_A, { now: NOW });
  const a2 = sampleLabTelemetry(LAB_A, { now: NOW });
  const b = sampleLabTelemetry(LAB_B, { now: NOW });
  assert.equal(a1.source, 'sample');
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1.data.by_day, b.data.by_day); // labs differ from each other
});

test('totals are internally consistent', () => {
  const t = sampleLabTelemetry(LAB_A, { now: NOW });
  assert.equal(t.data.by_day.length, 30);
  assert.equal(sum(t.data.by_day), t.data.reports_30d);
  assert.equal(sum(t.data.by_source), t.data.reports_30d);
  assert.equal(sum(t.data.by_condition), t.data.reports_30d);
  assert.deepEqual(t.data.by_condition.map((c) => c.condition), CLASSES);
  assert.equal(sum(t.data.by_day.slice(23)), t.data.reports_7d);
  assert.equal(t.data.reports_24h, t.data.by_day[29].count);
  assert.ok(t.data.reports_total >= t.data.reports_30d);
  assert.equal(t.node.heartbeats_24h.length, 48);
  assert.ok(t.data.quality.accepted_pct > 90 && t.data.quality.accepted_pct <= 100);
  assert.equal(t.federation.recent_rounds.length, 8);
  assert.ok(t.federation.recent_rounds.every((r, i, all) => i === 0 || r.round === all[i - 1].round - 1));
});

test('simulate switches the node state without changing the lab\'s history', () => {
  const by = Object.fromEntries(STATES.map((s) => [s, sampleLabTelemetry(LAB_A, { now: NOW, simulate: s })]));
  assert.deepEqual(STATES, ['online', 'degraded', 'offline']);
  for (const s of STATES) assert.equal(by[s].node.status, s);

  const age = (iso) => NOW - Date.parse(iso);
  assert.ok(age(by.online.node.last_heartbeat_at) < 60 * 1000);
  assert.ok(age(by.degraded.node.last_heartbeat_at) > 3 * 60 * 1000 && age(by.degraded.node.last_heartbeat_at) < 15 * 60 * 1000);
  assert.ok(age(by.offline.node.last_heartbeat_at) > 2 * 3600 * 1000);

  assert.equal(by.online.federation.recent_rounds[0].status, 'aggregated');
  assert.equal(by.degraded.federation.recent_rounds[0].status, 'late');
  assert.equal(by.offline.federation.recent_rounds[0].status, 'failed');
  assert.ok(by.offline.federation.last_round_sent < by.offline.federation.current_round);
  assert.equal(by.offline.node.heartbeats_24h.at(-1).up, false);
  assert.equal(by.online.node.heartbeats_24h.at(-1).up, true);
  assert.equal(by.offline.data.reports_24h, 0);

  // same lab, same sizing: only the live state differs
  assert.equal(by.online.federation.local_train_rows, by.offline.federation.local_train_rows);
  assert.deepEqual(by.online.data.by_day.slice(0, 29), by.offline.data.by_day.slice(0, 29));
  // an unknown state falls back to online rather than throwing
  assert.equal(sampleLabTelemetry(LAB_A, { now: NOW, simulate: 'bogus' }).node.status, 'online');
});

test('telemetry carries aggregates only: no patient identifiers anywhere', () => {
  const text = JSON.stringify(sampleLabTelemetry(LAB_A, { now: NOW }));
  assert.doesNotMatch(text, /patient_ref|cnic|"phone|"email|"cbc"|"sex"|"age/i);
});

test('registering as a lab engineer requires a lab', () => {
  const base = { email: 'eng@lab.pk', password: 'long-enough-1', fullName: 'Lab Engineer', role: 'lab_tech' };
  assert.throws(() => registerSchema.parse(base), /Choose the lab/);
  assert.ok(registerSchema.parse({ ...base, labId: LAB_A.id }));
  assert.ok(registerSchema.parse({ ...base, role: 'doctor' })); // other roles are unaffected
});
