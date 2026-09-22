// DEMO-ONLY mock backend — NOT used by default (src/api/client.js is the real
// one, wired to the actual API and used by App.jsx/AuthContext.jsx etc.).
//
// Use this to click through the whole UI (login -> MFA -> Doctor Portal /
// Surveillance Dashboard) with dummy data when the backend (Module 2/6) isn't running.
// Enable it with VITE_USE_MOCK=true (see vite.config.js), rather than editing
// imports by hand.
//
// Same api.get/post/upload + setTokenGetter shape as the real client, so
// every page component works unmodified against it.
import qrcodegen from 'qrcode-generator';

const delay = (ms = 350) => new Promise((res) => setTimeout(res, ms));

let tokenGetter = () => null;
export function setTokenGetter(fn) { tokenGetter = fn; }

// ---- fake session state ---------------------------------------------------
let session = null; // { fullName, email, role, permissions }
let pendingMfaSetup = null; // in-flight /auth/mfa/setup promise, see route()

function roleFromEmail(email) {
  if (/nih/i.test(email)) return 'nih_official';
  if (/lab/i.test(email)) return 'lab_tech';
  if (/ngo/i.test(email)) return 'ngo';
  return 'doctor';
}
function permsForRole(role) {
  if (role === 'nih_official') return ['nih:dashboard'];
  if (role === 'ngo') return ['help:manage_own'];
  return ['prediction:create'];
}

// ---- real TOTP (RFC 6238, SHA-1, 6 digits, 30s step) ------------------------
// This is a genuine implementation (verified against the RFC 6238 Appendix B
// test vectors) so a real authenticator app (Google Authenticator, Authy,
// etc.) can scan the QR below and produce codes this mock actually accepts.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str) {
  const clean = str.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

function intToBytes(num) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(4, num >>> 0, false);
  view.setUint32(0, Math.floor(num / 2 ** 32), false);
  return new Uint8Array(buf);
}

async function hmacSha1(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
  return new Uint8Array(sig);
}

async function totpAt(secretBytes, counter) {
  const hmac = await hmacSha1(secretBytes, intToBytes(counter));
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
               ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

async function currentTotp(secretBytes, stepSeconds = 30) {
  return totpAt(secretBytes, Math.floor(Date.now() / 1000 / stepSeconds));
}

// Accepts the previous/current/next 30s step to tolerate clock drift.
async function verifyTotp(secretBytes, token, stepSeconds = 30, window = 1) {
  if (!/^\d{6}$/.test(token || '')) return false;
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  for (let w = -window; w <= window; w++) {
    if ((await totpAt(secretBytes, counter + w)) === token) return true;
  }
  return false;
}

// Persist the demo secret across page reloads (base32 string), so a
// returning login still verifies against the same authenticator entry.
const SECRET_STORAGE_KEY = 'fedhealth_demo_totp_secret';
function loadSecret() {
  const b32 = localStorage.getItem(SECRET_STORAGE_KEY);
  return b32 ? base32Decode(b32) : null;
}
function saveSecret(bytes) {
  localStorage.setItem(SECRET_STORAGE_KEY, base32Encode(bytes));
}

function otpauthUrl(email, secretBase32) {
  const label = encodeURIComponent(`FedHealth (demo):${email}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent('FedHealth (demo)')}&algorithm=SHA1&digits=6&period=30`;
}

// Real, scannable QR (not a placeholder) rendered as an inline SVG data URL.
function qrDataUrlFor(text) {
  const qr = qrcodegen(0, 'M');
  qr.addData(text);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 6, margin: 12 });
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// Convenience for testing without a phone: log the currently-valid code to
// devtools every 30s. Not part of any real API — purely a demo aid.
let demoLogTimer = null;
function startDemoCodeLogging(secretBytes) {
  if (demoLogTimer) clearInterval(demoLogTimer);
  const log = async () => {
    const code = await currentTotp(secretBytes);
    // eslint-disable-next-line no-console
    console.info(`%c[FedHealth demo] current MFA code: ${code} (valid ~30s, refreshes automatically)`, 'font-weight:bold');
  };
  log();
  demoLogTimer = setInterval(log, 30000);
}

// ---- dummy CBC / prediction data -------------------------------------------
const CONDITIONS = [
  'healthy', 'iron_deficiency_anemia', 'normocytic_hypochromic_anemia',
  'macrocytic_anemia', 'thrombocytopenia', 'leukemia', 'beta_thal_trait',
];

function randomScores() {
  const raw = CONDITIONS.map(() => Math.random() ** 2);
  const sum = raw.reduce((a, b) => a + b, 0);
  return Object.fromEntries(CONDITIONS.map((c, i) => [c, +(raw[i] / sum).toFixed(3)]));
}

let predictionSeq = 1;
const predictionsById = new Map();

function makePatientHistory(patientRef) {
  const n = 4 + (patientRef.length % 4);
  const base = { HGB: 13.5, MCV: 88, PLT: 260, WBC: 7.2, RBC: 4.8, MCH: 29 };
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    const drift = (n - 1 - i) * 0.4;
    out.push({
      id: `${patientRef}-${i}`,
      collected_at: new Date(now - i * 30 * 86400000).toISOString(),
      cbc: {
        HGB: +(base.HGB - drift * 0.3 + (Math.random() - 0.5)).toFixed(1),
        MCV: +(base.MCV - drift * 0.6 + (Math.random() - 0.5) * 2).toFixed(1),
        PLT: Math.round(base.PLT - drift * 8 + (Math.random() - 0.5) * 20),
        WBC: +(base.WBC + (Math.random() - 0.5)).toFixed(1),
        RBC: +(base.RBC - drift * 0.05).toFixed(2),
        MCH: +(base.MCH - drift * 0.2).toFixed(1),
      },
    });
  }
  return out;
}

