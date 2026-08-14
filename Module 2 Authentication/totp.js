// backend/src/auth/totp.js
// ---------------------------------------------------------------------------
// Time-based One-Time Password (TOTP, RFC 6238) via speakeasy — the same
// mechanism Google Authenticator / Authy use. Appropriate MFA for an FYP demo
// (no enterprise SSO needed). We generate a per-user secret, hand the user an
// otpauth:// URL as a scannable QR, and verify 6-digit codes on each login.
// ---------------------------------------------------------------------------
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { totp } = require('../config');

/**
 * Generate a new TOTP secret for a user.
 * Returns { base32, otpauth_url, ... }. Store base32; show otpauth_url as a QR.
 */
function generateSecret(email) {
  return speakeasy.generateSecret({
    name: `${totp.issuer} (${email})`, // label shown in the authenticator app
    issuer: totp.issuer,
  });
}

/** Render an otpauth:// URL to a data-URL PNG the frontend can <img src=...>. */
async function qrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

/**
 * Verify a 6-digit code against the user's base32 secret.
 * `window` (config) tolerates minor clock drift between server and phone.
 */
function verifyToken(secretBase32, token) {
  if (!secretBase32) return false;
  return speakeasy.totp.verify({
    secret: secretBase32,
    encoding: 'base32',
    token,
    window: totp.window,
  });
}

module.exports = { generateSecret, qrDataUrl, verifyToken };
