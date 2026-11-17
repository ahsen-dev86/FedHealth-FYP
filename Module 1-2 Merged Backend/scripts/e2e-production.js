#!/usr/bin/env node
// backend/scripts/e2e-production.js
// ---------------------------------------------------------------------------
// End-to-end check of the production-readiness features against a RUNNING
// stack (tools/run-local.ps1 -Start) using the demo accounts
// (npm run demo:users):
//   1. patient ID issue + validation
//   2. prediction with Shapley explanation, reading and guideline recommendations
//   3. confirmed diagnosis -> dataset, identical record not duplicated
//   4. failover: drill (in-process backup) and, with --kill-primary-check,
//      reporting whether the backup replica is reachable
//   5. sign-up needs a proof document; the account is locked until an admin approves
//   6. admin reaches the NGO portal for any NGO; an NGO cannot address another
//   7. voice dictation (only when a WAV path is passed: --audio <file>)
//
//   node scripts/e2e-production.js [--audio path\to\clip.wav]
// Exits non-zero when any check fails.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const speakeasy = require('speakeasy');

const API = process.env.API_URL || 'http://127.0.0.1:4000';
const FILE = path.resolve(__dirname, '../../run-results/demo-accounts.txt');
const RUN = Date.now();
const results = [];

function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

function accounts() {
  const out = {};
  for (const line of fs.readFileSync(FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(\w+)\s+(\S+@\S+)\s+password:\s+(\S+)\s+mfa-key:\s+([A-Z2-7]+)$/);
    if (m) out[m[1]] = { email: m[2], password: m[3], secret: m[4] };
  }
  return out;
}

async function call(method, url, { token, body, form } = {}) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, type };
}

async function signIn({ email, password, secret }) {
  const login = await call('POST', '/auth/login', { body: { email, password } });
  if (login.status !== 200) throw new Error(`login ${email}: ${login.status} ${JSON.stringify(login.data)}`);
  const code = speakeasy.totp({ secret, encoding: 'base32' });
  const mfa = await call('POST', '/auth/mfa/verify', { token: login.data.preAuthToken, body: { code } });
  if (mfa.status !== 200) throw new Error(`mfa ${email}: ${mfa.status} ${JSON.stringify(mfa.data)}`);
  return mfa.data.accessToken;
}

// A one-page PDF: enough for the proof check (it is identified by its leading bytes).
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

// WBC and PLT vary per run, so each run confirms a record the dataset has not seen.
const CBC = {
  WBC: +(5 + (RUN % 397) / 100).toFixed(2), RBC: 3.4, HGB: 8.9, HCT: 28.5, MCV: 68.2, MCH: 21.4, MCHC: 31.2, RDW: 17.8,
  PLT: 300 + (Math.floor(RUN / 397) % 140), NEUTp: 58,
};