// ---- dummy surveillance data -------------------------------------------------
const DISTRICTS = [
  { district: 'Lahore', province: 'Punjab', approx_lat: 31.55, approx_lng: 74.34 },
  { district: 'Faisalabad', province: 'Punjab', approx_lat: 31.42, approx_lng: 73.08 },
  { district: 'Karachi East', province: 'Sindh', approx_lat: 24.90, approx_lng: 67.13 },
  { district: 'Hyderabad', province: 'Sindh', approx_lat: 25.39, approx_lng: 68.37 },
  { district: 'Peshawar', province: 'KPK', approx_lat: 34.01, approx_lng: 71.58 },
  { district: 'Quetta', province: 'Balochistan', approx_lat: 30.18, approx_lng: 66.99 },
  { district: 'Islamabad', province: 'Islamabad', approx_lat: 33.68, approx_lng: 73.05 },
  { district: 'Gilgit', province: 'Gilgit-Baltistan', approx_lat: 35.92, approx_lng: 74.31 },
];
const SURVEILLANCE_CONDITIONS = ['leukemia', 'leukemia_with_thrombocytopenia', 'thrombocytopenia',
  'iron_deficiency_anemia', 'other_microcytic_anemia', 'macrocytic_anemia', 'beta_thal_trait'];

function makeClusters() {
  return DISTRICTS.map((d, i) => {
    const cases = 4 + ((i * 7) % 40);
    const highRisk = i % 3 === 0 ? Math.max(1, Math.round(cases * 0.15)) : 0;
    return {
      ...d,
      condition: SURVEILLANCE_CONDITIONS[i % SURVEILLANCE_CONDITIONS.length],
      case_count: String(cases),
      high_risk_count: String(highRisk),
      avg_confidence: (0.55 + ((i * 13) % 40) / 100).toFixed(2),
    };
  });
}

