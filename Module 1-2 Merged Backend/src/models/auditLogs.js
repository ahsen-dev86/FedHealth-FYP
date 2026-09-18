// backend/src/models/auditLogs.js
// ---------------------------------------------------------------------------
// Append-only, hash-chained audit trail. The application can ONLY insert
// and read: prev_hash/row_hash are computed by a DB trigger, and
// UPDATE/DELETE are blocked both by triggers and by REVOKE on the app role.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

async function append({
  actorUserId = null, actorRole = null, action,
  resourceType = null, resourceId = null,
  ip = null, userAgent = null, metadata = {},
}) {
  const { rows } = await query(
    `INSERT INTO audit_logs
       (actor_user_id, actor_role, action, resource_type, resource_id,
        ip_address, user_agent, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, ts, action`,
    [actorUserId, actorRole, action, resourceType, resourceId,
     ip, userAgent, JSON.stringify(metadata)]
  );
  return rows[0];
}

async function list({ limit = 100, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT id, ts, actor_user_id, actor_role, action,
            resource_type, resource_id, ip_address, metadata
       FROM audit_logs
      ORDER BY id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

/** @returns { ok: boolean, broken_at: string|null } */
async function verifyChain() {
  const { rows } = await query('SELECT * FROM verify_audit_chain()');
  return rows[0];
}

module.exports = { append, list, verifyChain };