async function main() {
  const acct = accounts();
  const doctor = await signIn(acct.doctor);
  const admin = await signIn(acct.admin);

  // 1. patient ID
  const issued = await call('GET', '/patients/new-ref', { token: doctor });
  const ref = issued.data.patientRef;
  check('patient ID issued in FH-XXXX-XXXX format', /^FH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(ref || ''), ref);
  const bad = await call('POST', '/predict', { token: doctor, body: { patientRef: 'pt-007', cbc: CBC, canonicalUnits: true } });
  check('free-form patient reference is refused', bad.status === 400, bad.data.error);
  const typo = await call('POST', '/predict', {
    token: doctor, body: { patientRef: ref.slice(0, -1) + (ref.endsWith('0') ? '1' : '0'), cbc: CBC, canonicalUnits: true },
  });
  check('mistyped patient ID fails its check character', typo.status === 400, typo.data.error);

  // 2. prediction + explanation + recommendations
  const pred = await call('POST', '/predict', {
    token: doctor, body: { patientRef: ref.toLowerCase(), sex: 'F', ageYears: 31, cbc: CBC, canonicalUnits: true },
  });
  check('prediction stored (lower-case ID normalised)', pred.status === 201 && pred.data.report?.patient_ref === ref,
    `${pred.status} top=${pred.data.inference?.top_condition}`);
  const ex = pred.data.explanation || {};
  const top = pred.data.inference?.top_condition;
  const sum = (ex.attribution?.drivers || []).reduce((a, d) => a + d.contribution, 0);
  const gap = (ex.attribution?.score ?? 0) - (ex.attribution?.baselineScore ?? 0);
  check('Shapley contributions add up to score minus reference score', ex.available && Math.abs(sum - gap) < 2e-3,
    `sum ${sum.toFixed(4)} vs ${gap.toFixed(4)}; ${ex.attribution?.modelEvaluations} model evaluations in ${ex.attribution?.ms} ms`);
  check('each value is read against a reference interval', ex.features?.length === 10
    && ex.features.find((f) => f.feature === 'HGB')?.status === 'low', `abnormal: ${(ex.abnormal || []).map((a) => `${a.feature} ${a.status}`).join(', ')}`);
  const rec = pred.data.recommendations || {};
  check('recommendations for the top condition, with sources', rec.condition === top
    && rec.confirmatoryTests?.length > 0 && rec.sources?.length > 0, `${rec.title} (${rec.sources?.length} sources)`);
  check('served by the primary model', pred.data.serving?.servedBy === 'primary', pred.data.inference?.model_version);

  // 3. dataset de-duplication
  const before = (await call('GET', '/dataset/confirmed/summary', { token: admin })).data;
  const c1 = await call('POST', `/predictions/${pred.data.prediction.id}/confirm`, { token: doctor, body: { confirmedCondition: 'anemia' } });
  check('confirmed diagnosis added to the dataset', c1.status === 200 && c1.data.dataset?.added === true, JSON.stringify(c1.data.dataset));
  const again = await call('POST', '/predict', { token: doctor, body: { patientRef: ref, cbc: CBC, canonicalUnits: true } });
  const c2 = await call('POST', `/predictions/${again.data.prediction.id}/confirm`, { token: doctor, body: { confirmedCondition: 'anemia' } });
  check('identical record is not added twice', c2.status === 200 && c2.data.dataset?.duplicate === true && c2.data.dataset?.added === false,
    JSON.stringify(c2.data.dataset));
  const after = (await call('GET', '/dataset/confirmed/summary', { token: admin })).data;
  check('dataset grew by exactly one record', after.records === before.records + 1, `${before.records} -> ${after.records}`);
  const csv = await call('GET', '/dataset/confirmed.csv', { token: admin });
  check('dataset exports as CSV', csv.status === 200 && csv.data.toString().startsWith('record_hash,label,WBC'),
    `${csv.data.toString().trim().split('\n').length - 1} rows`);
  const csvDenied = await call('GET', '/dataset/confirmed.csv', { token: doctor });
  check('a doctor cannot export the dataset', csvDenied.status === 403);

  // 4. failover drill
  const on = await call('POST', '/admin/failover-drill', { token: admin, body: { primaryDown: true } });
  check('failover drill: primary marked down, backup serving', on.status === 200 && on.data.serving === 'backup', `serving=${on.data.serving}`);
  const viaBackup = await call('POST', '/predict', { token: doctor, body: { patientRef: ref, cbc: CBC, canonicalUnits: true } });
  check('prediction still answered, by the backup model', viaBackup.status === 201 && viaBackup.data.serving?.servedBy === 'backup'
    && viaBackup.data.inference?.model_version !== pred.data.inference?.model_version,
    `${viaBackup.status} ${viaBackup.data.inference?.model_version} (${viaBackup.data.serving?.failoverReason})`);
  const off = await call('POST', '/admin/failover-drill', { token: admin, body: { primaryDown: false } });
  check('drill ended, primary serving again', off.status === 200 && off.data.serving === 'primary');
  const health = (await call('GET', '/health/inference')).data;
  check('backup replica is up', health.backupReplica?.ok === true, `replica ${health.backupReplica?.version}`);
  const serving = await call('GET', '/model-health/serving?days=30', { token: admin });
  check('Model Health reports primary and backup availability', serving.status === 200 && serving.data.serving === 'primary'
    && serving.data.primary.available && serving.data.backup.inProcess?.available && serving.data.backup.replica?.available
    && serving.data.backup.testAccuracy > 0.8, `primary ${serving.data.primary?.version}, backup ${serving.data.backup?.version} ${serving.data.backup?.testAccuracy}`);
  check('Model Health counts predictions the backup served', serving.data.usage?.servedByBackup >= 1,
    `${serving.data.usage?.servedByBackup} of ${serving.data.usage?.predictions} in 30 days`);
  const servingDenied = await call('GET', '/model-health/serving', { token: doctor });
  check('a doctor cannot read model serving status', servingDenied.status === 403);
  const drillDenied = await call('POST', '/admin/failover-drill', { token: doctor, body: { primaryDown: true } });
  check('a doctor cannot run the drill', drillDenied.status === 403);

  // 5. proof document at sign-up
  const email = `e2e-proof-${RUN}@fedhealth.test`;
  const noProof = await call('POST', '/auth/register', { body: { email, password: 'Proof-test-12345', fullName: 'Proof Tester', role: 'doctor' } });
  check('sign-up without a proof document is refused', noProof.status === 400 && noProof.data.code === 'PROOF_REQUIRED', noProof.data.error);
  const fake = new FormData();
  Object.entries({ email, password: 'Proof-test-12345', fullName: 'Proof Tester', role: 'doctor' }).forEach(([k, v]) => fake.append(k, v));
  fake.append('proof', new Blob([Buffer.from('MZ this is not a document, just renamed')], { type: 'application/pdf' }), 'licence.pdf');
  const wrongType = await call('POST', '/auth/register', { form: fake });
  check('a file that only claims to be a PDF is refused', wrongType.status === 400 && wrongType.data.code === 'PROOF_TYPE', wrongType.data.error);
  const form = new FormData();
  Object.entries({ email, password: 'Proof-test-12345', fullName: 'Proof Tester', role: 'doctor', organization: 'E2E Clinic' })
    .forEach(([k, v]) => form.append(k, v));
  form.append('proof', new Blob([PDF], { type: 'application/pdf' }), 'pmdc-licence.pdf');
  const reg = await call('POST', '/auth/register', { form });
  check('sign-up with a proof document is accepted as pending', reg.status === 201 && reg.data.verificationStatus === 'pending', `${reg.status}`);
  const setup = await call('POST', '/auth/mfa/setup', { token: reg.data.preAuthToken, body: {} });
  const secret = setup.data.manualKey;
  const enrolled = await call('POST', '/auth/mfa/verify-setup', {
    token: reg.data.preAuthToken, body: { code: speakeasy.totp({ secret, encoding: 'base32' }) },
  });
  check('MFA enrols but no session is issued before approval', enrolled.status === 200 && enrolled.data.pendingVerification === true
    && !enrolled.data.accessToken);
  const blocked = await call('POST', '/auth/login', { body: { email, password: 'Proof-test-12345' } });
  check('sign-in is blocked while the proof is unreviewed', blocked.status === 403 && blocked.data.code === 'PENDING_VERIFICATION', blocked.data.error);
  const pending = await call('GET', '/admin/users?verification=pending', { token: admin });
  const row = (pending.data || []).find((u) => u.email === email);
  check('admin sees the pending account with its proof', !!row && row.proof_doc_type === 'medical_license', row?.proof_filename);
  const doc = await call('GET', `/admin/users/${row.id}/proof`, { token: admin });
  check('admin can open the proof document', doc.status === 200 && doc.type === 'application/pdf' && doc.data.equals(PDF));
  const docDenied = await call('GET', `/admin/users/${row.id}/proof`, { token: doctor });
  check('a doctor cannot open proof documents', docDenied.status === 403);
  const rejectNoNote = await call('POST', `/admin/users/${row.id}/verification`, { token: admin, body: { decision: 'reject' } });
  check('rejecting needs a reason', rejectNoNote.status === 400, rejectNoNote.data.error);
  const approved = await call('POST', `/admin/users/${row.id}/verification`, { token: admin, body: { decision: 'approve' } });
  check('admin approves the account', approved.status === 200 && approved.data.verification_status === 'approved');
  const session = await signIn({ email, password: 'Proof-test-12345', secret });
  const me = await call('GET', '/auth/me', { token: session });
  check('approved account signs in', me.status === 200 && me.data.role === 'doctor' && me.data.verificationStatus === 'approved');

  // 6. admin in the NGO portal
  const ngos = await call('GET', '/help/admin/ngos', { token: admin });
  check('admin lists every NGO', ngos.status === 200 && ngos.data.length > 0, `${ngos.data.length} NGOs`);
  const ngo = ngos.data[0];
  const profile = await call('GET', `/help/ngos/me?ngo=${ngo.id}`, { token: admin });
  check('admin opens an NGO profile', profile.status === 200 && profile.data.id === ngo.id, profile.data.name);
  const created = await call('POST', `/help/ngos/me/requests?ngo=${ngo.id}`, {
    token: admin, body: { category: 'blood', bloodGroup: 'O+', title: `E2E admin request ${RUN}`, urgency: 'low', quantity: '1 unit' },
  });
  check('admin posts a request for that NGO', created.status === 201 && created.data.ngo_id === ngo.id);
  const closed = await call('PATCH', `/help/ngos/me/requests/${created.data.id}?ngo=${ngo.id}`, { token: admin, body: { status: 'closed' } });
  check('admin updates that request', closed.status === 200 && closed.data.status === 'closed');
  const noNgo = await call('GET', '/help/ngos/me', { token: admin });
  check('admin must name the NGO', noNgo.status === 400, noNgo.data.error);
  const doctorNgo = await call('GET', `/help/ngos/me?ngo=${ngo.id}`, { token: doctor });
  check('a doctor cannot manage NGOs', doctorNgo.status === 403);

  // 6b. live federated-learning demonstration (a real 2-round run, about a minute)
  const nihAccount = acct.nih;
  const nih = nihAccount ? await signIn(nihAccount) : null;
  const flDoctor = await call('GET', '/model-health/federation', { token: doctor });
  check('a doctor cannot see the federated demo', flDoctor.status === 403);
  if (nih) {
    const nihStart = await call('POST', '/model-health/federation/runs', { token: nih, body: { rounds: 1 } });
    check('a health official can watch but not start a run', nihStart.status === 403);
  }
  const badRun = await call('POST', '/model-health/federation/runs', { token: admin, body: { rounds: 99 } });
  check('an out-of-range run is refused', badRun.status === 400, badRun.data.error);
  const started = await call('POST', '/model-health/federation/runs', {
    token: admin, body: { split: 'iid', start: 'scratch', encryption: 'none', rounds: 2 } });
  check('admin starts a federated run', started.status === 202 && started.data.status === 'running', started.data.error || started.data.id);
  const second = await call('POST', '/model-health/federation/runs', { token: admin, body: { rounds: 1 } });
  check('only one run at a time', second.status === 409);
  let fl = { run: { status: 'running' }, events: [] };
  const deadline = Date.now() + 240000;
  while (fl.run.status === 'running' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    fl = (await call('GET', `/model-health/federation/runs/${started.data.id}/events?after=0`, { token: nih || admin })).data;
  }
  const vals = fl.events.filter((e) => e.type === 'validation');
  const updates = fl.events.filter((e) => e.type === 'lab_update');
  const flSetup = fl.events.find((e) => e.type === 'setup');
  check('the run finished with 5 labs and 2 rounds', fl.run.status === 'finished' && flSetup?.labs.length === 5 && vals.length === 3,
    `${fl.run.status}, ${vals.length} validations`);
  check('every lab sent an update each round and no patient rows', updates.length === 10 && updates.every((u) => u.patient_rows_sent === 0 && u.update_bytes > 0));
  check('the global network learned from the labs', vals[2]?.accuracy > vals[0]?.accuracy + 0.3,
    vals.map((v) => `r${v.round} ${(v.accuracy * 100).toFixed(1)}%`).join(' -> '));
  const done = fl.events.find((e) => e.type === 'done');
  check('the run was not deployed', done?.deployed === false);
  check('the deployed model files were fingerprinted unchanged', done?.model_files_unchanged === true && done?.model_files_checked >= 5,
    `${done?.model_files_checked} files checked`);
  const servingAfter = await call('GET', '/model-health/serving', { token: admin });
  check('the serving model is unchanged after the run', servingAfter.data.primary?.version === serving.data.primary?.version);

  // 7. voice dictation
  const audioAt = process.argv.indexOf('--audio');
  if (audioAt > -1) {
    const clip = fs.readFileSync(process.argv[audioAt + 1]);
    for (const language of ['en', 'mixed']) {
      const fd = new FormData();
      fd.append('audio', new Blob([clip], { type: 'audio/wav' }), 'dictation.wav');
      fd.append('language', language);
      const t = await call('POST', '/symptoms/transcribe', { token: doctor, form: fd });
      check(`dictation transcribed (${language})`, t.status === 200 && /fever/i.test(t.data.text || '') && t.data.parsed?.tags?.includes('fever'),
        `${t.status} "${String(t.data.text || t.data.error).slice(0, 90)}" tags=${(t.data.parsed?.tags || []).join(',')} ${t.data.ms} ms`);
    }
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
