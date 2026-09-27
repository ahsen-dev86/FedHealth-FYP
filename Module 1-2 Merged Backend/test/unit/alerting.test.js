// Unit tests: NIH alerting rules on the four classes, with a fake DB client.
const test = require('node:test');
const assert = require('node:assert/strict');
const alerting = require('../../src/services/alerting');
const { alerting: cfg } = require('../../src/config');

// Stand-in for the pg client: answers the cluster COUNT with a fixed number and records any alert INSERT.
function fakeDb(clusterCount) {
  const inserts = [];
  return {
    inserts,
    async query(sql, params) {
      if (/SELECT count\(\*\)/.test(sql)) return { rows: [{ n: clusterCount }] };
      if (/INSERT INTO alerts/.test(sql)) {
        const type = /'high_risk_case'/.test(sql) ? 'high_risk_case' : 'outbreak_cluster';
        const row = type === 'high_risk_case'
          ? { type, prediction_id: params[0], severity: params[1], condition: params[4], payload: JSON.parse(params[9]) }
          : { type, severity: params[0], district: params[3], condition: params[5], dedup_key: params[9] };
        inserts.push(row);
        return { rows: [row] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

const report = { district: 'Lahore', province: 'Punjab', latitude: 31.5, longitude: 74.3 };
const scores = (h, a, t, l) => ({ healthy: h, anemia: a, thalassemia: t, leukemia: l });

test('risk flag raises a leukemia alert even when another class is top', async () => {
  const db = fakeDb(0);
  const created = await alerting.evaluate(report,
    { id: 'p1', risk_flag: true, top_condition: 'healthy', scores: scores(0.503, 0.005, 0.012, 0.48) },
    { riskThreshold: 0.3 }, db);
  assert.equal(created.length, 1);
  assert.equal(created[0].type, 'high_risk_case');
  assert.equal(created[0].condition, 'leukemia');
  assert.equal(created[0].severity, 'medium');
  assert.equal(created[0].payload.confidence, 0.48);
});

test('no alert for an unflagged anemia screen below the cluster threshold', async () => {
  const db = fakeDb(cfg.clusterMinCases - 1);
  const created = await alerting.evaluate(report,
    { id: 'p2', risk_flag: false, top_condition: 'anemia', scores: scores(0.224, 0.588, 0.169, 0.019) }, {}, db);
  assert.deepEqual(created, []);
});

test('cluster alerts use the class name and a per-week dedup key; healthy never clusters', async () => {
  const db = fakeDb(cfg.clusterMinCases);
  const created = await alerting.evaluate(report,
    { id: 'p3', risk_flag: false, top_condition: 'thalassemia', scores: scores(0.1, 0.1, 0.7, 0.1) }, {}, db);
  assert.equal(created.length, 1);
  assert.equal(created[0].condition, 'thalassemia');
  assert.match(created[0].dedup_key, /^outbreak:Lahore:thalassemia:\d{4}-W\d{2}$/);
  const none = await alerting.evaluate(report,
    { id: 'p4', risk_flag: false, top_condition: 'healthy', scores: scores(0.9, 0.05, 0.03, 0.02) }, {}, fakeDb(99));
  assert.deepEqual(none, []);
});

test('severity bands and ISO week labels', () => {
  assert.equal(alerting.severityFor(0.99), 'critical');
  assert.equal(alerting.severityFor(0.6), 'high');
  assert.equal(alerting.severityFor(0.31), 'medium');
  assert.equal(alerting.severityFor(0.1), 'low');
  assert.equal(alerting.isoWeek(new Date('2026-09-26T12:00:00Z')), '2026-W39');
  assert.equal(alerting.isoWeek(new Date('2021-01-01T12:00:00Z')), '2020-W53');
});
