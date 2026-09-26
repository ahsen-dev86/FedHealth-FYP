#!/usr/bin/env node
// backend/scripts/e2e-acceptance.js
// ---------------------------------------------------------------------------
// API-level end-to-end acceptance run (no browser). Requires the running stack:
// Flask inference (INFERENCE_URL) serving the seed-42 bundle, this backend on
// E2E_BASE_URL (default http://127.0.0.1:4000) and the migrated database with
// the registered model and imported FL runs.
//
// It creates fresh accounts for this run (random passwords, kept in memory
// only), completes the real MFA flow with scripts/totp-code.js, then checks:
//   A1 doctor posts the example report with its printed units -> four-class
//      scores, model version, disclaimer; lab_reports/predictions JSON keys (SQL)
//   A2 OCR of the example report text -> 10 keys + printed units -> same scores
//   A3 doctor confirms -> confirmed_condition, audit entry, chain verifies
//   A4 high leukemia scores -> high_risk_case + outbreak_cluster alerts, NIH views
//   A5 /model-health/* return the registered model, runs, honest encryption
//   A6 invalid inputs rejected by the API, the inference service and the DB
// Tokens, TOTP secrets and passwords are never printed.
//
//   node scripts/e2e-acceptance.js [--out <file.md>]
// ---------------------------------------------------------------------------
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const { CLASSES, FEATURES } = require('../src/contract');

const BASE = (process.env.E2E_BASE_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const INFER = (process.env.INFERENCE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const RUN = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const out = [];
let passed = 0;
let failed = 0;

const log = (line = '') => { out.push(line); console.log(line); };
const short = (v, n = 600) => { const s = JSON.stringify(v); return s.length > n ? `${s.slice(0, n)}…` : s; };
function check(label, cond, detail = '') {
  if (cond) passed += 1; else failed += 1;
  log(`- ${cond ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}
const randomPassword = () => `E2e-${crypto.randomBytes(12).toString('base64url')}`;

async function http(method, route, { token, body, raw, base = BASE, headers = {}, quiet = false } = {}) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!quiet) {
    const shownBody = body && (body.password || body.code)
      ? { ...body, ...(body.password ? { password: '<redacted>' } : {}), ...(body.code ? { code: '<totp>' } : {}) }
      : body;
    log(`  - \`${method} ${route}\`${shownBody !== undefined ? ` body ${short(shownBody, 400)}` : ''} → **${res.status}**`);
  }
  return { status: res.status, data };
}

function totp(secret) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'totp-code.js'), secret], { encoding: 'utf8' });
  return r.stdout.trim();
}

/** Register (or bootstrap) a user and finish MFA enrolment; returns { token, email, password, secret }. */
async function enrol(role, email) {
  const password = randomPassword();
  let preAuth;
  if (role === 'admin') {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'bootstrap-admin.js')], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
      env: { ...process.env, ADMIN_EMAIL: email, ADMIN_PASSWORD: password, ADMIN_NAME: 'E2E Admin' },
    });
    log(`  - \`node scripts/bootstrap-admin.js\` (ADMIN_EMAIL=${email}) → exit ${r.status}`);
    const login = await http('POST', '/auth/login', { body: { email, password } });
    preAuth = login.data.preAuthToken;
  } else {
    const reg = await http('POST', '/auth/register', {
      body: { email, password, fullName: `E2E ${role}`, role, organization: 'FedHealth E2E' },
    });
    check(`${role} registered, MFA setup required`, reg.status === 201 && reg.data.mfaSetupRequired === true);
    preAuth = reg.data.preAuthToken;
  }
  const setup = await http('POST', '/auth/mfa/setup', { token: preAuth, body: {} });
  const secret = setup.data.manualKey?.replace(/\s/g, '');
  const verify = await http('POST', '/auth/mfa/verify-setup', { token: preAuth, body: { code: totp(secret) } });
  check(`${role} MFA enrolled via scripts/totp-code.js`, verify.status === 200 && !!verify.data.accessToken);
  return { token: verify.data.accessToken, email, password, secret };
}

async function sql(db, text, params = []) {
  const { rows } = await db.query(text, params);
  log(`  - SQL \`${text.replace(/\s+/g, ' ').trim()}\``);
  for (const r of rows) log(`    → ${short(r, 700)}`);
  return rows;
}

async function dbRejects(db, label, text, params) {
  await db.query('BEGIN');
  let code = null;
  try { await db.query(text, params); } catch (e) { code = e.code; }
  await db.query('ROLLBACK');
  check(`DB rejects ${label}`, code === '23514', `SQLSTATE ${code}`);
}

