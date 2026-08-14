// backend/src/models/users.js
// ---------------------------------------------------------------------------
// User persistence. This layer ONLY reads/writes rows — password hashing and
// TOTP secret generation live in Module 2 (auth); those functions pass the
// already-computed hash/secret in here. The gov-domain rule for NIH officials
// is enforced by a DB trigger (schema.sql 9b), so create() below does not need
// to re-check it — a bad NIH email will raise a check_violation from Postgres.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

/** Insert a new user. `roleId` comes from roles.getByName(...).id */
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

/** Fetch a user by email, joined with their role name (for auth). */
async function findByEmail(email) {
  const { rows } = await query(
    `SELECT u.*, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.email = $1`,
    [email]
  );
  return rows[0] || null;
}

/** Fetch a user by id, joined with their role name. */
async function findById(id) {
  const { rows } = await query(
    `SELECT u.*, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

/** Store a password hash (called after Argon2/bcrypt hashing in Module 2). */
async function setPasswordHash(id, passwordHash) {
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
}

/** Save a freshly generated TOTP secret. MFA is not yet "on" — see confirmMfa. */
async function setMfaSecret(id, secret) {
  await query('UPDATE users SET mfa_secret = $2 WHERE id = $1', [id, secret]);
}

/** Flip MFA on after the user has proven they can generate a valid TOTP code. */
async function confirmMfa(id) {
  await query(
    `UPDATE users SET mfa_enabled = TRUE, mfa_confirmed_at = now() WHERE id = $1`,
    [id]
  );
}

/** Move an account between 'pending' | 'active' | 'suspended'. */
async function setStatus(id, status) {
  await query('UPDATE users SET status = $2 WHERE id = $1', [id, status]);
}

/**
 * Register a failed login. Once attempts reach `lockThreshold`, the account is
 * locked for `lockMinutes`. Returns the new counter + lock timestamp.
 */
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

/** Clear the failure counter + lock after a successful login. */
async function resetFailedLogins(id) {
  await query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
    [id]
  );
}

module.exports = {
  create, findByEmail, findById, setPasswordHash,
  setMfaSecret, confirmMfa, setStatus,
  recordFailedLogin, resetFailedLogins,
};
