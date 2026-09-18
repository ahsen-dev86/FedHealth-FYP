// backend/src/models/roles.js
// ---------------------------------------------------------------------------
// Read-only helpers for the RBAC tables. Module 2's rbac.js calls
// permissionsFor() and caches the result for 60s.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

async function getByName(name) {
  const { rows } = await query('SELECT * FROM roles WHERE name = $1', [name]);
  return rows[0] || null;
}

async function getById(id) {
  const { rows } = await query('SELECT * FROM roles WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listAll() {
  const { rows } = await query('SELECT * FROM roles ORDER BY name');
  return rows;
}

/** Flat list of permission codes granted to a role id. */
async function permissionsFor(roleId) {
  const { rows } = await query(
    `SELECT p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1
      ORDER BY p.code`,
    [roleId]
  );
  return rows.map((r) => r.code);
}

module.exports = { getByName, getById, listAll, permissionsFor };