let alertSeq = 1;
const ALERTS = [
  { severity: 'critical', type: 'outbreak_cluster', title: 'Leukemia cluster above baseline — Lahore',
    description: '6 high-risk leukemia predictions in Lahore within 14 days (baseline: 1.2).', district: 'Lahore' },
  { severity: 'high', type: 'high_risk_case', title: 'High-risk case flagged — Peshawar',
    description: 'Single high-confidence leukemia_with_thrombocytopenia prediction forwarded for review.', district: 'Peshawar' },
  { severity: 'medium', type: 'trend_shift', title: 'Rising iron-deficiency anemia — Hyderabad',
    description: 'District rate up 22% over the trailing month.', district: 'Hyderabad' },
  { severity: 'low', type: 'data_quality', title: 'Low CBC completeness — Quetta',
    description: 'Reports missing >3 fields in 18% of recent submissions.', district: 'Quetta' },
].map((a) => ({ id: alertSeq++, status: 'open', created_at: new Date(Date.now() - Math.random() * 5 * 86400000).toISOString(), ...a }));

let auditSeq = 1;
const AUDIT_LOG = Array.from({ length: 12 }).map((_, i) => ({
  id: auditSeq++,
  ts: new Date(Date.now() - i * 3 * 3600000).toISOString(),
  actor_role: ['doctor', 'nih_official', 'lab_tech'][i % 3],
  action: ['predict', 'confirm_diagnosis', 'view_clusters', 'ack_alert', 'ocr_scan'][i % 5],
  resource_type: 'prediction',
  resource_id: 1000 + i,
}));

// ---- dummy Help Portal data -------------------------------------------------
let ngoSeq = 1;
let requestSeq = 1;
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const NGOS = [
  {
    name: 'Roshni Thalassemia Foundation', mission: 'Free blood transfusions and iron-chelation support for thalassemia major patients.',
    description: 'Roshni runs a dedicated transfusion ward and subsidizes chelation therapy for over 300 registered children across Punjab. Founded in 2011 by a group of parents.',
    website: 'https://roshni-example.org', contact_email: 'help@roshni-example.org', contact_phone: '+92 300 1234567',
    district: 'Lahore', province: 'Punjab', verified: true,
    donation_info: { bank: 'Meezan Bank — 0123-4567-8901 (Roshni Thalassemia Foundation)', jazzcash: '0300-1234567', easypaisa: '0300-1234567' },
  },
  {
    name: 'Sindh Blood Relief Trust', mission: 'Mobile blood donation drives and an emergency donor registry across Sindh.',
    description: 'A donor-matching hotline plus monthly donation camps in Karachi, Hyderabad, and Sukkur. Works directly with hospital blood banks to cover shortfalls.',
    website: 'https://sindhbloodrelief-example.org', contact_email: 'contact@sindhbloodrelief-example.org', contact_phone: '+92 321 9876543',
    district: 'Karachi', province: 'Sindh', verified: true,
    donation_info: { bank: 'HBL — 5566-7788-9900 (Sindh Blood Relief Trust)', jazzcash: '0321-9876543' },
  },
  {
    name: 'KPK Anemia & Nutrition Alliance', mission: 'Iron-deficiency screening and micronutrient supplementation for women and children.',
    description: 'Runs school and clinic screening programs and distributes iron-folate supplements in underserved districts.',
    website: '', contact_email: 'info@kpk-anemia-example.org', contact_phone: '+92 333 4455667',
    district: 'Peshawar', province: 'KPK', verified: false,
    donation_info: { easypaisa: '0333-4455667' },
  },
  {
    name: 'Hope for Leukemia Pakistan', mission: 'Covers diagnostic and chemotherapy costs for children with leukemia from low-income families.',
    description: 'Partners with three tertiary hospitals to fast-track diagnosis and subsidize treatment; also funds a small patient-family lodging facility.',
    website: 'https://hopeforleukemia-example.org', contact_email: 'donate@hopeforleukemia-example.org', contact_phone: '+92 345 1122334',
    district: 'Islamabad', province: 'Islamabad', verified: true,
    donation_info: { bank: 'UBL — 1122-3344-5566 (Hope for Leukemia Pakistan)', paypal: 'giving@hopeforleukemia-example.org' },
  },
  {
    name: 'Balochistan Rural Health Circle', mission: 'Bringing basic hematology testing and referral transport to remote districts.',
    description: 'A small volunteer-run outfit covering Quetta and surrounding rural union councils with a single mobile lab van.',
    website: '', contact_email: 'brhc@example.org', contact_phone: '+92 331 7788990',
    district: 'Quetta', province: 'Balochistan', verified: false,
    donation_info: { jazzcash: '0331-7788990' },
  },
];

