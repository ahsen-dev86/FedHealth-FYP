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
  return 'doctor';
}
function permsForRole(role) {
  if (role === 'nih_official') return ['nih:dashboard'];
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

  const e = new Error(`(preview mock) No dummy handler for ${method} ${pathname}`);
  e.status = 404;
  throw e;
}

export const api = {
  get: (path) => route('GET', path),
  post: (path, body) => route('POST', path, body || {}),
  upload: (path) => route('UPLOAD', path),
};
