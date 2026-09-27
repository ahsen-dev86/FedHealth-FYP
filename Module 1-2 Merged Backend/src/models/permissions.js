// backend/src/models/permissions.js
// ---------------------------------------------------------------------------
// Admin-facing helpers for managing the RBAC matrix itself. Day-to-day
// permission checks go through roles.permissionsFor() (what Module 2's
// rbac.js actually calls) — this file is for changing the matrix, e.g.
// from a future admin UI, not for checking it on every request.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

// All permission codes that exist in the system, regardless of role.
async function listAll() {
  const { rows } = await query('SELECT * FROM permissions ORDER BY code');
  return rows;
}

// Adds a permission to a role; ON CONFLICT DO NOTHING makes it safe to call twice.
async function grantToRole(roleId, permissionId) {
  await query(
    `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [roleId, permissionId]
  );
}

// Removes a permission from a role.
async function revokeFromRole(roleId, permissionId) {
  await query('DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2', [roleId, permissionId]);
}

module.exports = { listAll, grantToRole, revokeFromRole };