const NGO_DIRECTORY = NGOS.map((n, i) => ({
  id: `ngo-${i + 1}`, created_at: ago(200 - i * 10), logo_url: null, ...n,
}));

const REQUEST_TEMPLATES = [
  { category: 'blood', blood_group: 'O-', title: 'Urgent O- units needed for transfusion ward', quantity: '15 units', urgency: 'critical', neededByIn: 3 },
  { category: 'blood', blood_group: 'B+', title: 'Weekly B+ donor shortfall', quantity: '8 units', urgency: 'high', neededByIn: 7 },
  { category: 'medicine', title: 'Deferasirox (iron chelation) — stock running low', quantity: '200 tablets', urgency: 'high', neededByIn: 10 },
  { category: 'medicine', title: 'Folic acid & iron supplements for screening camp', quantity: '1000 packs', urgency: 'medium', neededByIn: 21 },
  { category: 'equipment', title: 'Portable hemoglobinometers for field screening', quantity: '4 units', urgency: 'medium', neededByIn: 30 },
  { category: 'equipment', title: 'Centrifuge for blood component separation', quantity: '1 unit', urgency: 'low', neededByIn: 45 },
  { category: 'funds', title: 'Chemotherapy cost subsidy — Q1 shortfall', quantity: 'PKR 850,000', urgency: 'high', neededByIn: 14 },
  { category: 'funds', title: 'Mobile lab van fuel & maintenance fund', quantity: 'PKR 120,000', urgency: 'medium', neededByIn: 20 },
];

const SUPPLY_REQUESTS = NGO_DIRECTORY.flatMap((ngo, ni) => {
  const count = 1 + (ni % 3);
  return Array.from({ length: count }).map((_, i) => {
    const t = REQUEST_TEMPLATES[(ni * 2 + i) % REQUEST_TEMPLATES.length];
    return {
      id: `req-${requestSeq++}`, ngo_id: ngo.id, ngo_name: ngo.name, ngo_district: ngo.district,
      category: t.category, blood_group: t.blood_group || null, title: t.title,
      description: `Posted by ${ngo.name}. ${t.category === 'blood' ? 'Please contact the NGO directly before donating in person.' : 'Reach out via the contact details on our profile to coordinate delivery.'}`,
      quantity: t.quantity, urgency: t.urgency, status: i === 0 && ni % 4 === 0 ? 'partially_fulfilled' : 'open',
      needed_by: inDays(t.neededByIn), district: ngo.district, province: ngo.province,
      created_at: ago(20 - ni - i), updated_at: ago(2),
    };
  });
});

// The signed-in NGO's own profile, created lazily on first access (mirrors
// the real backend's get-or-create-on-first-touch behavior).
let myNgo = null;
function ensureMyNgo(fullName) {
  if (!myNgo) {
    myNgo = {
      id: 'ngo-me', created_at: new Date().toISOString(), logo_url: null,
      name: fullName || 'My NGO', mission: '', description: '', website: '',
      contact_email: session?.email || '', contact_phone: '',
      district: '', province: '', verified: false, donation_info: {},
    };
  }
  return myNgo;
}
let myRequests = [];

// ---- dummy Model Health data -------------------------------------------------
const NODES_META = [
  { name: 'Aga Khan Lab - Karachi', district: 'Karachi', province: 'Sindh', fl_client_id: 'lab-khi-01', freshnessDays: 1 },
  { name: 'Shaukat Khanum - Lahore', district: 'Lahore', province: 'Punjab', fl_client_id: 'lab-lhr-01', freshnessDays: 0 },
  { name: 'PIMS Lab - Islamabad', district: 'Islamabad', province: 'Islamabad', fl_client_id: 'lab-isb-01', freshnessDays: 12 },
  { name: 'LRH Lab - Peshawar', district: 'Peshawar', province: 'KPK', fl_client_id: 'lab-pew-01', freshnessDays: 45 },
];

