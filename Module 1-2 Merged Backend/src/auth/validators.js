// backend/src/auth/validators.js
// ---------------------------------------------------------------------------
// Request-body validation with zod. Centralizing schemas keeps controllers
// clean and gives consistent 400 responses (see errors.js).
// NOTE: public /register cannot create an 'admin' — admins are created via the
// bootstrap script or by an existing admin (user-management API in Module 6).
// ---------------------------------------------------------------------------
const { z } = require('zod');

const email = z.string().email().max(254);
const password = z.string().min(8).max(128); // demo-friendly minimum; raise for prod

const registerSchema = z.object({
  email,
  password,
  fullName: z.string().min(2).max(120),
  role: z.enum(['doctor', 'lab_tech', 'nih_official', 'ngo']),
  organization: z.string().max(160).optional(),
  labId: z.string().uuid().optional(),
}).refine((d) => d.role !== 'lab_tech' || d.labId, {
  // A lab engineer's whole portal is scoped to their lab, so the account must name one.
  message: 'Choose the lab you work at', path: ['labId'],
});

const loginSchema = z.object({ email, password });

// A 6-digit TOTP code.
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'code must be 6 digits') });

module.exports = { registerSchema, loginSchema, codeSchema };
