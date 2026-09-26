// backend/src/config/index.js
// ---------------------------------------------------------------------------
// Single source of truth for runtime config, read from environment variables.
// Everything auth-related (token lifetimes, hashing cost, lockout policy) is
// tunable here so you can explain/adjust security parameters in one place.
// ---------------------------------------------------------------------------
require('dotenv').config();

const fs = require('fs');

const isProd = process.env.NODE_ENV === 'production';

// Windows installers put tesseract outside PATH; fall back to PATH lookup elsewhere.
function defaultTesseract() {
  const windows = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
  return process.platform === 'win32' && fs.existsSync(windows) ? windows : 'tesseract';
}

// Fail fast in production if the JWT secret was left at its insecure default.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
if (isProd && JWT_SECRET === 'dev-insecure-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a strong value in production');
}

module.exports = {
  isProd,
  port: parseInt(process.env.PORT || '4000', 10),
  // Express 'trust proxy': 'loopback' (Vite dev proxy), a hop count, or a CIDR list.
  trustProxy: /^\d+$/.test(process.env.TRUST_PROXY || '')
    ? parseInt(process.env.TRUST_PROXY, 10)
    : (process.env.TRUST_PROXY || 'loopback'),

  jwt: {
    secret: JWT_SECRET,
    issuer: process.env.JWT_ISSUER || 'fedhealth',
    accessTtl: process.env.JWT_ACCESS_TTL || '2h',   // full session token
    preAuthTtl: process.env.JWT_PREAUTH_TTL || '5m', // short-lived MFA-step token
  },

  // bcrypt cost factor. 12 is a good 2020s default (~250ms/hash).
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  totp: {
    issuer: process.env.TOTP_ISSUER || 'FedHealth',
    // Accept codes +/- 1 time-step (30s) to tolerate clock drift.
    window: parseInt(process.env.TOTP_WINDOW || '1', 10),
  },

  // Brute-force protection: lock the account after N bad passwords for M minutes.
  lockout: {
    threshold: parseInt(process.env.LOGIN_LOCK_THRESHOLD || '5', 10),
    minutes: parseInt(process.env.LOGIN_LOCK_MINUTES || '15', 10),
  },

  // Module 6 Flask inference service (Module 6 Domain API/app.py).
  inference: {
    url: (process.env.INFERENCE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, ''),
    timeoutMs: parseInt(process.env.INFERENCE_TIMEOUT_MS || '20000', 10),
    apiKey: process.env.INFERENCE_API_KEY || '',
  },

  // Image OCR: the tesseract binary (UB-Mannheim build on Windows) and its language.
  ocr: {
    tesseractPath: process.env.TESSERACT_PATH || defaultTesseract(),
    lang: process.env.OCR_LANG || 'eng',
    timeoutMs: parseInt(process.env.OCR_TIMEOUT_MS || '60000', 10),
  },

  // NIH outbreak-cluster alerting: N cases of one condition in one district
  // within the window raise one (de-duplicated per ISO week) cluster alert.
  alerting: {
    clusterWindowDays: parseInt(process.env.ALERT_CLUSTER_WINDOW_DAYS || '7', 10),
    clusterMinCases: parseInt(process.env.ALERT_CLUSTER_MIN_CASES || '3', 10),
  },
};
