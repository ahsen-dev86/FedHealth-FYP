// backend/src/models/roles.js
// ---------------------------------------------------------------------------
// Read-only helpers for the RBAC tables. The auth middleware (Module 2) calls
// permissionsFor() to decide whether a request may proceed.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

/** Look up a role row by its unique name (e.g. 'doctor'). */
async function getByName(name) {
  const { rows } = await query('SELECT * FROM roles WHERE name = $1', [name]);
  return rows[0] || null;
}

/** Return the flat list of permission codes granted to a role id. */
async function permissionsFor(roleId) {
  const { rows } = await query(
    `SELECT p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1`,
    [roleId]
  );
  return rows.map((r) => r.code);
}

module.exports = { getByName, permissionsFor };
