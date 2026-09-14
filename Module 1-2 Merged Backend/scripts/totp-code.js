// backend/scripts/totp-code.js
// ---------------------------------------------------------------------------
// Print the current 6-digit TOTP code for a base32 secret. Handy for testing
// the login flow from curl (where you can't scan a QR). Use the `manualKey`
// returned by POST /auth/mfa/setup.
//
//   node scripts/totp-code.js <base32-secret>
// ---------------------------------------------------------------------------
const speakeasy = require('speakeasy');

const secret = process.argv[2];
if (!secret) {
  console.error('Usage: node scripts/totp-code.js <base32-secret>');
  process.exit(1);
}

console.log(speakeasy.totp({ secret, encoding: 'base32' }));
