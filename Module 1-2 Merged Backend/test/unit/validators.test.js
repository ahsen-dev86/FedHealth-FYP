// Unit tests: request validators and the inference-response contract check.
const test = require('node:test');
const assert = require('node:assert/strict');
const { reportBody, confirmBody, clusterQuery, registerModelBody } = require('../../src/validators/domain');
const { assertContract } = require('../../src/services/inferenceClient');
const { CLASSES, FEATURES } = require('../../src/contract');

test('confirm accepts only the four classes', () => {
  for (const c of CLASSES) assert.equal(confirmBody.parse({ confirmedCondition: c }).confirmedCondition, c);
  for (const old of ['iron_deficiency_anemia', 'beta_thal_trait', 'thrombocytopenia', 'Anemia']) {
    assert.throws(() => confirmBody.parse({ confirmedCondition: old }));
  }
});

test('NIH cluster filter accepts only the four classes', () => {
  assert.equal(clusterQuery.parse({ condition: 'leukemia' }).condition, 'leukemia');
  assert.throws(() => clusterQuery.parse({ condition: 'macrocytic_anemia' }));
});

test('report body rejects unknown top-level fields and bad context values', () => {
  const ok = { patientRef: 'FH-0000-0000', cbc: { HGB: 12.4 }, units: { HGB: 'g/dL' }, sex: 'F', ageYears: 30 };
  assert.ok(reportBody.parse(ok));
  assert.throws(() => reportBody.parse({ ...ok, diagnosis: 'anemia' }));
  assert.throws(() => reportBody.parse({ ...ok, ageYears: 131 }));
  assert.throws(() => reportBody.parse({ ...ok, sex: 'female' }));
  assert.throws(() => reportBody.parse({ ...ok, model: 'thal_screen' }));
});

test('cbc_multiclass registration must use the four classes in order', () => {
  const base = { name: 'cbc_multiclass', version: 'v', classes: CLASSES };
  assert.ok(registerModelBody.parse(base));
  assert.throws(() => registerModelBody.parse({ ...base, classes: [...CLASSES].reverse() }));
});

const served = {
  classes: CLASSES, features: FEATURES,
  scores: { anemia: 0.588, healthy: 0.224, leukemia: 0.019, thalassemia: 0.169 }, // Flask sorts keys
  canonical_cbc: { WBC: 9.01, PLT: 147 },
};

test('inference response: class order from `classes`, scores re-keyed in that order', () => {
  const out = assertContract(served, { WBC: 9.01, PLT: 147 });
  assert.deepEqual(Object.keys(out.scores), CLASSES);
});

test('inference response: wrong classes or unit-conversion drift is a 502', () => {
  const bad = (inf, expected) => assert.throws(() => assertContract(inf, expected), (e) => e.status === 502);
  bad({ ...served, classes: [...CLASSES].reverse() });
  bad({ ...served, scores: { healthy: 1, iron_deficiency_anemia: 0 } });
  bad({ ...served, features: [...FEATURES].reverse() });
  bad(served, { WBC: 9010 });
});
