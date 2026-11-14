// backend/src/middleware/requireAuth.js
// ---------------------------------------------------------------------------
// Gate for protected routes. Verifies a full 'access' JWT, loads the CURRENT
// user row (so a suspended/deleted account is rejected even with a valid token),
// and attaches it as req.user for downstream RBAC + audit.
// ---------------------------------------------------------------------------
const { verify } = require('../auth/tokens');
const { HttpError } = require('./errors');
const Users = require('../models/users');
const { requireProofApproval } = require('../config');

/** Extract a Bearer token from the Authorization header, or null. */
function bearer(req) {
  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');
  return type === 'Bearer' && token ? token : null;
}

/** Express middleware: validate the access token and attach the live user row as req.user. */
async function requireAuth(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'Missing bearer token');

    const payload = verify(token);
    if (payload.scope !== 'access') {
      // A pre-auth (MFA-step) token must not unlock full routes.
      throw new HttpError(401, 'Token is not a full access token');
    }

    const user = await Users.findById(payload.sub);
    if (!user) throw new HttpError(401, 'Unknown user');
    if (user.status !== 'active') throw new HttpError(403, 'Account is not active');
    // A session issued before an administrator rejected (or reset) the proof stops working at once.
    if (requireProofApproval && user.verification_status !== 'approved') {
      throw new HttpError(403, 'Account is awaiting verification', 'PENDING_VERIFICATION');
    }

    req.user = user; // includes role_id + role_name
    next();
  } catch (e) {
    if (e instanceof HttpError) return next(e);
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

module.exports = { requireAuth, bearer };
