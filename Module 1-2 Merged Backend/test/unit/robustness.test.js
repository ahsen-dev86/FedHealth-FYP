// Unit tests: wrong/absurd input handling that does not need a database —
// validators, error-to-HTTP mapping, unit hints and data-quality warnings.
const test = require('node:test');
const assert = require('node:assert/strict');
const multer = require('multer');
const { reportBody, confirmBody, patientRef } = require('../../src/validators/domain');
const { errorHandler, HttpError, uuidParam } = require('../../src/middleware/errors');
const { prepareCbc } = require('../../src/services/cbc');
const { consistencyWarnings, plausibleUnits } = require('../../src/contract');

const EX = { WBC: 9010, RBC: 4.47, HGB: 12.4, HCT: 38, MCV: 85, MCH: 28, MCHC: 33, RDW: 13, PLT: 147000, NEUTp: 69 };
const UN = { WBC: '/mm3', RBC: 'mil/mm3', HGB: 'g/dL', HCT: '%', MCV: 'fl', MCH: 'pg', MCHC: 'g/dL', RDW: '%', PLT: '/mm3', NEUTp: '%' };

// Run an error through the real errorHandler with a minimal fake res, capturing the status/body it would send.
function respond(err) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const quiet = console.error;
  console.error = () => {};
  try { errorHandler(err, {}, res, () => {}); } finally { console.error = quiet; }
  return res;
}

test('patient reference: pseudonymous tokens pass, direct identifiers and junk do not', () => {
  for (const ok of ['pt-hash-001', 'e2e-rb-1', 'LAB.0042:A', 'a3f9c1'.repeat(10)]) assert.ok(patientRef.safeParse(ok).success, ok);
  const bad = [
    ['35202-1234567-1', /CNIC/], ['3520212345671', /CNIC/], [3520212345671, /Expected string/],
    ['0300-1234567', /phone/], ['03001234567', /phone/], ['+923001234567', /phone/],
    ['ali@example.com', /email/], ['<script>', /only letters/], ["x'; DROP TABLE t;--", /only letters/],
    ['علی', /only letters/], ['', /Enter the/], ['   ', /Enter the/], ['p'.repeat(129), /too long/],
  ];
  for (const [value, re] of bad) {
    const r = patientRef.safeParse(value);
    assert.ok(!r.success, `${value} should be rejected`);
    assert.match(r.error.issues[0].message, re, String(value));
  }
});

test('report body: context fields must be sensible', () => {
  const base = { patientRef: 'p1', cbc: { HGB: 12.4 }, units: { HGB: 'g/dL' } };
  assert.ok(reportBody.safeParse(base).success);
  for (const extra of [{ ageYears: -1 }, { ageYears: 131 }, { ageYears: 12.5 }, { ageYears: '30' }, { sex: 'female' },
    { latitude: 31.5 }, { latitude: 91, longitude: 70 }, { collectedAt: 'yesterday' }, { collectedAt: '2999-01-01' },
    { district: '<b>x</b>' }, { symptomsText: 's'.repeat(2001) }, { diagnosis: 'leukemia' }, { labId: 'abc' }]) {
    assert.ok(!reportBody.safeParse({ ...base, ...extra }).success, JSON.stringify(extra).slice(0, 60));
  }
  assert.ok(reportBody.safeParse({ ...base, ageYears: 0, sex: 'F', district: "Dera Ismail Khan", latitude: 31.8, longitude: 70.9 }).success);
});

test('report body: bad CBC/unit entries are named, "__proto__" survives to be rejected', () => {
  const msg = (body) => reportBody.safeParse(body).error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ');
  assert.match(msg({ patientRef: 'p', cbc: { HGB: '12.4' } }), /cbc\.HGB: HGB must be a number, not the text "12\.4"/);
  assert.match(msg({ patientRef: 'p', cbc: { HGB: true } }), /HGB must be a number, not a boolean/);
  assert.match(msg({ patientRef: 'p' }), /cbc: cbc is required/);
  assert.match(msg({ patientRef: 'p', cbc: { HGB: 12 }, units: { HGB: 5 } }), /units\.HGB: the unit for HGB must be text/);
  const parsed = reportBody.parse({ patientRef: 'p', cbc: JSON.parse('{"__proto__": 5, "HGB": 12}'), units: { HGB: 'g/dL' } });
  assert.throws(() => prepareCbc(parsed), /Unknown CBC field\(s\): __proto__/);
});

test('confirm: only the four classes, no extra fields', () => {
  assert.ok(confirmBody.safeParse({ confirmedCondition: 'anemia', notes: null }).success);
  for (const b of [{}, { confirmedCondition: 'Anemia' }, { confirmedCondition: 'anemia', confirmedBy: 'x' }, { confirmedCondition: 'anemia', notes: 'n'.repeat(2001) }]) {
    assert.ok(!confirmBody.safeParse(b).success, JSON.stringify(b).slice(0, 40));
  }
});

test('error handler: client mistakes are 4xx with a clear message; internals never leak', () => {
  assert.deepEqual(respond(Object.assign(new SyntaxError('x'), { type: 'entity.parse.failed', status: 400 })).body, { error: 'Malformed JSON body' });
  assert.equal(respond({ type: 'entity.too.large', status: 413 }).statusCode, 413);
  assert.equal(respond(new multer.MulterError('LIMIT_FILE_SIZE')).statusCode, 413);
  assert.equal(respond(new multer.MulterError('LIMIT_UNEXPECTED_FILE')).body.error, 'Upload the report image in the field "image"');
  assert.equal(respond(Object.assign(new Error('invalid input syntax for type uuid: "abc"'), { code: '22P02' })).statusCode, 400);
  const leak = respond(new Error('connect ECONNREFUSED 127.0.0.1:5432 password=secret'));
  assert.equal(leak.statusCode, 500);
  assert.equal(leak.body.error, 'Internal server error');
  assert.equal(respond(new HttpError(502, 'inference service unreachable')).body.error, 'inference service unreachable');
});

test('uuid path parameters are checked before reaching the database', () => {
  let err = null;
  uuidParam({}, {}, (e) => { err = e; }, "1' OR '1'='1", 'id');
  assert.equal(err.status, 400);
  uuidParam({}, {}, (e) => { err = e; }, '3f2b8c1e-9d4a-4c6e-8b7f-1a2b3c4d5e6f', 'id');
  assert.equal(err, undefined);
});

test('unit hints name the unit a mistyped value would fit, without applying it', () => {
  assert.deepEqual(plausibleUnits('WBC', 9010), ['/mm³ (count)', '/µL (count)']);
  assert.deepEqual(plausibleUnits('HCT', 0.38), ['L/L']);
  assert.deepEqual(plausibleUnits('HGB', 124), ['g/L']);
  assert.deepEqual(plausibleUnits('HGB', -3), []);
  assert.throws(() => prepareCbc({ cbc: { WBC: 9010 }, units: { WBC: '10^3/uL' } }), /would fit if the unit is \/mm³/);
});

test('data-quality warnings flag inconsistent red-cell indices, not consistent ones', () => {
  assert.deepEqual(prepareCbc({ cbc: EX, units: UN }).warnings, []);
  const typo = prepareCbc({ cbc: { ...EX, HGB: 2.4 }, units: UN }).warnings;
  assert.equal(typo.length, 2);
  assert.match(typo[0], /^MCHC is 33 but HGB \/ HCT x 100 gives 6\.3/);
  assert.deepEqual(consistencyWarnings({ HGB: 12.4 }), []); // incomplete: nothing to compare
});
