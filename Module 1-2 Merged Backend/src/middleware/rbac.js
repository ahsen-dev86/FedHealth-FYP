// backend/src/middleware/rbac.js
// ---------------------------------------------------------------------------
// Role-Based Access Control. requirePermission('code', ...) gates a route on
// the caller holding ALL listed permission codes. Permissions are resolved from
// the role_permissions table (seeded in Module 1) and cached briefly in memory,
// since they change rarely and we don't want a DB round-trip on every request.
// ---------------------------------------------------------------------------
const Roles = require('../models/roles');
const { HttpError } = require('./errors');

const TTL_MS = 60_000; // refresh a role's permission set at most once a minute
const cache = new Map(); // role_name -> { perms: Set<string>, exp: number }

/** Look up a role's permission codes, serving from the in-memory cache when fresh. */
async function permsForRole(roleId, roleName) {
  const hit = cache.get(roleName);
  if (hit && hit.exp > Date.now()) return hit.perms;

  const perms = new Set(await Roles.permissionsFor(roleId));
  cache.set(roleName, { perms, exp: Date.now() + TTL_MS });
  return perms;
}

/**
 * Route guard. Must run AFTER requireAuth (needs req.user).
 * @param {...string} required  permission codes the caller must ALL possess
 */
function requirePermission(...required) {
  return async (req, res, next) => {
    try {
      if (!req.user) throw new HttpError(401, 'Not authenticated');
      const perms = await permsForRole(req.user.role_id, req.user.role_name);
      const missing = required.filter((code) => !perms.has(code));
      if (missing.length) {
        throw new HttpError(403, `Missing permission(s): ${missing.join(', ')}`);
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Clear the cache (call after changing a role's permissions at runtime). */
function invalidateCache() {
  cache.clear();
}

module.exports = { requirePermission, invalidateCache };
