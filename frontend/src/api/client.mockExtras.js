// DEMO-ONLY additions to the mock backend (client.mock.js): the routes added
// for production readiness, in the same response shapes as the real API.
//   patient IDs, explanation + guidance on a prediction, confirmed-case dataset
//   with de-duplication, voice dictation, sign-up proof review, admin console,
//   model serving / failover drill, administrator access to any NGO.
// Nothing here is model output: explanations are a deterministic illustration
// derived from the entered values and are labelled as mock by the caller.
import { CLASSES, FEATURES, CANONICAL_UNITS, FEATURE_LABELS } from '../lib/contract.js';
import { generateRef, patientRefError, normalizeRef } from '../lib/patientRef.js';
import guidance from '../lib/clinicalGuidance.json' with { type: 'json' };

const delay = (ms = 300) => new Promise((res) => setTimeout(res, ms));
export function mockError(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

// ---- guidance (the real knowledge base, bundled) ------------------------------
export function guidanceFor(condition) {
  const entry = guidance.conditions[condition];
  if (!entry) return null;
  const ids = [...new Set([...entry.confirmatoryTests, ...entry.management].flatMap((i) => i.sources || []))];
  return {
    condition, version: guidance.version, disclaimer: guidance.disclaimer, reviewNote: guidance.reviewNote, ...entry,
    sources: ids.filter((id) => guidance.sources[id]).map((id) => ({ id, ...guidance.sources[id] })),
  };
}

// ---- explanation (illustrative) -----------------------------------------------
const REFERENCE = {
  WBC: { any: [4.0, 11.0] }, RBC: { M: [4.5, 5.9], F: [4.1, 5.1], any: [4.1, 5.9] },
  HGB: { M: [13.0, 17.5], F: [12.0, 15.5], any: [12.0, 17.5] }, HCT: { M: [40, 52], F: [36, 46], any: [36, 52] },
  MCV: { any: [80, 100] }, MCH: { any: [27, 33] }, MCHC: { any: [32, 36] }, RDW: { any: [11.5, 14.5] },
  PLT: { any: [150, 450] }, NEUTp: { any: [40, 75] },
};
const MEDIANS = { WBC: 7.4, RBC: 4.6, HGB: 12.6, HCT: 38.5, MCV: 84, MCH: 27.6, MCHC: 32.8, RDW: 13.8, PLT: 262, NEUTp: 58 };

export function mockExplanation(canonical, scores, top, sex) {
  const baseline = Object.fromEntries(CLASSES.map((c) => [c, 0.25]));
  // Weight of each measured value: how far it sits from its reference interval's middle.
  const weight = {};
  for (const f of FEATURES) {
    if (canonical[f] == null) continue;
    const [lo, hi] = REFERENCE[f][sex] || REFERENCE[f].any;
    weight[f] = Math.abs(canonical[f] - (lo + hi) / 2) / ((hi - lo) / 2) + 0.15;
  }
  const total = Object.values(weight).reduce((a, b) => a + b, 0) || 1;
  const features = FEATURES.map((f, i) => {
    const value = canonical[f] ?? null;
    const [low, high] = REFERENCE[f][sex] || REFERENCE[f].any;
    const status = value == null ? 'not_measured' : value < low ? 'low' : value > high ? 'high' : 'normal';
    return {
      feature: f, label: FEATURE_LABELS[f], unit: CANONICAL_UNITS[f], value, measured: value != null,
      reference: { low, high, sexSpecific: !!REFERENCE[f][sex] }, status,
      about: `${FEATURE_LABELS[f]} (demo text; the live API gives the clinical meaning of each index).`,
      meaning: { low: 'Below the typical adult reference interval.', high: 'Above the typical adult reference interval.',
                 normal: 'Within the typical adult reference interval.', not_measured: 'Not on this report; the model used the training median for it.' }[status],
      trainingMedian: MEDIANS[f],
      // Shares of (score - baseline), alternating sign slightly so both directions show.
      contributions: value == null ? Object.fromEntries(CLASSES.map((c) => [c, 0])) : Object.fromEntries(CLASSES.map((c, j) => {
        const gap = scores[c] - baseline[c];
        const tilt = ((i + j) % 4 === 0 ? -0.35 : 1);
        return [c, +(gap * (weight[f] / total) * tilt).toFixed(4)];
      })),
    };
  });
  // Re-scale so the contributions add up exactly to score - baseline (the Shapley property).
  for (const c of CLASSES) {
    const sum = features.reduce((a, f) => a + f.contributions[c], 0);
    const gap = scores[c] - baseline[c];
    const k = Math.abs(sum) > 1e-9 ? gap / sum : 0;
    features.forEach((f) => { f.contributions[c] = +(f.contributions[c] * k).toFixed(4); });
  }
  const drivers = features.filter((f) => f.measured)
    .map((f) => ({ feature: f.feature, label: f.label, status: f.status, contribution: f.contributions[top] }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return {
    available: true, unavailableReason: null,
    referenceNote: 'Typical adult reference intervals (haemoglobin lower limits are the WHO anaemia cut-offs). '
      + 'Children, pregnancy and each laboratory\'s own intervals differ; use the interval printed on the report when it differs.',
    sexUsedForReference: sex === 'M' || sex === 'F' ? sex : null,
    features,
    abnormal: features.filter((f) => f.status === 'low' || f.status === 'high').map((f) => ({ feature: f.feature, status: f.status })),
    attribution: {
      method: 'demo_illustration',
      note: 'Demo mode: these bars are an illustration derived from the entered values, not Shapley values from the model. With the live API they are exact Shapley values.',
      targetClass: top, score: scores[top], baselineScore: baseline[top], baselineScores: baseline, drivers,
      modelEvaluations: 2 ** drivers.length, ms: 1,
    },
  };
}

// ---- in-memory state ----------------------------------------------------------
const ago = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
const accounts = [
  { id: 'acc-1', email: 'dr.sana.malik@example.pk', full_name: 'Dr Sana Malik', role: 'doctor', organization: 'Mayo Hospital Lahore', status: 'active',
    verification_status: 'pending', created_at: ago(5), proof_doc_type: 'medical_license', proof_filename: 'pmdc-licence.png', proof_uploaded_at: ago(5) },
  { id: 'acc-2', email: 'info@sehatfoundation.example', full_name: 'Sehat Foundation', role: 'ngo', organization: 'Sehat Foundation', status: 'active',
    verification_status: 'pending', created_at: ago(30), proof_doc_type: 'ngo_registration', proof_filename: 'registration-certificate.png', proof_uploaded_at: ago(30) },
  { id: 'acc-3', email: 'tech.imran@lab.example.pk', full_name: 'Imran Qureshi', role: 'lab_tech', organization: 'PIMS Lab', lab_name: 'PIMS Lab - Islamabad', status: 'active',
    verification_status: 'approved', verified_by_name: 'Demo Admin', created_at: ago(400), proof_doc_type: 'lab_employee_card', proof_filename: 'staff-card.png', proof_uploaded_at: ago(400) },
  { id: 'acc-4', email: 'someone@mail.example', full_name: 'Unverified Applicant', role: 'doctor', organization: '', status: 'active',
    verification_status: 'rejected', verification_note: 'The licence image is unreadable; upload a clearer scan.', verified_by_name: 'Demo Admin',
    created_at: ago(90), proof_doc_type: 'medical_license', proof_filename: 'photo.png', proof_uploaded_at: ago(90) },
];
const dataset = new Map(); // record key -> { label, cbc, modelTop }
let confirmations = 0;
const predictions = new Map(); // prediction id -> { canonical, top }
const serving = { drill: false, failovers: 0, backupServed: 0, lastBackupAt: null };
const adminRequests = new Map(); // ngo id -> requests created by the admin this session

export const servedBy = () => (serving.drill ? 'backup' : 'primary');
export function rememberPrediction(id, canonical, top) {
  predictions.set(String(id), { canonical, top });
  if (serving.drill) { serving.backupServed += 1; serving.lastBackupAt = new Date().toISOString(); }
}

/** Account state for a mock login; null when the email never registered this session. */
export function accountFor(email) {
  return accounts.find((a) => a.email.toLowerCase() === String(email).toLowerCase()) || null;
}
export function addPendingAccount({ email, fullName, role, organization, labName, proofName }) {
  const docType = { doctor: 'medical_license', nih_official: 'employee_card', lab_tech: 'lab_employee_card', ngo: 'ngo_registration' }[role];
  accounts.unshift({
    id: `acc-${Date.now()}`, email, full_name: fullName, role, organization: organization || '', lab_name: labName || null, status: 'active',
    verification_status: 'pending', created_at: new Date().toISOString(),
    proof_doc_type: docType, proof_filename: proofName || 'proof.pdf', proof_uploaded_at: new Date().toISOString(),
  });
}

// A small generated image standing in for an uploaded proof document.
async function sampleProofBlob(account) {
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 400;
  const g = canvas.getContext('2d');
  g.fillStyle = '#f4f8f7'; g.fillRect(0, 0, 640, 400);
  g.strokeStyle = '#1f7a7a'; g.lineWidth = 6; g.strokeRect(14, 14, 612, 372);
  g.fillStyle = '#1f5d62'; g.font = 'bold 26px sans-serif';
  g.fillText({ medical_license: 'MEDICAL LICENCE', employee_card: 'GOVERNMENT EMPLOYEE CARD', lab_employee_card: 'LABORATORY STAFF CARD', ngo_registration: 'CERTIFICATE OF REGISTRATION' }[account.proof_doc_type] || 'PROOF', 40, 70);
  g.fillStyle = '#24323a'; g.font = '20px sans-serif';
  g.fillText(`Name: ${account.full_name}`, 40, 130);
  g.fillText(`Organisation: ${account.organization || '—'}`, 40, 165);
  g.fillText('Registration no.: DEMO-000000', 40, 200);
  g.fillStyle = '#8a6d1f'; g.font = 'italic 18px sans-serif';
  g.fillText('Sample document generated by the demo (mock API)', 40, 350);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

const recordKey = (cbc, label) => `${FEATURES.map((f) => (cbc[f] == null ? '' : String(+cbc[f]))).join('|')}|${label}`;

/**
 * Handle one of the added routes. Returns undefined when the path is not one of
 * them, so client.mock.js falls through to its own handlers.
 * ctx: { method, pathname, params, body, session, ngoDirectory, supplyRequests }
 */
export async function extraRoute({ method, pathname, params, body, session, ngoDirectory, supplyRequests }) {
  const isAdmin = session?.role === 'admin';

  if (pathname === '/patients/new-ref' && method === 'GET') {
    await delay(150);
    return { patientRef: generateRef(), format: 'FH-XXXX-XXXX' };
  }

  const rec = pathname.match(/^\/recommendations\/([a-z]+)$/);
  if (rec && method === 'GET') {
    await delay(200);
    const g = guidanceFor(rec[1]);
    if (!g) throw mockError(404, 'No guidance for that condition');
    return g;
  }

  if (pathname === '/symptoms/transcribe' && method === 'UPLOAD') {
    await delay(1200);
    const language = body.get('language') || 'mixed';
    const text = { en: 'Patient reports fatigue and pale skin for three weeks, with shortness of breath on exertion.',
                   ur: 'مریض کو تین ہفتوں سے تھکن اور کمزوری ہے، سانس پھولنا بھی ہے۔',
                   mixed: 'Patient ko teen hafton se fever hai, bohat thakan aur weakness, aur bone pain bhi hai.' }[language];
    const dict = { fatigue: /fatigue|thak|تھکن/, weakness: /weakness|کمزوری/, pallor: /pale|پیلا/, breathlessness: /breath|سانس/, fever: /fever|بخار/, bone_pain: /bone pain|ہڈی/ };
    const tags = Object.entries(dict).filter(([, re]) => re.test(text.toLowerCase())).map(([k]) => k);
    return { text, requestedLanguage: language, detectedLanguage: language === 'en' ? 'en' : 'ur', durationSeconds: 6, engine: 'mock (no speech model)', ms: 1200,
             parsed: { language: language === 'mixed' ? 'mixed' : language, tags, symptoms: tags.map((tag) => ({ tag })), usedByModel: false } };
  }

  const confirm = pathname.match(/^\/predictions\/([^/]+)\/confirm$/);
  if (confirm && method === 'POST') {
    await delay(300);
    if (!CLASSES.includes(body.confirmedCondition)) throw mockError(400, 'Validation failed');
    confirmations += 1;
    const p = predictions.get(confirm[1]);
    const key = recordKey(p?.canonical || {}, body.confirmedCondition);
    const duplicate = dataset.has(key);
    if (!duplicate) dataset.set(key, { label: body.confirmedCondition, cbc: p?.canonical || {}, modelTop: p?.top });
    return { id: confirm[1], confirmed_condition: body.confirmedCondition, dataset: { added: !duplicate, duplicate, recordHash: `mock-${dataset.size}` } };
  }

  // ---- administrator ----------------------------------------------------------
  const adminOnly = () => { if (!isAdmin) throw mockError(403, 'Missing permission(s): user:manage'); };

  if (pathname === '/dataset/confirmed/summary' && method === 'GET') {
    adminOnly(); await delay(200);
    const rows = [...dataset.values()];
    return {
      records: rows.length, confirmations, duplicatesSkipped: Math.max(0, confirmations - rows.length),
      lastAdded: rows.length ? new Date().toISOString() : null,
      byLabel: Object.fromEntries(CLASSES.map((c) => [c, {
        records: rows.filter((r) => r.label === c).length, modelAgreed: rows.filter((r) => r.label === c && r.modelTop === c).length,
      }])),
    };
  }
  if (pathname === '/dataset/confirmed.csv' && method === 'DOWNLOAD') {
    adminOnly();
    const lines = [...dataset.entries()].map(([, r], i) => [`mock-${i + 1}`, r.label, ...FEATURES.map((f) => r.cbc[f] ?? ''), r.modelTop || '', 'mock', new Date().toISOString()].join(','));
    const csv = `${['record_hash', 'label', ...FEATURES, 'model_top_condition', 'model_version', 'confirmed_at'].join(',')}\n${lines.join('\n')}\n`;
    return { blob: new Blob([csv], { type: 'text/csv' }), filename: 'fedhealth_confirmed_cases.csv' };
  }
  if (pathname === '/admin/overview' && method === 'GET') {
    adminOnly(); await delay(200);
    return {
      users: accounts.length + 61, pending_verifications: accounts.filter((a) => a.verification_status === 'pending').length,
      suspended: accounts.filter((a) => a.status === 'suspended').length, reports: 72 + predictions.size, predictions: 72 + predictions.size,
      backup_served: serving.failovers, confirmed_cases: dataset.size, ngos: ngoDirectory.length, open_alerts: 3, byRole: [],
    };
  }
  if (pathname === '/admin/users' && method === 'GET') {
    adminOnly(); await delay(250);
    const v = params.get('verification');
    const rows = !v || v === 'all' ? accounts : accounts.filter((a) => a.verification_status === v);
    return [...rows].sort((a, b) => (b.verification_status === 'pending') - (a.verification_status === 'pending'));
  }
  const proof = pathname.match(/^\/admin\/users\/([^/]+)\/proof$/);
  if (proof && method === 'DOWNLOAD') {
    adminOnly(); await delay(300);
    const account = accounts.find((a) => a.id === proof[1]);
    if (!account) throw mockError(404, 'No proof document on file for this account');
    return { blob: await sampleProofBlob(account), filename: account.proof_filename };
  }
  const verification = pathname.match(/^\/admin\/users\/([^/]+)\/verification$/);
  if (verification && method === 'POST') {
    adminOnly(); await delay(300);
    const account = accounts.find((a) => a.id === verification[1]);
    if (!account) throw mockError(404, 'Account not found');
    if (body.decision === 'reject' && !(body.note || '').trim()) throw mockError(400, 'note: Give the reason for rejecting, so the applicant knows what to fix');
    Object.assign(account, {
      verification_status: body.decision === 'approve' ? 'approved' : 'rejected', verification_note: body.note || null,
      verified_by_name: session.fullName, verified_at: new Date().toISOString(),
    });
    return account;
  }
  const status = pathname.match(/^\/admin\/users\/([^/]+)\/status$/);
  if (status && method === 'POST') {
    adminOnly(); await delay(250);
    const account = accounts.find((a) => a.id === status[1]);
    if (!account) throw mockError(404, 'Account not found');
    account.status = body.status;
    return { id: account.id, status: account.status };
  }

  const servingStatus = () => ({
    ok: true, service: 'fedhealth-inference', serving: servedBy(), backupConfigured: true,
    primary: { ok: true, error: null, failover: {
      serving: servedBy(), drill_active: serving.drill,
      primary: { mode: 'centralized_hybrid', version: 'v2-four-class-seed42 (mock)', reason: null },
      backup: { mode: 'centralized_hybrid', version: 'v2-four-class-seed52 (mock)', reason: null } } },
    backupReplica: { configured: true, ok: true, error: null, version: 'v2-four-class-seed52 (mock)' },
    breaker: { open: false, lastError: null, lastFailureAt: null, failovers: serving.failovers },
  });
  if (pathname === '/model-health/serving' && method === 'GET') {
    if (!['admin', 'nih_official'].includes(session?.role)) throw mockError(403, 'Missing permission(s): nih:dashboard');
    await delay(200);
    return {
      checkedAt: new Date().toISOString(), serving: servedBy(), drillActive: serving.drill,
      primary: { reachable: true, available: true, version: 'v2-four-class-seed42 (mock)', mode: 'centralized_hybrid', reason: null,
                 registered: true, active: true, testAccuracy: 0.8875, macroF1: 0.8869 },
      backup: { configured: true, inProcess: { available: true, reason: null }, replica: { available: true },
                version: 'v2-four-class-seed52 (mock)', registered: true, active: false, testAccuracy: 0.8938, macroF1: 0.8937 },
      breaker: { open: false, failoversSinceStart: serving.failovers, lastPrimaryFaultAt: null },
      usage: { days: Number(params.get('days')) || 30, predictions: predictions.size, servedByBackup: serving.backupServed,
               lastServedByBackupAt: serving.lastBackupAt },
    };
  }
  if (pathname === '/admin/serving' && method === 'GET') { adminOnly(); await delay(200); return servingStatus(); }
  if (pathname === '/admin/failover-drill' && method === 'POST') {
    adminOnly(); await delay(400);
    serving.drill = !!body.primaryDown;
    return servingStatus();
  }

  // ---- administrator acting for any NGO ---------------------------------------
  if (pathname === '/help/admin/ngos' && method === 'GET') {
    if (!isAdmin) throw mockError(403, 'Missing permission(s): help:manage_all');
    await delay(250);
    return ngoDirectory.map((n) => {
      const all = [...(adminRequests.get(n.id) || []), ...supplyRequests.filter((r) => r.ngo_id === n.id)];
      return { ...n, owner_email: `${n.id}@sample.fedhealth.test`, request_count: all.length, open_request_count: all.filter((r) => r.status === 'open').length };
    });
  }
  const verified = pathname.match(/^\/help\/admin\/ngos\/([^/]+)\/verified$/);
  if (verified && method === 'POST') {
    if (!isAdmin) throw mockError(403, 'Missing permission(s): help:manage_all');
    await delay(250);
    const ngo = ngoDirectory.find((n) => n.id === verified[1]);
    if (!ngo) throw mockError(404, 'NGO not found');
    ngo.verified = !!body.verified;
    return ngo;
  }
  if (isAdmin && pathname.startsWith('/help/ngos/me')) {
    await delay(250);
    const ngo = ngoDirectory.find((n) => n.id === params.get('ngo'));
    if (!params.get('ngo')) throw mockError(400, 'Choose the NGO to manage (?ngo=<id>)');
    if (!ngo) throw mockError(404, 'NGO not found');
    const mine = adminRequests.get(ngo.id) || [];
    const all = () => [...(adminRequests.get(ngo.id) || []), ...supplyRequests.filter((r) => r.ngo_id === ngo.id)];
    if (pathname === '/help/ngos/me' && method === 'GET') return ngo;
    if (pathname === '/help/ngos/me' && method === 'PUT') {
      Object.assign(ngo, {
        name: body.name ?? ngo.name, mission: body.mission ?? ngo.mission, description: body.description ?? ngo.description,
        website: body.website ?? ngo.website, contact_email: body.contactEmail ?? ngo.contact_email, contact_phone: body.contactPhone ?? ngo.contact_phone,
        district: body.district ?? ngo.district, province: body.province ?? ngo.province,
      });
      return ngo;
    }
    if (pathname === '/help/ngos/me/requests' && method === 'GET') return all();
    if (pathname === '/help/ngos/me/requests' && method === 'POST') {
      const created = {
        id: `req-admin-${Date.now()}`, ngo_id: ngo.id, category: body.category, blood_group: body.bloodGroup || null, title: body.title,
        description: body.description || '', quantity: body.quantity || null, urgency: body.urgency || 'medium', status: 'open',
        needed_by: body.neededBy || null, district: body.district || ngo.district, province: body.province || ngo.province,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      adminRequests.set(ngo.id, [created, ...mine]);
      return created;
    }
    const patch = pathname.match(/^\/help\/ngos\/me\/requests\/([^/]+)$/);
    if (patch && method === 'PATCH') {
      const row = all().find((r) => r.id === patch[1]);
      if (!row) throw mockError(404, 'Request not found');
      Object.assign(row, body, { updated_at: new Date().toISOString() });
      return row;
    }
  }

  return undefined;
}

export { patientRefError, normalizeRef };
