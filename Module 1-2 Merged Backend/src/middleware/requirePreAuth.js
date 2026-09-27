// backend/src/middleware/requirePreAuth.js
// ---------------------------------------------------------------------------
// Gate for the MFA steps of login. Accepts ONLY a pre-auth token of the exact
// scope required ('mfa' for verifying an existing enrolment, 'mfa-setup' for
// first-time enrolment). Attaches the user as req.preAuthUser. This token can
// do nothing else in the system.
// ---------------------------------------------------------------------------
const { verify } = require('../auth/tokens');
const { HttpError } = require('./errors');
const { bearer } = require('./requireAuth');
const Users = require('../models/users');

/** Middleware factory: require a pre-auth token of exactly `expectedScope`, attach user as req.preAuthUser. */
function requirePreAuth(expectedScope) {
  return async (req, res, next) => {
    try {
      const token = bearer(req);
      if (!token) throw new HttpError(401, 'Missing pre-auth token');

      const payload = verify(token);
      if (payload.scope !== expectedScope) {
        throw new HttpError(401, `Token scope must be '${expectedScope}' for this step`);
      }

      const user = await Users.findById(payload.sub);
      if (!user) throw new HttpError(401, 'Unknown user');

      req.preAuthUser = user;
      next();
    } catch (e) {
      if (e instanceof HttpError) return next(e);
      next(new HttpError(401, 'Invalid or expired pre-auth token'));
    }
  };
}

module.exports = { requirePreAuth };
