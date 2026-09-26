// Frontend unit tests (node --test): the contract module and the mock client.
// Cross-layer parity with Python and the backend lives in
// tests/test_integration_contract.py; these cover the UI-only rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURES, CLASSES, validateCbc, parseValue, patientRefError, ageError, unitOptionFor, plausibleUnits,
} from '../src/lib/contract.js';
import { CBC_FIELDS, conditionLabel } from '../src/lib/format.js';

// The mock client uses browser storage/crypto only inside its auth handlers.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { api } = await import('../src/api/client.mock.js');

const REPORT = { WBC: '9,010', RBC: '4.47', HGB: '12.4', HCT: '38', MCV: '85', MCH: '28', MCHC: '33', RDW: '13', PLT: '147,000', NEUTp: '69' };
const PRINTED = { WBC: '/mm3', RBC: 'mil/mm3', HGB: 'g/dL', HCT: '%', MCV: 'fl', MCH: 'pg', MCHC: 'g/dL', RDW: '%', PLT: '/mm3', NEUTp: '%' };

test('form fields are the 10 model features; labels are the 4 classes', () => {
  assert.deepEqual(CBC_FIELDS.map((f) => f.key), FEATURES);
  assert.deepEqual(CLASSES, ['healthy', 'anemia', 'thalassemia', 'leukemia']);
  assert.equal(conditionLabel('thalassemia'), 'Thalassemia');
});

test('typed values: thousands separators yes, ambiguous or junk no', () => {
  assert.equal(parseValue('147,000'), 147000);
  assert.equal(parseValue(' 12.4 '), 12.4);
  assert.equal(parseValue(''), null);
  for (const junk of ['abc', '12,4', '1e3', '12.4.5', '1,00', '--1', '12 4']) assert.ok(Number.isNaN(parseValue(junk)), junk);
});

test('the example report validates to canonical values without warnings', () => {
  const v = validateCbc(REPORT, PRINTED);
  assert.deepEqual(v.errors, {});
  assert.equal(v.canonical.WBC, 9.01);
  assert.equal(v.canonical.PLT, 147);
  assert.deepEqual(v.warnings, []);
});

test('mistakes get field-level messages with a unit hint where one fits', () => {
  const v = validateCbc({ WBC: '9010', HCT: '0.38', HGB: '-3', MCV: 'abc', PLT: '200' }, { WBC: '10^3/uL', HCT: '%', HGB: 'g/dL', MCV: 'fL' });
  assert.match(v.errors.WBC, /would fit if the unit is \/mm³/);
  assert.match(v.errors.HCT, /would fit if the unit is L\/L/);
  assert.match(v.errors.HGB, /outside supported range 2\.\.24/);
  assert.equal(v.errors.MCV, 'MCV must be a number');
  assert.equal(v.errors.PLT, 'Declare the unit for PLT');
  assert.deepEqual(plausibleUnits('HGB', -3), []);
});

test('printed units map to the equivalent form option', () => {
  assert.equal(unitOptionFor('WBC', 'x10^3/uL').value, '10^3/uL');
  assert.equal(unitOptionFor('WBC', 'cells/uL').value, '/mm3'); // 1 mm³ = 1 µL: same factor
  assert.equal(unitOptionFor('RBC', 'mil/mm3').value, 'mil/mm3');
  assert.equal(unitOptionFor('WBC', '/cmm'), null); // unsupported: the doctor must choose
});

test('patient reference and age rules match the API', () => {
  assert.equal(patientRefError('pt-hash-001'), '');
  assert.match(patientRefError('35202-1234567-1'), /CNIC/);
  assert.match(patientRefError('0300-1234567'), /phone/);
  assert.match(patientRefError('ali@example.com'), /email/);
  assert.match(patientRefError('<script>'), /only letters/);
  assert.match(patientRefError('   '), /Enter the/);
  assert.equal(ageError(''), '');
  assert.equal(ageError('34'), '');
  for (const bad of ['-1', '12.5', 'abc', '131', '3 0']) assert.notEqual(ageError(bad), '', bad);
});

test('mock client: four-class result for valid input, same 400s for bad input', async () => {
  const ok = await api.post('/predict', { patientRef: 'pt-1', cbc: { HGB: 12.4, PLT: 147000 }, units: { HGB: 'g/dL', PLT: '/mm3' } });
  assert.deepEqual(Object.keys(ok.inference.scores), CLASSES);
  assert.match(ok.screening.disclaimer, /not produced by the model/);
  for (const [cbc, units, re] of [
    [{ HGB: 40 }, { HGB: 'g/dL' }, /outside supported range/],
    [{ HGB: 12.4 }, { HGB: 'mmol/L' }, /Unsupported unit/],
    [{ HGB: 12.4 }, {}, /Declare the unit/],
    [{}, {}, /At least one/],
  ]) {
    await assert.rejects(api.post('/predict', { patientRef: 'pt-1', cbc, units }), (e) => e.status === 400 && re.test(e.message));
  }
  await assert.rejects(api.post('/predictions/1/confirm', { confirmedCondition: 'iron_deficiency_anemia' }), (e) => e.status === 400);
  await assert.rejects(api.get('/nih/clusters?condition=cancer'), (e) => e.status === 400);
});
