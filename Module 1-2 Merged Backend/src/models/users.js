// backend/src/models/users.js
// ---------------------------------------------------------------------------
// User persistence. This layer ONLY reads/writes rows — password hashing
// and TOTP secret generation live in Module 2; those functions pass the
// already-computed hash/secret in here. The gov-domain rule for NIH
// officials is enforced by a DB trigger (003), so create() doesn't need
// to re-check it — a bad NIH email raises a check_violation from Postgres.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

// Inserts a new user row; the gov-domain check for NIH officials and any
// email/role constraints are enforced by DB triggers/CHECKs, not here.
// RETURNING * gives back the generated id and defaulted columns in one call.
async function create({
  email, fullName, roleId,
  organization = null, labId = null, passwordHash = null,
}) {
  const { rows } = await query(
    `INSERT INTO users (email, full_name, role_id, organization, lab_id, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [email, fullName, roleId, organization, labId, passwordHash]
  );
  return rows[0];
}

// Used by login; JOINs roles so the caller gets role_name for RBAC checks
// without a second query.
async function findByEmail(email) {
  const { rows } = await query(
    `SELECT u.*, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.email = $1`,
    [email]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await query(
    `SELECT u.*, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function setPasswordHash(id, passwordHash) {
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
}

async function setMfaSecret(id, secret) {
  await query('UPDATE users SET mfa_secret = $2 WHERE id = $1', [id, secret]);
}

async function confirmMfa(id) {
  await query('UPDATE users SET mfa_enabled = TRUE, mfa_confirmed_at = now() WHERE id = $1', [id]);
}

async function setStatus(id, status) {
  await query('UPDATE users SET status = $2 WHERE id = $1', [id, status]);
}

// Bumps the failed-attempt counter and, once it reaches lockThreshold, sets
// locked_until lockMinutes into the future in the same statement (CASE WHEN);
// an already-locked account's lockout isn't extended by further attempts.
async function recordFailedLogin(id, lockThreshold = 5, lockMinutes = 15) {
  const { rows } = await query(
    `UPDATE users
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE
                WHEN failed_login_attempts + 1 >= $2
                THEN now() + ($3 || ' minutes')::interval
                ELSE locked_until
            END
      WHERE id = $1
      RETURNING failed_login_attempts, locked_until`,
    [id, lockThreshold, lockMinutes]
  );
  return rows[0];
}

async function resetFailedLogins(id) {
  await query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [id]);
}

/** Convenience helper — not currently called by Module 2 (it checks
 * locked_until inline) but kept for any future caller that wants it. */
function isLocked(user) {
  return Boolean(user.locked_until && new Date(user.locked_until) > new Date());
}

module.exports = {
  create, findByEmail, findById, setPasswordHash,
  setMfaSecret, confirmMfa, setStatus,
  recordFailedLogin, resetFailedLogins, isLocked,
};
