// backend/src/middleware/audit.js
// ---------------------------------------------------------------------------
// Immutable-audit plumbing (PDPB 2023). Two ways to record activity:
//   * auditAction(action, resourceFn) — route middleware that appends ONE log
//     entry AFTER the response is sent (res 'finish'), so auditing never blocks
//     or fails the actual request.
//   * logEvent(evt) — direct helper for controllers that need to log a specific
//     business event (LOGIN_SUCCESS, MFA_ENROLLED, ...) with custom metadata.
// Both write through AuditLogs.append(), whose hash chain is maintained by the
// database — the app cannot forge or alter entries.
// ---------------------------------------------------------------------------
const AuditLogs = require('../models/auditLogs');

/**
 * @param {string}   action      e.g. 'AUDIT_VIEW', 'CREATE_REPORT'
 * @param {function} resourceFn  (req,res) => ({ type, id })  — optional
 */
function auditAction(action, resourceFn = () => ({})) {
  return (req, res, next) => {
    res.on('finish', () => {
      let resource = {};
      try { resource = resourceFn(req, res) || {}; } catch { /* ignore */ }
      const { type = null, id = null } = resource;

      AuditLogs.append({
        actorUserId: req.user?.id || req.preAuthUser?.id || null,
        actorRole: req.user?.role_name || req.preAuthUser?.role_name || null,
        action,
        resourceType: type,
        resourceId: id != null ? String(id) : null,
        ip: req.ip,
        userAgent: req.headers['user-agent'] || null,
        metadata: { status: res.statusCode, method: req.method, path: req.originalUrl },
      }).catch((e) => console.error('[audit] append failed:', e.message));
    });
    next();
  };
}

/** Append a specific event immediately (used inside controllers). */
async function logEvent(evt) {
  try {
    await AuditLogs.append(evt);
  } catch (e) {
    console.error('[audit] append failed:', e.message);
  }
}

module.exports = { auditAction, logEvent };
