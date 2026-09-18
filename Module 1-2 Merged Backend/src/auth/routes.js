// backend/src/auth/routes.js
// ---------------------------------------------------------------------------
// /auth router. Rate-limits credential endpoints, and gates each MFA step on
// the correct pre-auth token scope.
// ---------------------------------------------------------------------------
const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('./controller');
const { requirePreAuth } = require('../middleware/requirePreAuth');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// Throttle brute-force / spray attempts on credential + code endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please slow down.' },
});

router.post('/register', authLimiter, ctrl.register);
router.post('/login', authLimiter, ctrl.login);

// MFA enrolment (first login): requires an 'mfa-setup' pre-auth token.
router.post('/mfa/setup',        requirePreAuth('mfa-setup'), ctrl.mfaSetup);
router.post('/mfa/verify-setup', requirePreAuth('mfa-setup'), ctrl.mfaVerifySetup);

// MFA at login: requires an 'mfa' pre-auth token.
router.post('/mfa/verify', authLimiter, requirePreAuth('mfa'), ctrl.mfaVerify);

// Current user profile + permissions (full access token).
router.get('/me', requireAuth, ctrl.me);

module.exports = router;