function makeAccuracyHistory() {
  const points = [];
  let loss = 1.35, acc = 0.52;
  for (let r = 1; r <= 12; r++) {
    loss = Math.max(0.18, loss - (0.09 + Math.random() * 0.03));
    acc = Math.min(0.94, acc + (0.03 + Math.random() * 0.015));
    points.push({
      round_number: r, loss: +loss.toFixed(3), accuracy: +acc.toFixed(3),
      clients: NODES_META.length, created_at: ago(60 - r * 4),
    });
  }
  return { source: 'fl_rounds', points };
}

function makeNodes() {
  const now = Date.now();
  return NODES_META.map((n, i) => {
    const lastMs = now - n.freshnessDays * 86400000;
    const status = n.freshnessDays <= 7 ? 'up' : n.freshnessDays <= 30 ? 'stale' : 'down';
    return {
      id: `lab-${i + 1}`, name: n.name, district: n.district, province: n.province, fl_client_id: n.fl_client_id,
      last_report_at: new Date(lastMs).toISOString(),
      reports_7d: status === 'up' ? 20 + i * 6 : status === 'stale' ? 2 : 0,
      reports_30d: status === 'down' ? 3 : 40 + i * 10,
      reports_total: 300 + i * 120,
      status,
    };
  });
}

function makeDataIntake(days) {
  const byDay = Array.from({ length: Math.min(days, 21) }).map((_, i) => ({
    day: ago(Math.min(days, 21) - 1 - i).slice(0, 10),
    count: 8 + Math.round(Math.random() * 20) + (i % 7 === 0 ? 15 : 0),
  }));
  const bySource = [
    { source: 'lims', count: 640 }, { source: 'manual', count: 210 }, { source: 'ocr', count: 95 },
  ];
  const byCondition = [
    { condition: 'healthy', count: 410 }, { condition: 'iron_deficiency_anemia', count: 180 },
    { condition: 'thrombocytopenia', count: 95 }, { condition: 'macrocytic_anemia', count: 70 },
    { condition: 'leukemia', count: 34 }, { condition: 'beta_thal_trait', count: 58 },
    { condition: 'leukemia_with_thrombocytopenia', count: 12 },
  ];
  return { byDay, bySource, byCondition };
}

function makeNodeContribution(days) {
  const span = Math.min(days, 14);
  const rows = [];
  NODES_META.forEach((n, i) => {
    for (let d = 0; d < span; d++) {
      const base = n.freshnessDays > 30 ? 0 : n.freshnessDays > 7 ? (d < 2 ? 3 : 0) : 6 + i * 2;
      rows.push({ lab_id: `lab-${i + 1}`, name: n.name, day: ago(span - 1 - d).slice(0, 10), count: Math.max(0, base + Math.round(Math.random() * 4) - 1) });
    }
  });
  return rows;
}