// Example report (units exactly as printed on the paper report).
const EXAMPLE_CBC = { WBC: 9010, RBC: 4.47, HGB: 12.4, HCT: 38, MCV: 85, MCH: 28, MCHC: 33, RDW: 13, PLT: 147000, NEUTp: 69 };
const EXAMPLE_UNITS = { WBC: '/mm3', RBC: 'mil/mm3', HGB: 'g/dL', HCT: '%', MCV: 'fl', MCH: 'pg', MCHC: 'g/dL', RDW: '%', PLT: '/mm3', NEUTp: '%' };
const EXAMPLE_TEXT = [
  'COMPLETE BLOOD COUNT            Result      Unit       Reference',
  'Total Leucocyte Count (TLC)     9,010       /mm3       4,000 - 11,000',
  'Red Blood Cells                 4.47        mil/mm3    4.5 - 5.5',
  'Haemoglobin                     12.4   L    g/dL       13.0 - 17.0',
  'Haematocrit (HCT)               38          %          40 - 50',
  'MCV                             85          fl         80 - 100',
  'MCH                             28          pg         27 - 32',
  'MCHC                            33          g/dL       32 - 36',
  'RDW-CV                          13          %          11.5 - 14.5',
  'Platelet Count                  147,000  L  /mm3       150,000 - 400,000',
  'Neutrophils                     69          %          40 - 75',
  'Lymphocytes                     25          %          20 - 40',
].join('\n');
const EXPECTED = { anemia: 0.588, healthy: 0.224, thalassemia: 0.169, leukemia: 0.019 };
// Training-split leukemia rows (row_id 2, 8, 15; test split untouched) and row 25,
// whose top score is healthy while leukemia (0.48) still crosses the 0.30 flag.
const LEUKEMIA_ROWS = [
  { WBC: 14.52, RBC: 2.49, HGB: 7.4, HCT: 23.1, MCV: 92.8, MCH: 29.7, MCHC: 32.0, RDW: 14.7, PLT: 22.0, NEUTp: 57.4 },
  { WBC: 24.64, RBC: 2.02, HGB: 6.1, HCT: 18.8, MCV: 93.1, MCH: 30.2, MCHC: 32.4, RDW: 14.9, PLT: 28.0, NEUTp: 61.4 },
  { WBC: 2.75, RBC: 1.98, HGB: 6.6, HCT: 20.8, MCV: 105.1, MCH: 33.3, MCHC: 31.7, RDW: 19.6, PLT: 34.0, NEUTp: 85.8 },
];
const BORDERLINE_ROW = { WBC: 8.7, RBC: 4.31, HGB: 15.3, HCT: 43.0, MCV: 99.8, MCH: 35.5, MCHC: 35.6, RDW: 12.9, PLT: 220.0, NEUTp: 71.4 };

async function main() {
  const db = new Client({
    host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), database: process.env.PGDATABASE,
    user: process.env.PGUSER, password: process.env.PGPASSWORD,
  });
  await db.connect();
  try {
    await run(db);
  } finally {
    await db.end();
  }
}

