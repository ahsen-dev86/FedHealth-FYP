#!/usr/bin/env node
// backend/scripts/e2e-robustness.js
// ---------------------------------------------------------------------------
// Robustness matrix: sends wrong, malformed and absurd input to the RUNNING API
// (and to the inference service directly) and checks each one is rejected with
// the right 4xx and a message that says what to fix — never a 500, a crash, or
// a silently stored row. Prints a Markdown table (use --out to save it).
//
// Needs the running stack (inference :8000, backend :4000, migrated DB). Creates
// throwaway e2e-rb-* accounts; secrets and tokens are never printed.
//
//   node scripts/e2e-robustness.js [--out <file.md>]
// ---------------------------------------------------------------------------
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken'); // used here to forge bad/expired tokens the API must reject
const speakeasy = require('speakeasy'); // TOTP (RFC 6238) library: generates MFA codes for the throwaway accounts
const { Client } = require('pg');

const BASE = (process.env.E2E_BASE_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const INFER = (process.env.INFERENCE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const RUN = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const LETTERS = RUN.replace(/\d/g, (d) => 'abcdefghij'[d]);
const PASSWORD = `Rb-${crypto.randomBytes(9).toString('base64url')}`;

const EX = { WBC: 9010, RBC: 4.47, HGB: 12.4, HCT: 38, MCV: 85, MCH: 28, MCHC: 33, RDW: 13, PLT: 147000, NEUTp: 69 };
const UN = { WBC: '/mm3', RBC: 'mil/mm3', HGB: 'g/dL', HCT: '%', MCV: 'fl', MCH: 'pg', MCHC: 'g/dL', RDW: '%', PLT: '/mm3', NEUTp: '%' };
const PNG = fs.readFileSync(path.join(__dirname, '../test/fixtures/cbc_report.png'));
const RANDOM_UUID = '3f2b8c1e-9d4a-4c6e-8b7f-1a2b3c4d5e6f';
const { proofForm, approveByEmail, refFor } = require('./lib/e2eAccounts');
const REF = refFor(`e2e-rb-${RUN}`); // this run's patient, as a valid FedHealth ID

/** Fetch wrapper that never throws on a non-JSON or network-error response, so a bad request can be graded. */
async function call(method, route, { token, body, raw, headers = {}, base = BASE, form } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = token.startsWith('Basic') || token.startsWith('Bearer') ? token : `Bearer ${token}`;
  if (form) init.body = form;
  else if (raw !== undefined) init.body = raw;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  if (raw !== undefined && !init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(`${base}${route}`, init);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 80) }; }
    return { status: res.status, data, json: (res.headers.get('content-type') || '').includes('json') };
  } catch (e) {
    return { status: 0, data: { error: e.message }, json: false };
  }
}

/** Register a throwaway account and complete MFA enrolment; returns its access token, email, secret and pre-auth token. */
async function enrol(role, email) {
  const reg = await call('POST', '/auth/register', { form: proofForm({ email, password: PASSWORD, fullName: `RB ${role}`, role }) });
  if (reg.status !== 201) throw new Error(`register ${role}: ${reg.status} ${reg.data.error}`);
  const pre = reg.data.preAuthToken;
  const setup = await call('POST', '/auth/mfa/setup', { token: pre, body: {} });
  const secret = setup.data.manualKey.replace(/\s/g, '');
  const ok = await call('POST', '/auth/mfa/verify-setup', { token: pre, body: { code: speakeasy.totp({ secret, encoding: 'base32' }) } });
  // No session is issued until the proof is approved; approve, then sign in.
  if (!ok.data.pendingVerification) throw new Error(`enrol ${role}: expected pendingVerification`);
  await approveByEmail(email);
  const login = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  const mfa = await call('POST', '/auth/mfa/verify', { token: login.data.preAuthToken, body: { code: speakeasy.totp({ secret, encoding: 'base32' }) } });
  if (!mfa.data.accessToken) throw new Error(`enrol ${role}: sign-in after approval failed (${mfa.status} ${mfa.data.error})`);
  return { token: mfa.data.accessToken, email, secret, pre };
}

