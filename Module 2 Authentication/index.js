// backend/src/config/index.js
// ---------------------------------------------------------------------------
// Single source of truth for runtime config, read from environment variables.
// Everything auth-related (token lifetimes, hashing cost, lockout policy) is
// tunable here so you can explain/adjust security parameters in one place.
// ---------------------------------------------------------------------------
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

// Fail fast in production if the JWT secret was left at its insecure default.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
if (isProd && JWT_SECRET === 'dev-insecure-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a strong value in production');
}

module.exports = {
  isProd,
  port: parseInt(process.env.PORT || '4000', 10),

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
};