async function run(db) {
  log(`# FedHealth Phase A API acceptance run ${new Date().toISOString()}`);
  log(`Backend ${BASE}; inference ${INFER}; run id ${RUN}. Tokens, TOTP secrets and passwords are redacted.`);

  log('\n## A0 Services and accounts (MFA flow)');
  const health = await http('GET', '/health/inference');
  check('inference service healthy and serving the hybrid', health.data.ok === true, short(health.data));
  const admin = await enrol('admin', `e2e-admin-${RUN}@fedhealth.test`);
  const doctorEnrol = await enrol('doctor', `e2e-doctor-${RUN}@fedhealth.test`);
  const nih = await enrol('nih_official', `e2e-nih-${RUN}@nih.org.pk`);
  const tech = await enrol('lab_tech', `e2e-labtech-${RUN}@fedhealth.test`);
  log('  - doctor signs in again: password step, then TOTP step');
  const login = await http('POST', '/auth/login', { body: { email: doctorEnrol.email, password: doctorEnrol.password } });
  check('password accepted, second factor required', login.status === 200 && login.data.mfaRequired === true);
  const mfa = await http('POST', '/auth/mfa/verify', { token: login.data.preAuthToken, body: { code: totp(doctorEnrol.secret) } });
  check('TOTP accepted, access token issued', mfa.status === 200 && !!mfa.data.accessToken);
  const doctor = mfa.data.accessToken;
  const pre = await http('POST', '/predict', { token: login.data.preAuthToken, body: {} });
  check('pre-auth token cannot call clinical routes', pre.status === 401);

  log('\n## A1 Doctor posts the example report with printed units');
  const patientRef = `e2e-pt-${RUN}`;
  const a1 = await http('POST', '/predict', {
    token: doctor,
    body: { patientRef, sex: 'F', ageYears: 34, district: 'Lahore', province: 'Punjab',
            symptomsText: 'fatigue and pale skin', cbc: EXAMPLE_CBC, units: EXAMPLE_UNITS },
  });
  const s1 = a1.data.inference?.scores || {};
  log(`    → scores ${short(s1)}; model ${short(a1.data.model)}; top ${a1.data.prediction?.top_condition}`);
  check('201 with exactly the four class scores in order', a1.status === 201 && JSON.stringify(Object.keys(s1)) === JSON.stringify(CLASSES));
  check('scores match the recorded acceptance sample (±0.001)',
    Object.entries(EXPECTED).every(([k, v]) => Math.abs(s1[k] - v) < 0.001), short(Object.fromEntries(Object.entries(s1).map(([k, v]) => [k, +v.toFixed(3)]))));
  check('model version and registry row returned', a1.data.model?.version === 'v2-four-class-seed42-b24108b19482' && a1.data.model?.active === true);
  check('screening disclaimer and model-input list returned', /not a diagnosis/.test(a1.data.screening?.disclaimer || '')
    && JSON.stringify(a1.data.screening?.modelInputs) === JSON.stringify(FEATURES), a1.data.screening?.disclaimer);
  check('report stored in canonical units (WBC 9.01, PLT 147)', a1.data.report?.cbc?.WBC === 9.01 && a1.data.report?.cbc?.PLT === 147);
  await sql(db, `SELECT id, source, sex, age_years, district, cbc, cbc_units, cbc_reported, symptoms->'tags' AS symptom_tags
                   FROM lab_reports WHERE id = $1`, [a1.data.report?.id]);
  const [p1] = await sql(db, `SELECT p.id, p.scores, p.top_condition, round(p.top_confidence::numeric,3) AS top_confidence,
                                     p.risk_flag, p.imputed_features, p.rule_flags, m.version AS model_version
                                FROM predictions p JOIN ml_models m ON m.id = p.model_id WHERE p.id = $1`, [a1.data.prediction?.id]);
  check('predictions.scores keys are exactly the four classes', JSON.stringify(Object.keys(p1?.scores || {}).sort()) === JSON.stringify([...CLASSES].sort()));
  const [lr1] = await sql(db, `SELECT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(cbc) k) AS cbc_keys FROM lab_reports WHERE id = $1`, [a1.data.report?.id]);
  check('lab_reports.cbc keys are exactly the 10 features', JSON.stringify(lr1?.cbc_keys) === JSON.stringify([...FEATURES].sort()));

  log('\n## A2 OCR path (report text) returns the 10 keys plus printed units');
  const a2 = await http('POST', '/ocr', { token: doctor, body: { text: EXAMPLE_TEXT } });
  log(`    → cbc ${short(a2.data.cbc)}`);
  log(`    → units ${short(a2.data.units)}; missing ${short(a2.data.missing)}`);
  check('OCR found all 10 features with a printed unit each', a2.data.extractedCount === 10
    && FEATURES.every((f) => typeof a2.data.units?.[f] === 'string'));
  check('OCR values and units equal the report', JSON.stringify(a2.data.cbc) === JSON.stringify(EXAMPLE_CBC)
    && FEATURES.every((f) => a2.data.units[f].toLowerCase() === EXAMPLE_UNITS[f].toLowerCase()));
  const a2p = await http('POST', '/predict', {
    token: doctor, body: { patientRef, source: 'ocr', district: 'Lahore', province: 'Punjab', cbc: a2.data.cbc, units: a2.data.units },
  });
  check('OCR output accepted by /predict with identical scores', a2p.status === 201
    && CLASSES.every((c) => Math.abs(a2p.data.inference.scores[c] - s1[c]) < 1e-9));
  const fd = new FormData();
  fd.append('image', new Blob([Buffer.from('not really an image')], { type: 'image/png' }), 'report.png');
  const img = await http('POST', '/ocr', { token: doctor, raw: fd });
  check('image OCR without the tesseract engine answers 501 (not a crash)', img.status === 501, img.data.error);
  const hist = await http('GET', `/patients/${patientRef}/history`, { token: doctor });
  check('patient history returns both reports with their latest prediction', hist.status === 200 && hist.data.length === 2
    && hist.data.every((r) => r.prediction && r.prediction.model_version));

  log('\n## A3 Doctor confirms a diagnosis; audit chain verifies');
  const predictionId = a1.data.prediction?.id;
  const a3 = await http('POST', `/predictions/${predictionId}/confirm`, { token: doctor, body: { confirmedCondition: 'anemia', notes: 'E2E: iron studies ordered' } });
  check('confirmation stored', a3.status === 200 && a3.data.confirmed_condition === 'anemia' && !!a3.data.confirmed_at);
  const techToken = tech.token;
  const t3 = await http('POST', `/predictions/${predictionId}/confirm`, { token: techToken, body: { confirmedCondition: 'healthy' } });
  check('lab technician cannot confirm (RBAC)', t3.status === 403);
  await new Promise((r) => setTimeout(r, 300)); // audit rows are appended on response 'finish'
  const audit = await sql(db, `SELECT id, action, actor_role, resource_type, resource_id, metadata->>'status' AS status
                                 FROM audit_logs WHERE resource_id = $1 ORDER BY id`, [predictionId]);
  check('CONFIRM_DIAGNOSIS audit entries recorded (success and the rejected attempt)',
    audit.some((a) => a.action === 'CONFIRM_DIAGNOSIS' && a.status === '200') && audit.some((a) => a.status === '403'));
  const chain = await http('GET', '/audit/verify', { token: admin.token });
  log(`    → ${short(chain.data)}`);
  check('audit hash chain verifies (API, admin)', chain.data.ok === true && chain.data.broken_at === null);
  const [dbChain] = await sql(db, 'SELECT * FROM verify_audit_chain()');
  check('audit hash chain verifies (SQL)', dbChain.ok === true);
  let blocked = null;
  try { await db.query('UPDATE audit_logs SET action = action WHERE id = $1', [audit[0]?.id]); } catch (e) { blocked = e.code; }
  check('audit_logs cannot be updated by the app role', blocked === '42501', `SQLSTATE ${blocked}`);

  log('\n## A4 High leukemia scores raise alerts and NIH surveillance entries');
  const district = `E2E-District-${RUN}`;
  const flagged = [];
  for (const [i, cbc] of LEUKEMIA_ROWS.entries()) {
    const r = await http('POST', '/predict', { token: doctor, body: { patientRef: `e2e-leuk-${RUN}-${i}`, district, province: 'Punjab', cbc, canonicalUnits: true } });
    log(`    → leukemia ${r.data.inference?.scores?.leukemia?.toFixed(3)}; risk_flag ${r.data.prediction?.risk_flag}; alerts ${short((r.data.alerts || []).map((a) => [a.type, a.condition, a.severity]))}`);
    flagged.push(r);
  }
  check('each case raised a high_risk_case alert for leukemia', flagged.every((r) => r.data.alerts?.some((a) => a.type === 'high_risk_case' && a.condition === 'leukemia')));
  check('third case in the district raised one leukemia outbreak_cluster alert',
    flagged[2].data.alerts?.some((a) => a.type === 'outbreak_cluster' && a.condition === 'leukemia')
    && !flagged[0].data.alerts?.some((a) => a.type === 'outbreak_cluster'));
  const border = await http('POST', '/predict', { token: doctor, body: { patientRef: `e2e-border-${RUN}`, district: 'Lahore', province: 'Punjab', cbc: BORDERLINE_ROW, canonicalUnits: true } });
  log(`    → top ${border.data.prediction?.top_condition} ${border.data.prediction?.top_confidence}; leukemia ${border.data.inference?.scores?.leukemia?.toFixed(3)}; alerts ${short((border.data.alerts || []).map((a) => [a.type, a.condition]))}`);
  check('risk flag from leukemia score is alerted as leukemia even when another class is top',
    border.data.prediction?.top_condition !== 'leukemia' && border.data.alerts?.some((a) => a.type === 'high_risk_case' && a.condition === 'leukemia'));
  await sql(db, `SELECT type, condition, severity, district, payload FROM alerts WHERE district = $1 ORDER BY created_at`, [district]);
  const nihAlerts = await http('GET', '/nih/alerts?status=open&limit=50', { token: nih.token });
  check('NIH alert feed lists the district alerts with class names only', nihAlerts.status === 200
    && nihAlerts.data.filter((a) => a.district === district).length === 4
    && nihAlerts.data.every((a) => a.condition === null || CLASSES.includes(a.condition)));
  const clusters = await http('GET', '/nih/clusters?condition=leukemia', { token: nih.token });
  const mine = clusters.data.find((c) => c.district === district);
  log(`    → cluster ${short(mine)}`);
  check('NIH cluster view aggregates the leukemia cases (no patient data)', mine?.case_count === 3 && mine?.high_risk_count === 3
    && !('patient_ref' in (mine || {})) && !('cbc' in (mine || {})));
  const badCond = await http('GET', '/nih/clusters?condition=iron_deficiency_anemia', { token: nih.token });
  check('NIH cluster filter rejects an old nine-class name', badCond.status === 400);
  const nihPredict = await http('POST', '/predict', { token: nih.token, body: { patientRef: 'x', cbc: { HGB: 12 }, canonicalUnits: true } });
  const nihHistory = await http('GET', `/patients/${patientRef}/history`, { token: nih.token });
  check('NIH role cannot reach patient-level routes', nihPredict.status === 403 && nihHistory.status === 403);

  log('\n## A5 Model Health endpoints (API part)');
  const mh = {};
  for (const ep of ['summary', 'runs', 'accuracy-history', 'nodes', 'node-contribution', 'data-intake', 'training-data', 'encryption', 'limitations']) {
    mh[ep] = (await http('GET', `/model-health/${ep}`, { token: nih.token })).data;
  }
  const am = mh.summary.activeModel || {};
  log(`    → summary.activeModel ${short({ name: am.name, version: am.version, calibration: am.calibration, classes: am.classes, accuracy: am.metrics?.accuracy, macro_f1: am.metrics?.macro_f1, split: am.metrics?.split })}`);
  log(`    → summary.trainingRuns ${short(mh.summary.trainingRuns)}`);
  check('registered real model with measured test metrics', am.name === 'cbc_multiclass' && am.version === 'v2-four-class-seed42-b24108b19482'
    && am.calibration === 'temperature_scaling' && am.metrics?.accuracy === 0.8875 && am.metrics?.split === 'test'
    && JSON.stringify(am.classes) === JSON.stringify(CLASSES));
  check('12 plaintext federated runs imported', mh.summary.trainingRuns?.byEncryption?.none === 12);
  log(`    → accuracy-history run ${short(mh['accuracy-history'].run)}; ${mh['accuracy-history'].points?.length} points (${mh['accuracy-history'].metric_split})`);
  check('accuracy history is validation per round incl. round 0', mh['accuracy-history'].metric_split === 'validation'
    && mh['accuracy-history'].points?.[0]?.round_number === 0);
  log(`    → nodes ${short(mh.nodes.map((n) => [n.lab_id, n.runs, n.min_train_rows, n.max_train_rows]))}`);
  check('FL nodes are the run lab ids (lab-00..lab-04)', JSON.stringify(mh.nodes.map((n) => n.lab_id)) === JSON.stringify(['lab-00', 'lab-01', 'lab-02', 'lab-03', 'lab-04']));
  log(`    → encryption ${short({ ...mh.encryption, encryptedRuns: mh.encryption.encryptedRuns?.map((r) => ({ scenario: r.scenario, rounds: r.total_rounds, key_bits: r.key_bits, max_abs_weight_difference: r.max_abs_weight_difference })) })}`);
  const paillierRuns = mh.encryption.runsByScheme?.paillier || 0;
  check('encryption card data: plaintext runs are "none"; paillier only for recorded encrypted runs',
    mh.encryption.runsByScheme?.none === 12 && mh.encryption.encryptedRuns.length === paillierRuns
    && mh.encryption.encryptedRuns.every((r) => r.key_bits >= 2048));
  log(`    → limitations ${short({ holdout: mh.limitations.sourceHoldout?.ann_accuracy_range, kept0: mh.limitations.federation?.keptRoundZero, of: mh.limitations.federation?.plaintextRuns })}`);
  check('limitations: source-holdout 0.29-0.87 and 9 of 12 runs kept round 0',
    Math.abs(mh.limitations.sourceHoldout?.ann_accuracy_range?.[0] - 0.291) < 0.001
    && Math.abs(mh.limitations.sourceHoldout?.ann_accuracy_range?.[1] - 0.868) < 0.001
    && mh.limitations.federation?.keptRoundZero === 9 && mh.limitations.federation?.plaintextRuns === 12);
  check('training-data counts come from the provenance file (3,200 rows, 800 per class)',
    mh['training-data'].rows === 3200 && mh['training-data'].by_split_class?.test?.leukemia === 120);
  const nodeCon = await http('GET', '/model-health/summary', { token: doctor });
  check('doctor cannot open Model Health (nih:dashboard only)', nodeCon.status === 403);

  log('\n## A6 Invalid inputs are rejected consistently (API, inference service, DB)');
  const cases = [
    ['out-of-range value (HGB 40 g/dL)', { cbc: { ...EXAMPLE_CBC, HGB: 40 }, units: EXAMPLE_UNITS }],
    ['wrong unit (WBC in mmol/L)', { cbc: EXAMPLE_CBC, units: { ...EXAMPLE_UNITS, WBC: 'mmol/L' } }],
    ['missing units', { cbc: EXAMPLE_CBC }],
    ['a value without its unit', { cbc: EXAMPLE_CBC, units: { ...EXAMPLE_UNITS, PLT: undefined } }],
    ['raw magnitude declared canonical (WBC 9010 10^3/uL)', { cbc: EXAMPLE_CBC, canonical_units: true }],
    ['unknown field (FOO, not a model feature)', { cbc: { ...EXAMPLE_CBC, FOO: 1 }, units: EXAMPLE_UNITS }],
  ];
  const key = process.env.INFERENCE_API_KEY ? { 'X-API-Key': process.env.INFERENCE_API_KEY } : {};
  for (const [label, c] of cases) {
    const units = c.units && JSON.parse(JSON.stringify(c.units));
    const api = await http('POST', '/predict', { token: doctor, quiet: true,
      body: { patientRef: 'e2e-invalid', cbc: c.cbc, ...(units ? { units } : {}), ...(c.canonical_units ? { canonicalUnits: true } : {}) } });
    const svc = await http('POST', '/infer', { base: INFER, headers: key, quiet: true,
      body: { cbc: c.cbc, ...(units ? { units } : {}), ...(c.canonical_units ? { canonical_units: true } : {}) } });
    log(`  - ${label}: API ${api.status} "${api.data.error}" | inference ${svc.status} "${svc.data.error}"`);
    check(`${label} rejected by API and inference service`, api.status === 400 && svc.status === 400);
  }
  const conf = await http('POST', `/predictions/${predictionId}/confirm`, { token: doctor, body: { confirmedCondition: 'iron_deficiency_anemia' } });
  check('unknown class rejected by the confirm API', conf.status === 400);
  const [{ n: storedInvalid }] = (await db.query(`SELECT count(*)::int AS n FROM lab_reports WHERE patient_ref = 'e2e-invalid'`)).rows;
  check('no report stored for any rejected request', storedInvalid === 0);
  const [{ id: modelId }] = (await db.query(`SELECT id FROM ml_models WHERE is_active`)).rows;
  const [{ id: userId }] = (await db.query(`SELECT id FROM users WHERE email = $1`, [doctorEnrol.email])).rows;
  const ins = `INSERT INTO lab_reports (created_by, source, patient_ref, cbc) VALUES ($1, 'manual', 'e2e-db', $2)`;
  await dbRejects(db, 'out-of-range canonical value', ins, [userId, JSON.stringify({ HGB: 40 })]);
  await dbRejects(db, 'raw unconverted value (WBC 9010)', ins, [userId, JSON.stringify({ WBC: 9010 })]);
  await dbRejects(db, 'unknown CBC key', ins, [userId, JSON.stringify({ FOO: 1 })]);
  await dbRejects(db, 'old nine-class scores', `INSERT INTO predictions (lab_report_id, model_id, scores) VALUES ($1, $2, $3)`,
    [a1.data.report.id, modelId, JSON.stringify({ iron_deficiency_anemia: 0.7, healthy: 0.3 })]);
  await dbRejects(db, 'top_condition that is not the arg-max', `INSERT INTO predictions (lab_report_id, model_id, scores, top_condition, top_confidence) VALUES ($1, $2, $3, 'healthy', 0.224)`,
    [a1.data.report.id, modelId, JSON.stringify(EXPECTED)]);
  await dbRejects(db, 'unknown confirmed_condition', `UPDATE predictions SET confirmed_by = $1, confirmed_condition = 'beta_thal_trait' WHERE id = $2`,
    [userId, predictionId]);

  log(`\n**Result: ${passed} passed, ${failed} failed.**`);
  const file = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  if (file) fs.writeFileSync(file, `${out.join('\n')}\n`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
