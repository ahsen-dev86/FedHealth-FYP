// backend/src/models/auditLogs.js
// ---------------------------------------------------------------------------
// Append-only, hash-chained audit trail (PDPB 2023). The application can ONLY
// insert and read: prev_hash/row_hash are computed by a DB trigger, and
// UPDATE/DELETE are blocked both by triggers and by REVOKE on the app role.
// verifyChain() lets the compliance view prove the log hasn't been tampered.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

/**
 * Append one audit entry. The hash chain is maintained by the DB, so callers
 * just describe *what happened*.
 * @param action        e.g. 'LOGIN','CREATE_REPORT','VIEW_PREDICTION','NIH_VIEW'
 * @param resourceType  e.g. 'lab_report','prediction'
 * @param resourceId    id of the affected resource (as text)
 * @param metadata      any extra context (JSON)
 */
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

/** Page through the log, newest first (raw hashes omitted for readability). */
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

/**
 * Verify the tamper-evident chain in-DB.
 * @returns { ok: boolean, broken_at: string|null }  (broken_at = first bad id)
 */
async function verifyChain() {
  const { rows } = await query('SELECT * FROM verify_audit_chain()');
  return rows[0];
}

module.exports = { append, list, verifyChain };
