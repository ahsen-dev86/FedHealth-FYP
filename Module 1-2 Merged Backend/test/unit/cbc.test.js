// Unit tests: CBC contract validation and unit conversion (no DB, no services).
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareCbc } = require('../../src/services/cbc');
const { FEATURES, CLASSES, CANONICAL_UNITS, normalizeUnit, unitFactor, contract } = require('../../src/contract');

const REPORT = { WBC: 9010, RBC: 4.47, HGB: 12.4, HCT: 38, MCV: 85, MCH: 28, MCHC: 33, RDW: 13, PLT: 147000, NEUTp: 69 };
const PRINTED = { WBC: '/mm3', RBC: 'mil/mm3', HGB: 'g/dL', HCT: '%', MCV: 'fl', MCH: 'pg', MCHC: 'g/dL', RDW: '%', PLT: '/mm3', NEUTp: '%' };

const rejects = (args, pattern) => assert.throws(() => prepareCbc(args), (e) => e.status === 400 && pattern.test(e.message));

test('contract order is the Module 3 schema order', () => {
  assert.deepEqual(FEATURES, ['WBC', 'RBC', 'HGB', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW', 'PLT', 'NEUTp']);
  assert.deepEqual(CLASSES, ['healthy', 'anemia', 'thalassemia', 'leukemia']);
  assert.equal(contract.generated_by, 'tools/export_contract.py');
});

test('example report with printed units converts to canonical values', () => {
  const { canonical, reported, units } = prepareCbc({ cbc: REPORT, units: PRINTED });
  assert.equal(canonical.WBC, 9.01);
  assert.equal(canonical.PLT, 147);
  assert.equal(canonical.RBC, 4.47);
  assert.deepEqual(Object.keys(canonical), FEATURES);
  assert.equal(reported.WBC, 9010);
  assert.equal(units.PLT, '/mm3');
});

test('canonicalUnits: true accepts canonical values as they are', () => {
  const { canonical, units } = prepareCbc({ cbc: { HGB: 12.4, PLT: 147 }, canonicalUnits: true });
  assert.deepEqual(canonical, { HGB: 12.4, PLT: 147 });
  assert.equal(units.PLT, CANONICAL_UNITS.PLT);
});

test('missing values are left out (median-imputed later), not stored as null', () => {
  const { canonical } = prepareCbc({ cbc: { HGB: 12.4, RDW: null }, units: { HGB: 'g/dL' } });
  assert.deepEqual(canonical, { HGB: 12.4 });
});

test('rejections match the Python service wording', () => {
  rejects({ cbc: { ...REPORT, FOO: 1 }, units: PRINTED }, /^Unknown CBC field\(s\): FOO/);
  rejects({ cbc: REPORT }, /declared units, or canonicalUnits/);
  rejects({ cbc: REPORT, units: { ...PRINTED, PLT: undefined } }, /^Declare the unit for PLT$/);
  rejects({ cbc: REPORT, units: { ...PRINTED, WBC: 'mmol/L' } }, /^Unsupported unit for WBC: mmol\/L$/);
  rejects({ cbc: { ...REPORT, HGB: 40 }, units: PRINTED }, /^HGB outside supported range 2\.\.24/);
  rejects({ cbc: REPORT, canonicalUnits: true }, /^WBC outside supported range/); // raw 9010 is not 10^3/uL
  rejects({ cbc: {}, canonicalUnits: true }, /At least one recognized CBC value/);
  rejects({ cbc: { HGB: '12' }, canonicalUnits: true }, /must be a finite number/);
  rejects({ cbc: REPORT, units: { ...PRINTED, BAR: 'g/dL' } }, /unknown field\(s\): BAR/);
});

test('unit normalization mirrors fedhealth_ml.preprocess._unit', () => {
  assert.equal(normalizeUnit(' x10³/µL '), 'x10^3/ul');
  assert.equal(normalizeUnit('mil/mm3'), 'mil/mm^3');
  assert.equal(normalizeUnit('GM/DL'), 'gm/dl');
  assert.equal(unitFactor('WBC', '/mm3'), 0.001);
  assert.equal(unitFactor('RBC', 'mil/mm3'), 1);
  assert.equal(unitFactor('HCT', 'L/L'), 100);
  assert.equal(unitFactor('WBC', '/cmm'), null); // not accepted by normalize_units: doctor must choose
  assert.equal(unitFactor('MCV', '%'), null);
});
