// backend/src/auth/password.js
// ---------------------------------------------------------------------------
// Password hashing. We use bcryptjs (pure-JS bcrypt) rather than argon2:
//   * argon2id is marginally stronger, BUT the argon2 npm package needs a
//     native build toolchain, which adds friction across Colab/Docker/local.
//   * bcryptjs has zero native dependencies and runs identically everywhere,
//     which matters for a reproducible FYP demo. bcrypt at cost 12 is still a
//     standard, defensible choice.
// (Documented as a deliberate simplification per project rules.)
// ---------------------------------------------------------------------------
const bcrypt = require('bcryptjs');
const { bcryptRounds } = require('../config');

/** Hash a plaintext password. Returns the full bcrypt string (salt embedded). */
async function hash(plaintext) {
  return bcrypt.hash(plaintext, bcryptRounds);
}

/** Constant-time-ish verify of a plaintext password against a stored hash. */
async function verify(plaintext, storedHash) {
  if (!storedHash) return false;
  return bcrypt.compare(plaintext, storedHash);
}

module.exports = { hash, verify };
