// backend/src/auth/controller.js
// ---------------------------------------------------------------------------
// Auth controllers. The login flow enforces MANDATORY MFA (scope 6.1.1):
//
//   register  -> creates a 'pending' account, returns an 'mfa-setup' pre-auth
//                token (DB trigger enforces the NIH gov-email rule here).
//   login     -> checks password + lockout. Issues ONLY a pre-auth token:
//                  * 'mfa-setup' if the user hasn't enrolled MFA yet
//                  * 'mfa'       if MFA is enrolled
//                It never returns a full access token directly.
//   mfa/setup        -> generate + store a TOTP secret, return a QR to scan.
//   mfa/verify-setup -> confirm the first code, enable MFA, activate account,
//                       and finally issue the full access token.
//   mfa/verify       -> confirm the code at login, issue the full access token.
//
// Every step writes to the immutable audit log.
// ---------------------------------------------------------------------------
const Users = require('../models/users');
const Roles = require('../models/roles');
const password = require('./password');
const tokens = require('./tokens');
const totp = require('./totp');
const { registerSchema, loginSchema, codeSchema } = require('./validators');
const { asyncHandler, HttpError } = require('../middleware/errors');
const { logEvent } = require('../middleware/audit');
const { lockout } = require('../config');

/** Small helper to record a login failure with a reason. */
async function auditLoginFail(req, user, reason) {
  await logEvent({
    actorUserId: user?.id || null,
    actorRole: user?.role_name || null,
    action: 'LOGIN_FAILED',
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    metadata: { reason },
  });
}

// --- POST /auth/register ----------------------------------------------------
const register = asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);

  const role = await Roles.getByName(data.role);
  if (!role) throw new HttpError(400, 'Unknown role');

  const passwordHash = await password.hash(data.password);

  // If this is an NIH official with a non-gov email, the DB trigger raises a
  // check_violation, which errors.js turns into a clean 400.
  const user = await Users.create({
    email: data.email,
    fullName: data.fullName,
    roleId: role.id,
    organization: data.organization || null,
    labId: data.labId || null,
    passwordHash,
  });

  await logEvent({
    actorUserId: user.id, actorRole: data.role, action: 'REGISTER',
    resourceType: 'user', resourceId: user.id,
    ip: req.ip, userAgent: req.headers['user-agent'] || null,
    metadata: { role: data.role },
  });

  // Attach role_name so the pre-auth token carries the role.
  user.role_name = data.role;
  const preAuthToken = tokens.signPreAuth(user, 'mfa-setup');

  res.status(201).json({
    id: user.id,
    email: user.email,
    status: user.status,   // 'pending' until MFA is enrolled
    mfaSetupRequired: true,
    preAuthToken,          // use this on POST /auth/mfa/setup
  });
});

// --- POST /auth/login -------------------------------------------------------
const login = asyncHandler(async (req, res) => {
  const { email, password: pw } = loginSchema.parse(req.body);
  const user = await Users.findByEmail(email);

  // Generic rejection to avoid revealing whether an email exists.
  const rejectInvalid = () => { throw new HttpError(401, 'Invalid credentials'); };

  if (!user || !user.password_hash) {
    await auditLoginFail(req, user, 'no_such_user');
    rejectInvalid();
  }

  // Locked out?
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await auditLoginFail(req, user, 'locked');
    throw new HttpError(423, 'Account temporarily locked. Try again later.');
  }

  const ok = await password.verify(pw, user.password_hash);
  if (!ok) {
    const r = await Users.recordFailedLogin(user.id, lockout.threshold, lockout.minutes);
    await auditLoginFail(req, user, 'bad_password');
    if (r.locked_until && new Date(r.locked_until) > new Date()) {
      throw new HttpError(423, 'Too many failed attempts. Account locked.');
    }
    rejectInvalid();
  }

  // Password correct — reset the failure counter.
  await Users.resetFailedLogins(user.id);

  // Issue a pre-auth token only; the caller must clear MFA to get real access.
  const needsSetup = !user.mfa_enabled;
  const scope = needsSetup ? 'mfa-setup' : 'mfa';
  const preAuthToken = tokens.signPreAuth(user, scope);

  await logEvent({
    actorUserId: user.id, actorRole: user.role_name, action: 'LOGIN_PASSWORD_OK',
    ip: req.ip, userAgent: req.headers['user-agent'] || null,
    metadata: { next: scope },
  });

  res.json(
    needsSetup
      ? { mfaSetupRequired: true, preAuthToken }
      : { mfaRequired: true, preAuthToken }
  );
});

// --- POST /auth/mfa/setup  (pre-auth 'mfa-setup') ---------------------------
const mfaSetup = asyncHandler(async (req, res) => {
  const user = req.preAuthUser;

  const secret = totp.generateSecret(user.email);
  await Users.setMfaSecret(user.id, secret.base32); // stored but NOT yet enabled
  const qrDataUrl = await totp.qrDataUrl(secret.otpauth_url);

  res.json({
    otpauthUrl: secret.otpauth_url,
    qrDataUrl,               // <img src={qrDataUrl}/> in the frontend
    manualKey: secret.base32, // fallback if the QR can't be scanned
  });
});

// --- POST /auth/mfa/verify-setup  (pre-auth 'mfa-setup') --------------------
const mfaVerifySetup = asyncHandler(async (req, res) => {
  const { code } = codeSchema.parse(req.body);
  const user = await Users.findById(req.preAuthUser.id);

  if (!user.mfa_secret) throw new HttpError(400, 'No MFA setup in progress');
  if (!totp.verifyToken(user.mfa_secret, code)) throw new HttpError(401, 'Invalid code');

  await Users.confirmMfa(user.id);      // mfa_enabled = true
  await Users.setStatus(user.id, 'active');

  await logEvent({
    actorUserId: user.id, actorRole: user.role_name, action: 'MFA_ENROLLED',
    ip: req.ip, userAgent: req.headers['user-agent'] || null,
  });

  const accessToken = tokens.signAccess(user);
  res.json({ activated: true, accessToken });
});

// --- POST /auth/mfa/verify  (pre-auth 'mfa') --------------------------------
const mfaVerify = asyncHandler(async (req, res) => {
  const { code } = codeSchema.parse(req.body);
  const user = await Users.findById(req.preAuthUser.id);

  if (!user.mfa_enabled || !user.mfa_secret) throw new HttpError(400, 'MFA is not set up');

  if (!totp.verifyToken(user.mfa_secret, code)) {
    await logEvent({
      actorUserId: user.id, actorRole: user.role_name, action: 'MFA_FAILED',
      ip: req.ip, userAgent: req.headers['user-agent'] || null,
    });
    throw new HttpError(401, 'Invalid code');
  }

  await logEvent({
    actorUserId: user.id, actorRole: user.role_name, action: 'LOGIN_SUCCESS',
    ip: req.ip, userAgent: req.headers['user-agent'] || null,
  });

  const accessToken = tokens.signAccess(user);
  res.json({ accessToken });
});

// --- GET /auth/me  (full access token) --------------------------------------
const me = asyncHandler(async (req, res) => {
  const u = req.user;
  const permissions = await Roles.permissionsFor(u.role_id);
  res.json({
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role_name,
    organization: u.organization,
    labId: u.lab_id,
    permissions,
  });
});

module.exports = { register, login, mfaSetup, mfaVerifySetup, mfaVerify, me };