// ---- request router ---------------------------------------------------------
async function route(method, path, body) {
  const [pathname, qs] = path.split('?');
  const params = new URLSearchParams(qs || '');

  // --- auth ---
  if (pathname === '/auth/login' && method === 'POST') {
    await delay();
    session = { fullName: body.email.split('@')[0], email: body.email, role: roleFromEmail(body.email) };
    const existingSecret = loadSecret();
    if (existingSecret) startDemoCodeLogging(existingSecret);
    return { preAuthToken: 'demo-preauth', mfaSetupRequired: !existingSecret };
  }
  if (pathname === '/auth/register' && method === 'POST') {
    await delay();
    session = { fullName: body.fullName, email: body.email, role: body.role || 'doctor' };
    return { preAuthToken: 'demo-preauth' };
  }
  if (pathname === '/auth/mfa/setup' && method === 'POST') {
    // React 18 StrictMode double-invokes effects in dev, so MfaPage's
    // "fetch the QR" effect can fire this twice back-to-back. Without this
    // guard that generates two different secrets in quick succession, and
    // whichever response wins the setState race may not match what actually
    // ended up saved to localStorage — the QR on screen then verifies against
    // the wrong secret. Coalesce concurrent calls onto one shared setup.
    if (!pendingMfaSetup) {
      pendingMfaSetup = (async () => {
        await delay();
        const secretBytes = crypto.getRandomValues(new Uint8Array(20));
        saveSecret(secretBytes);
        const base32Secret = base32Encode(secretBytes);
        const url = otpauthUrl(session?.email || 'doctor@fedhealth.demo', base32Secret);
        startDemoCodeLogging(secretBytes);
        return {
          qrDataUrl: qrDataUrlFor(url),
          manualKey: base32Secret.match(/.{1,4}/g).join(' '),
        };
      })();
      pendingMfaSetup.finally(() => { setTimeout(() => { pendingMfaSetup = null; }, 1000); });
    }
    return pendingMfaSetup;
  }
  if ((pathname === '/auth/mfa/verify-setup' || pathname === '/auth/mfa/verify') && method === 'POST') {
    await delay();
    const secretBytes = loadSecret();
    if (!secretBytes) { const e = new Error('No MFA enrolment found for this demo session — register again.'); e.status = 400; throw e; }
    const ok = await verifyTotp(secretBytes, body.code);
    if (!ok) { const e = new Error('Invalid code. Check your authenticator app and try again.'); e.status = 401; throw e; }
    return { accessToken: 'demo-access-token' };
  }
  if (pathname === '/dev/current-totp' && method === 'GET') {
    // Demo-only convenience, not part of the real API: current valid code for
    // whichever secret is stored, so you can test without a phone.
    const secretBytes = loadSecret();
    if (!secretBytes) { const e = new Error('No MFA enrolment yet.'); e.status = 400; throw e; }
    return { code: await currentTotp(secretBytes) };
  }
  if (pathname === '/auth/me' && method === 'GET') {
    await delay(150);
    if (!session) { const e = new Error('Not authenticated'); e.status = 401; throw e; }
    return { ...session, permissions: permsForRole(session.role) };
  }

  // --- doctor: predict / confirm / history ---
  if (pathname === '/predict' && method === 'POST') {
    await delay(700);
    const scores = randomScores();
    const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const riskFlag = top[0] !== 'healthy' && top[1] > 0.4;
    const hgb = body.cbc?.HGB, mcv = body.cbc?.MCV;
    const mentzer = hgb && mcv && body.cbc?.RBC ? +(mcv / body.cbc.RBC).toFixed(1) : null;
    const fired = mentzer != null && mentzer < 13;
    const id = predictionSeq++;
    const result = {
      inference: {
        scores, risk_flag: riskFlag, top_condition: top[0],
        model_name: 'FedHealth CBC-Net (demo)', model_version: 'v1.0.0-preview', mode: 'federated',
        inference_ms: 60 + Math.round(Math.random() * 120),
        rule_flags: mentzer != null ? {
          thalassemia_trait: {
            applicable: true, flag: fired, mentzer_index: mentzer,
            rationale: fired
              ? 'Mentzer index < 13 with microcytosis and near-normal RBC count is suggestive of beta-thalassemia trait rather than iron-deficiency anemia.'
              : 'Discriminant indices do not meet the beta-thalassemia trait screening threshold.',
            indices: {
              mentzer: { value: mentzer, thal_suggestive: fired },
              srivastava: { value: +(mcv && body.cbc?.MCH ? (body.cbc.MCH / (body.cbc?.RBC || 1)).toFixed(1) : 0), thal_suggestive: fired },
            },
          },
        } : undefined,
      },
      prediction: { id, confirmed_condition: null },
    };
    predictionsById.set(id, { ...body, scores });
    return result;
  }
  if (/^\/predictions\/\d+\/confirm$/.test(pathname) && method === 'POST') {
    await delay(300);
    return { ok: true };
  }
  if (/^\/patients\/[^/]+\/history$/.test(pathname) && method === 'GET') {
    await delay(400);
    const ref = decodeURIComponent(pathname.split('/')[2]);
    return makePatientHistory(ref);
  }
  if (pathname === '/ocr' && method === 'UPLOAD') {
    await delay(1100);
    const picks = ['WBC', 'RBC', 'HGB', 'HCT', 'MCV', 'PLT'];
    const cbc = {};
    picks.forEach((k) => {
      if (Math.random() > 0.25) {
        cbc[k] = k === 'HGB' ? (11 + Math.random() * 4).toFixed(1)
          : k === 'PLT' ? String(Math.round(150 + Math.random() * 200))
          : k === 'MCV' ? (75 + Math.random() * 25).toFixed(1)
          : (4 + Math.random() * 6).toFixed(1);
      }
    });
    return { cbc, extractedCount: Object.keys(cbc).length };
  }
  if (pathname === '/symptoms/parse' && method === 'POST') {
    await delay(500);
    const text = (body.text || '').toLowerCase();
    const dict = {
      fatigue: /fatigue|thak|تھکن/, pale_skin: /pale|پیلا/, shortness_of_breath: /breath|سانس/,
      fever: /fever|bukhar|بخار/, bone_pain: /bone pain|haddi/, bruising: /bruis|neel/,
    };
    const tags = Object.entries(dict).filter(([, re]) => re.test(text)).map(([k]) => k);
    return { language: /[؀-ۿ]/.test(text) ? 'ur' : 'en', tags, symptoms: tags };
  }

  // --- surveillance (endpoint paths kept as /nih/... to match Module 2/6) ---
  if (pathname === '/nih/clusters' && method === 'GET') {
    await delay(500);
    let rows = makeClusters();
    const province = params.get('province');
    const condition = params.get('condition');
    if (province) rows = rows.filter((r) => r.province === province);
    if (condition) rows = rows.filter((r) => r.condition === condition);
    return rows;
  }
  if (pathname === '/nih/alerts' && method === 'GET') {
    await delay(400);
    const status = params.get('status') || 'open';
    return ALERTS.filter((a) => a.status === status);
  }
  if (/^\/nih\/alerts\/\d+\/ack$/.test(pathname) && method === 'POST') {
    await delay(300);
    const id = Number(pathname.split('/')[3]);
    const a = ALERTS.find((x) => x.id === id);
    if (a) a.status = 'acknowledged';
    return { ok: true };
  }
  if (pathname === '/audit/verify' && method === 'GET') {
    await delay(600);
    return { ok: true };
  }
  if (pathname === '/audit' && method === 'GET') {
    await delay(400);
    return AUDIT_LOG;
  }

  // --- Help Portal (public browsing + NGO self-service) ---
  if (pathname === '/help/ngos' && method === 'GET') {
    await delay(450);
    return NGO_DIRECTORY.map((n) => ({
      ...n,
      open_request_count: SUPPLY_REQUESTS.filter((r) => r.ngo_id === n.id && r.status !== 'closed' && r.status !== 'fulfilled').length,
    }));
  }
  if (pathname === '/help/requests' && method === 'GET') {
    await delay(450);
    let rows = SUPPLY_REQUESTS.filter((r) => r.status === 'open' || r.status === 'partially_fulfilled');
    const category = params.get('category');
    const province = params.get('province');
    const urgency = params.get('urgency');
    if (category) rows = rows.filter((r) => r.category === category);
    if (province) rows = rows.filter((r) => r.province === province);
    if (urgency) rows = rows.filter((r) => r.urgency === urgency);
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...rows].sort((a, b) => order[a.urgency] - order[b.urgency]);
  }
  if (pathname === '/help/ngos/me' && method === 'GET') {
    await delay(300);
    return ensureMyNgo(session?.fullName);
  }
  if (pathname === '/help/ngos/me' && method === 'PUT') {
    await delay(400);
    const ngo = ensureMyNgo(session?.fullName);
    Object.assign(ngo, {
      name: body.name ?? ngo.name, mission: body.mission ?? ngo.mission,
      description: body.description ?? ngo.description, website: body.website ?? ngo.website,
      contact_email: body.contactEmail || ngo.contact_email,
      contact_phone: body.contactPhone || ngo.contact_phone,
      district: body.district ?? ngo.district, province: body.province ?? ngo.province,
      donation_info: body.donationInfo ? { ...ngo.donation_info, ...body.donationInfo } : ngo.donation_info,
    });
    return ngo;
  }
  if (pathname === '/help/ngos/me/requests' && method === 'GET') {
    await delay(300);
    return myRequests;
  }
  if (pathname === '/help/ngos/me/requests' && method === 'POST') {
    await delay(400);
    const ngo = ensureMyNgo(session?.fullName);
    const created = {
      id: `req-mine-${myRequests.length + 1}`, ngo_id: ngo.id,
      category: body.category, blood_group: body.bloodGroup || null,
      title: body.title, description: body.description || '', quantity: body.quantity || null,
      urgency: body.urgency || 'medium', status: 'open', needed_by: body.neededBy || null,
      district: body.district || ngo.district, province: body.province || ngo.province,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    myRequests = [created, ...myRequests];
    return created;
  }
  const patchReqMatch = pathname.match(/^\/help\/ngos\/me\/requests\/([^/]+)$/);
  if (patchReqMatch && method === 'PATCH') {
    await delay(350);
    const id = patchReqMatch[1];
    const idx = myRequests.findIndex((r) => r.id === id);
    if (idx === -1) { const e = new Error('Request not found'); e.status = 404; throw e; }
    myRequests[idx] = { ...myRequests[idx], ...body, updated_at: new Date().toISOString() };
    return myRequests[idx];
  }
  const ngoDetailMatch = pathname.match(/^\/help\/ngos\/([^/]+)$/);
  if (ngoDetailMatch && method === 'GET') {
    await delay(400);
    const id = ngoDetailMatch[1];
    const ngo = id === 'ngo-me' ? ensureMyNgo(session?.fullName) : NGO_DIRECTORY.find((n) => n.id === id);
    if (!ngo) { const e = new Error('NGO not found'); e.status = 404; throw e; }
    const requests = id === 'ngo-me' ? myRequests : SUPPLY_REQUESTS.filter((r) => r.ngo_id === id);
    return { ...ngo, requests };
  }

  // --- Model Health dashboard ---
  if (pathname === '/model-health/summary' && method === 'GET') {
    await delay(400);
    return {
      activeModel: {
        name: 'FedHealth CBC-Net', version: 'v1.0.0-preview',
        metrics: { macro_f1: 0.87, accuracy: 0.91 }, created_at: ago(4),
      },
      totalPredictions: 4820, avgInferenceMs: 118, totalLabReports: 5310,
      lastTrainingRun: { started_at: ago(5), completed_at: ago(4), total_rounds: 12, labs: NODES_META.length, encryption: 'paillier', key_bits: 2048 },
    };
  }
  if (pathname === '/model-health/accuracy-history' && method === 'GET') {
    await delay(500);
    return makeAccuracyHistory();
  }
  if (pathname === '/model-health/nodes' && method === 'GET') {
    await delay(400);
    return makeNodes();
  }
  if (pathname === '/model-health/data-intake' && method === 'GET') {
    await delay(450);
    return makeDataIntake(Number(params.get('days')) || 30);
  }
  if (pathname === '/model-health/node-contribution' && method === 'GET') {
    await delay(450);
    return makeNodeContribution(Number(params.get('days')) || 30);
  }
  if (pathname === '/model-health/encryption' && method === 'GET') {
    await delay(300);
    return { scheme: 'paillier', keyBits: 2048, roundsEncrypted: 12, lastRunCompletedAt: ago(4) };
  }

  const e = new Error(`(preview mock) No dummy handler for ${method} ${pathname}`);
  e.status = 404;
  throw e;
}

export const api = {
  get: (path) => route('GET', path),
  post: (path, body) => route('POST', path, body || {}),
  put: (path, body) => route('PUT', path, body || {}),
  patch: (path, body) => route('PATCH', path, body || {}),
  upload: (path) => route('UPLOAD', path),
};