const rows = [];
let failures = 0;
// A row passes only for an expected status, JSON body, and never a 500/network failure — a crash is always a fail.
function record(area, input, expected, got, extra = '') {
  const ok = (Array.isArray(expected) ? expected : [expected]).includes(got.status)
    && got.status !== 500 && got.status !== 0 && (got.json || got.status === 201 || got.status === 200);
  if (!ok) failures += 1;
  const msg = String(got.data?.error ?? (got.status < 300 ? 'ok' : '')).replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 150);
  rows.push(`| ${area} | ${input.replace(/\|/g, '/')} | ${Array.isArray(expected) ? expected.join('/') : expected} | ${got.status} | ${msg}${extra ? ` ${extra}` : ''} | ${ok ? 'PASS' : '**FAIL**'} |`);
}

async function main() {
  const doctor = await enrol('doctor', `e2e-rb-doctor-${RUN}@fedhealth.test`);
  const nih = await enrol('nih_official', `e2e-rb-nih-${RUN}@nih.org.pk`);
  const D = doctor.token;
  const predict = (body) => call('POST', '/predict', { token: D, body: { patientRef: REF, ...body } });
  const good = await predict({ cbc: EX, units: UN });
  if (good.status !== 201) throw new Error(`baseline prediction failed: ${good.status} ${good.data.error}`);
  const predictionId = good.data.prediction.id;
  const key = process.env.INFERENCE_API_KEY ? { 'X-API-Key': process.env.INFERENCE_API_KEY } : {};
  const T = async (area, input, expected, fn) => record(area, input, expected, await fn());

  // --- transport / HTTP -----------------------------------------------------
  await T('HTTP', 'malformed JSON body', 400, () => call('POST', '/predict', { token: D, raw: '{"patientRef": "x", ' }));
  await T('HTTP', 'JSON `null` as body', 400, () => call('POST', '/predict', { token: D, raw: 'null' }));
  await T('HTTP', 'JSON array as body', 400, () => call('POST', '/predict', { token: D, raw: '[]' }));
  await T('HTTP', 'text/plain body', 400, () => call('POST', '/predict', { token: D, raw: 'HGB=12', headers: { 'Content-Type': 'text/plain' } }));
  await T('HTTP', 'body larger than 1 MB', 413, () => call('POST', '/predict', { token: D, raw: JSON.stringify({ patientRef: 'x', pad: 'x'.repeat(1_100_000) }) }));
  await T('HTTP', 'unknown route', 404, () => call('GET', '/definitely/not/here', { token: D }));
  await T('HTTP', 'wrong method (DELETE /predict)', 404, () => call('DELETE', '/predict', { token: D }));

  // --- authentication / authorization --------------------------------------
  await T('Auth', 'no token', 401, () => call('POST', '/predict', { body: { patientRef: 'x', cbc: EX, units: UN } }));
  await T('Auth', '"Bearer garbage"', 401, () => call('GET', '/auth/me', { token: 'Bearer garbage' }));
  await T('Auth', 'Basic auth header', 401, () => call('GET', '/auth/me', { token: 'Basic dXNlcjpwYXNz' }));
  await T('Auth', 'token signed with a different secret', 401, () => call('GET', '/auth/me',
    { token: jwt.sign({ scope: 'access', role: 'admin' }, 'not-the-secret', { subject: RANDOM_UUID, issuer: 'fedhealth' }) }));
  await T('Auth', 'unsigned token (alg "none")', 401, () => call('GET', '/auth/me',
    { token: `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: RANDOM_UUID, scope: 'access', iss: 'fedhealth' })).toString('base64url')}.` }));
  await T('Auth', 'expired access token', 401, () => call('GET', '/auth/me',
    { token: jwt.sign({ scope: 'access', role: 'doctor', exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET, { subject: RANDOM_UUID, issuer: 'fedhealth' }) }));
  await T('Auth', 'MFA pre-auth token on a clinical route', 401, () => call('POST', '/predict', { token: doctor.pre, body: {} }));
  await T('Auth', 'NIH official calls /predict', 403, () => call('POST', '/predict', { token: nih.token, body: { patientRef: 'x', cbc: EX, units: UN } }));
  await T('Auth', 'doctor opens Model Health', 403, () => call('GET', '/model-health/summary', { token: D }));
  await T('Auth', "login email `' OR 1=1 --`", 400, () => call('POST', '/auth/login', { body: { email: "' OR 1=1 --", password: 'x'.repeat(8) } }));
  await T('Auth', 'login with wrong password', 401, () => call('POST', '/auth/login', { body: { email: doctor.email, password: 'wrong-password' } }));
  await T('Auth', 'register as admin', 400, () => call('POST', '/auth/register', { form: proofForm({ email: `x-${RUN}@fedhealth.test`, password: PASSWORD, fullName: 'Test User', role: 'admin' }) }));
  await T('Auth', 'NIH official with a gmail address', 400, () => call('POST', '/auth/register', { form: proofForm({ email: `nih-${RUN}@gmail.com`, password: PASSWORD, fullName: 'Test User', role: 'nih_official' }) }));
  await T('Auth', 'register an existing email', 409, () => call('POST', '/auth/register', { form: proofForm({ email: doctor.email, password: PASSWORD, fullName: 'Test User', role: 'doctor' }) }));
  await T('Auth', 'password shorter than 8', 400, () => call('POST', '/auth/register', { form: proofForm({ email: `y-${RUN}@fedhealth.test`, password: 'short', fullName: 'Test User', role: 'doctor' }) }));
  await T('Auth', 'register without a proof document', 400, () => call('POST', '/auth/register', { body: { email: `z-${RUN}@fedhealth.test`, password: PASSWORD, fullName: 'Test User', role: 'doctor' } }));
  await T('Auth', 'register with a renamed non-document as proof', 400, () => {
    const f = proofForm({ email: `w-${RUN}@fedhealth.test`, password: PASSWORD, fullName: 'Test User', role: 'doctor' });
    f.set('proof', new Blob([Buffer.from('MZ not a document, only renamed')], { type: 'application/pdf' }), 'licence.pdf');
    return call('POST', '/auth/register', { form: f });
  });
  const login = await call('POST', '/auth/login', { body: { email: doctor.email, password: PASSWORD } });
  await T('Auth', 'MFA code "abcdef"', 400, () => call('POST', '/auth/mfa/verify', { token: login.data.preAuthToken, body: { code: 'abcdef' } }));
  await T('Auth', 'wrong 6-digit MFA code', 401, () => call('POST', '/auth/mfa/verify', { token: login.data.preAuthToken,
    body: { code: String((Number(speakeasy.totp({ secret: doctor.secret, encoding: 'base32' })) + 500000) % 1000000).padStart(6, '0') } }));

  // --- patient reference (privacy) -----------------------------------------
  for (const [label, ref] of [['empty', ''], ['spaces only', '   '], ['CNIC 35202-1234567-1', '35202-1234567-1'],
    ['CNIC without dashes', '3520212345671'], ['mobile 0300-1234567', '0300-1234567'], ['email', 'ali@example.com'],
    ['HTML <script>', '<script>alert(1)</script>'], ["SQL `x'; DROP TABLE lab_reports;--`", "x'; DROP TABLE lab_reports;--"],
    ['129 characters', 'p'.repeat(129)], ['Urdu name', 'علی احمد'], ['number 42 (not a string)', 42]]) {
    await T('Patient ref', label, 400, () => call('POST', '/predict', { token: D, body: { patientRef: ref, cbc: EX, units: UN } }));
  }

  // --- CBC values ------------------------------------------------------------
  await T('CBC', 'cbc missing', 400, () => predict({ units: UN }));
  await T('CBC', 'cbc is an array', 400, () => predict({ cbc: [12.4], units: UN }));
  await T('CBC', 'cbc is a string "HGB=12"', 400, () => predict({ cbc: 'HGB=12', units: UN }));
  await T('CBC', 'cbc {} (nothing measured)', 400, () => predict({ cbc: {}, units: UN }));
  await T('CBC', 'every value null', 400, () => predict({ cbc: { HGB: null, PLT: null }, units: UN }));
  await T('CBC', 'HGB as string "12.4"', 400, () => predict({ cbc: { ...EX, HGB: '12.4' }, units: UN }));
  await T('CBC', 'HGB true (boolean)', 400, () => predict({ cbc: { ...EX, HGB: true }, units: UN }));
  await T('CBC', 'HGB [12.4] (array)', 400, () => predict({ cbc: { ...EX, HGB: [12.4] }, units: UN }));
  await T('CBC', 'HGB 1e309 (Infinity)', 400, () => call('POST', '/predict', { token: D,
    raw: `{"patientRef":"${REF}","cbc":{"HGB":1e309},"units":{"HGB":"g/dL"}}` }));
  await T('CBC', 'HGB -5 (negative)', 400, () => predict({ cbc: { ...EX, HGB: -5 }, units: UN }));
  await T('CBC', 'PLT 0', 400, () => predict({ cbc: { ...EX, PLT: 0 }, units: UN }));
  await T('CBC', 'HGB 1,000,000', 400, () => predict({ cbc: { ...EX, HGB: 1e6 }, units: UN }));
  await T('CBC', 'NEUTp 101 %', 400, () => predict({ cbc: { ...EX, NEUTp: 101 }, units: UN }));
  await T('CBC', 'boundary HGB 2 and 24 g/dL (accepted)', 201, () => predict({ cbc: { HGB: 2, PLT: 1500 }, units: { HGB: 'g/dL', PLT: '10^3/uL' } }));
  await T('CBC', 'unknown field FOO', 400, () => predict({ cbc: { ...EX, FOO: 1 }, units: UN }));
  await T('CBC', 'lower-case key "hgb"', 400, () => predict({ cbc: { hgb: 12.4 }, units: { hgb: 'g/dL' } }));
  await T('CBC', 'key "__proto__"', 400, () => call('POST', '/predict', { token: D,
    raw: `{"patientRef":"${REF}","cbc":{"__proto__":5,"HGB":12.4},"units":{"HGB":"g/dL"}}` }));
  await T('CBC', 'key "constructor"', 400, () => predict({ cbc: { constructor: 5, HGB: 12.4 }, units: { HGB: 'g/dL' } }));
  await T('CBC', 'non-model field PDW (not a model input)', 400, () => predict({ cbc: { ...EX, PDW: 16 }, units: UN }));

  // --- units -----------------------------------------------------------------
  await T('Units', 'no units at all', 400, () => predict({ cbc: EX }));
  await T('Units', 'unit missing for PLT', 400, () => predict({ cbc: EX, units: { ...UN, PLT: undefined } }));
  await T('Units', 'unit "" for HGB', 400, () => predict({ cbc: EX, units: { ...UN, HGB: '' } }));
  await T('Units', 'unit null for HGB', 400, () => predict({ cbc: EX, units: { ...UN, HGB: null } }));
  await T('Units', 'unit 5 (number)', 400, () => predict({ cbc: EX, units: { ...UN, HGB: 5 } }));
  await T('Units', 'WBC in mmol/L', 400, () => predict({ cbc: EX, units: { ...UN, WBC: 'mmol/L' } }));
  await T('Units', 'unit "g/dL; DROP TABLE"', 400, () => predict({ cbc: EX, units: { ...UN, HGB: 'g/dL; DROP TABLE' } }));
  await T('Units', 'unit 40 characters long', 400, () => predict({ cbc: EX, units: { ...UN, HGB: 'g'.repeat(40) } }));
  await T('Units', 'units for an unknown field', 400, () => predict({ cbc: EX, units: { ...UN, FOO: 'g/dL' } }));
  await T('Units', 'units as an array', 400, () => predict({ cbc: EX, units: ['g/dL'] }));
  const wbc = await predict({ cbc: { ...EX, WBC: 9010 }, units: { ...UN, WBC: '10^3/uL' } });
  record('Units', 'WBC 9010 declared ×10³/µL (count typed as 10³)', 400, wbc, /\/mm³/.test(wbc.data.error) ? '(hint names /mm³)' : '(NO HINT)');
  const hct = await predict({ cbc: { ...EX, HCT: 0.38 }, units: UN });
  record('Units', 'HCT 0.38 declared % (fraction typed)', 400, hct, /L\/L/.test(hct.data.error) ? '(hint names L/L)' : '(NO HINT)');
  await T('Units', 'HGB 124 declared g/dL (g/L typed)', 400, () => predict({ cbc: { ...EX, HGB: 124 }, units: UN }));
  await T('Units', 'canonicalUnits "yes" (string)', 400, () => predict({ cbc: { HGB: 12.4 }, canonicalUnits: 'yes' }));
  await T('Units', 'canonicalUnits true with raw counts', 400, () => predict({ cbc: EX, canonicalUnits: true }));
  await T('Units', 'case/µ variants "G/DL", "x10³/µL" (accepted)', 201, () => predict({ cbc: { HGB: 12.4, WBC: 9.01 }, units: { HGB: 'G/DL', WBC: 'x10³/µL' } }));

  // --- context fields ---------------------------------------------------------
  for (const [label, extra] of [['age -1', { ageYears: -1 }], ['age 131', { ageYears: 131 }], ['age 12.5', { ageYears: 12.5 }],
    ['age "30" (string)', { ageYears: '30' }], ['sex "female"', { sex: 'female' }], ['latitude 91', { latitude: 91, longitude: 70 }],
    ['latitude without longitude', { latitude: 31.5 }], ['collectedAt "yesterday"', { collectedAt: 'yesterday' }],
    ['collectedAt 2999-01-01 (future)', { collectedAt: '2999-01-01' }], ['collectedAt 1800-01-01', { collectedAt: '1800-01-01' }],
    ['district "<b>Lahore</b>"', { district: '<b>Lahore</b>' }], ['district 81 characters', { district: 'L'.repeat(81) }],
    ['symptomsText 2001 characters', { symptomsText: 's'.repeat(2001) }], ['extra field "diagnosis"', { diagnosis: 'leukemia' }],
    ['labId "abc"', { labId: 'abc' }], ['model "gpt-4"', { model: 'gpt-4' }], ['source "fax"', { source: 'fax' }]]) {
    await T('Context', label, 400, () => predict({ cbc: EX, units: UN, ...extra }));
  }
  await T('Context', 'labId: well-formed UUID of no lab', 400, () => predict({ cbc: EX, units: UN, labId: RANDOM_UUID }));

  // --- data quality (accepted, flagged) --------------------------------------
  const typo = await predict({ cbc: { ...EX, HGB: 2.4 }, units: UN });
  record('Data quality', 'HGB 2.4 with HCT 38, MCHC 33 (typo; in range)', 201, typo,
    typo.data.screening?.dataQualityWarnings?.length ? `(${typo.data.screening.dataQualityWarnings.length} warnings returned)` : '(NO WARNING)');
  if (!typo.data.screening?.dataQualityWarnings?.length) failures += 1;

  // --- ids in the URL -----------------------------------------------------------
  await T('IDs', 'POST /predictions/abc/confirm', 400, () => call('POST', '/predictions/abc/confirm', { token: D, body: { confirmedCondition: 'anemia' } }));
  await T('IDs', "POST /predictions/1' OR '1'='1/confirm", 400, () => call('POST', `/predictions/${encodeURIComponent("1' OR '1'='1")}/confirm`, { token: D, body: { confirmedCondition: 'anemia' } }));
  await T('IDs', 'confirm a UUID that does not exist', 404, () => call('POST', `/predictions/${RANDOM_UUID}/confirm`, { token: D, body: { confirmedCondition: 'anemia' } }));
  await T('IDs', 'GET /reports/xyz', 400, () => call('GET', '/reports/xyz', { token: D }));
  await T('IDs', 'POST /reports/<unknown uuid>/predict', 404, () => call('POST', `/reports/${RANDOM_UUID}/predict`, { token: D, body: {} }));
  await T('IDs', 'GET /patients/<CNIC>/history', 400, () => call('GET', '/patients/35202-1234567-1/history', { token: D }));
  await T('IDs', 'NIH ack /nih/alerts/xyz/ack', 400, () => call('POST', '/nih/alerts/xyz/ack', { token: nih.token, body: {} }));

  // --- doctor confirmation ------------------------------------------------------
  const confirm = (body) => call('POST', `/predictions/${predictionId}/confirm`, { token: D, body });
  await T('Confirm', 'condition "Leukemia" (wrong case)', 400, () => confirm({ confirmedCondition: 'Leukemia' }));
  await T('Confirm', 'old nine-class "iron_deficiency_anemia"', 400, () => confirm({ confirmedCondition: 'iron_deficiency_anemia' }));
  await T('Confirm', 'condition missing', 400, () => confirm({}));
  await T('Confirm', 'notes 2001 characters', 400, () => confirm({ confirmedCondition: 'anemia', notes: 'n'.repeat(2001) }));
  await T('Confirm', 'extra field "confirmedBy"', 400, () => confirm({ confirmedCondition: 'anemia', confirmedBy: RANDOM_UUID }));

  // --- NIH / Model Health query parameters ---------------------------------------
  const N = nih.token;
  await T('NIH', 'clusters?condition=cancer', 400, () => call('GET', '/nih/clusters?condition=cancer', { token: N }));
  await T('NIH', 'alerts?limit=0', 400, () => call('GET', '/nih/alerts?limit=0', { token: N }));
  await T('NIH', 'alerts?limit=abc', 400, () => call('GET', '/nih/alerts?limit=abc', { token: N }));
  await T('NIH', 'alerts?limit=100000', 400, () => call('GET', '/nih/alerts?limit=100000', { token: N }));
  await T('NIH', 'alerts?status=deleted', 400, () => call('GET', '/nih/alerts?status=deleted', { token: N }));
  await T('Model Health', 'accuracy-history?run=abc', 400, () => call('GET', '/model-health/accuracy-history?run=abc', { token: N }));
  await T('Model Health', 'accuracy-history?run=<unknown uuid>', 404, () => call('GET', `/model-health/accuracy-history?run=${RANDOM_UUID}`, { token: N }));
  await T('Model Health', 'data-intake?days=-5 (clamped to 1)', 200, () => call('GET', '/model-health/data-intake?days=-5', { token: N }));

  // --- OCR uploads and text -----------------------------------------------------
  const upload = (name, bytes, type, field = 'image') => {
    const f = new FormData();
    f.append(field, new Blob([bytes], { type }), name);
    return f;
  };
  await T('OCR', 'no image and no text', 400, () => call('POST', '/ocr', { token: D, body: {} }));
  await T('OCR', 'text "" (empty)', 400, () => call('POST', '/ocr', { token: D, body: { text: '' } }));
  await T('OCR', 'text 20,001 characters', 400, () => call('POST', '/ocr', { token: D, body: { text: 'x'.repeat(20001) } }));
  const junk = await call('POST', '/ocr', { token: D, body: { text: 'lorem ipsum 42 !!! ??? no blood values here' } });
  record('OCR', 'text with no CBC values', 200, junk, `(extractedCount ${junk.data.extractedCount})`);
  await T('OCR', 'PDF upload', 400, () => call('POST', '/ocr', { token: D, form: upload('r.pdf', Buffer.from('%PDF-1.4'), 'application/pdf') }));
  await T('OCR', 'empty PNG (0 bytes)', 400, () => call('POST', '/ocr', { token: D, form: upload('r.png', Buffer.alloc(0), 'image/png') }));
  await T('OCR', 'text file renamed .png', 400, () => call('POST', '/ocr', { token: D, form: upload('r.png', Buffer.from('not an image at all'), 'image/png') }));
  await T('OCR', 'truncated (corrupt) PNG', 400, () => call('POST', '/ocr', { token: D, form: upload('r.png', PNG.subarray(0, 2000), 'image/png') }));
  await T('OCR', '9 MB image', 413, () => call('POST', '/ocr', { token: D, form: upload('big.png', Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]), 'image/png') }));
  await T('OCR', 'image in field "file" instead of "image"', 400, () => call('POST', '/ocr', { token: D, form: upload('r.png', PNG, 'image/png', 'file') }));
  const two = new FormData();
  two.append('image', new Blob([PNG], { type: 'image/png' }), 'a.png');
  two.append('image', new Blob([PNG], { type: 'image/png' }), 'b.png');
  await T('OCR', 'two images at once', 400, () => call('POST', '/ocr', { token: D, form: two }));
  const badLang = upload('r.png', PNG, 'image/png');
  badLang.append('lang', 'eng; rm -rf /');
  await T('OCR', 'lang "eng; rm -rf /" (command injection)', 400, () => call('POST', '/ocr', { token: D, form: badLang }));
  await T('Symptoms', 'symptoms/parse with no text', 400, () => call('POST', '/symptoms/parse', { token: D, body: {} }));
  await T('Symptoms', 'symptoms/parse 2001 characters', 400, () => call('POST', '/symptoms/parse', { token: D, body: { text: 'a'.repeat(2001) } }));

  // --- inference service directly --------------------------------------------------
  const inf = (body, extra = {}) => call('POST', '/infer', { base: INFER, headers: { ...key, ...(extra.headers || {}) }, body, ...extra });
  await T('Inference', 'no API key', 401, () => call('POST', '/infer', { base: INFER, body: { cbc: EX, units: UN } }));
  await T('Inference', 'wrong API key', 401, () => call('POST', '/infer', { base: INFER, headers: { 'X-API-Key': 'wrong' }, body: { cbc: EX, units: UN } }));
  await T('Inference', 'HGB "12.4" (string)', 400, () => inf({ cbc: { ...EX, HGB: '12.4' }, units: UN }));
  await T('Inference', 'HGB true', 400, () => inf({ cbc: { ...EX, HGB: true }, units: UN }));
  await T('Inference', 'HGB NaN (non-standard JSON)', 400, () => call('POST', '/infer', { base: INFER, headers: key, raw: '{"cbc":{"HGB":NaN},"units":{"HGB":"g/dL"}}' }));
  await T('Inference', 'unit 5 (number)', 400, () => inf({ cbc: EX, units: { ...UN, HGB: 5 } }));
  await T('Inference', '70 KB body', 413, () => call('POST', '/infer', { base: INFER, headers: key, raw: JSON.stringify({ cbc: EX, pad: 'x'.repeat(70000) }) }));
  await T('Inference', 'unknown route', 404, () => call('GET', '/nope', { base: INFER }));
  await T('Inference', 'GET /infer (wrong method)', 405, () => call('GET', '/infer', { base: INFER }));

  // --- nothing from the rejected requests was stored -------------------------------
  const db = new Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD });
  await db.connect();
  const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM lab_reports WHERE patient_ref = $1', [REF]);
  await db.end();
  const expectedStored = 1 + 1 + 1 + 1; // baseline, boundary, case/µ variants, data-quality typo
  rows.push(`| DB | reports stored for this run's patient (only the 4 accepted requests) | ${expectedStored} | ${n} | | ${n === expectedStored ? 'PASS' : '**FAIL**'} |`);
  if (n !== expectedStored) failures += 1;

  const total = rows.length;
  const out = [
    `# FedHealth robustness matrix ${new Date().toISOString()}`, '',
    `Backend ${BASE}; inference ${INFER}. Every row is a live request; PASS = the expected status, a JSON error body, and never 500.`,
    `District names in this run use letters only (e2e district: "E2E District ${LETTERS}").`, '',
    '| Area | Input | Expected | Got | API message (first 150 chars) | Result |', '|---|---|---|---|---|---|', ...rows, '',
    `**${total - failures} of ${total} passed, ${failures} failed.**`,
  ].join('\n');
  console.log(out);
  const file = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  if (file) fs.writeFileSync(file, `${out}\n`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
  // approveByEmail uses the app's pool; close it so the script can exit.
  .finally(() => require('../src/db/pool').pool.end().catch(() => {}));
