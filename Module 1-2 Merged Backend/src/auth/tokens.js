// backend/src/auth/tokens.js
// ---------------------------------------------------------------------------
// JWT helpers. We use TWO token "scopes" to make MFA mandatory:
//   * 'access'    — full session token. Required by every protected route.
//   * 'mfa'       — short-lived pre-auth token issued after a correct password
//                   when MFA is already enabled. Only the /mfa/verify step
//                   accepts it; it grants NO other access.
//   * 'mfa-setup' — short-lived pre-auth token for first-time MFA enrolment.
// A user therefore cannot obtain an 'access' token without completing MFA.
// ---------------------------------------------------------------------------
const jwt = require('jsonwebtoken');
const { jwt: cfg } = require('../config');

/** Full session token. `user` must include id and role_name. */
function signAccess(user) {
  return jwt.sign(
    { role: user.role_name, scope: 'access' },
    cfg.secret,
    { subject: user.id, issuer: cfg.issuer, expiresIn: cfg.accessTtl }
  );
}

/** Short-lived pre-auth token for an MFA step. scope = 'mfa' | 'mfa-setup'. */
function signPreAuth(user, scope) {
  return jwt.sign(
    { role: user.role_name, scope },
    cfg.secret,
    { subject: user.id, issuer: cfg.issuer, expiresIn: cfg.preAuthTtl }
  );
}

/** Verify + decode any FedHealth token. Throws if invalid/expired. */
function verify(token) {
  return jwt.verify(token, cfg.secret, { issuer: cfg.issuer });
}

module.exports = { signAccess, signPreAuth, verify };
