// backend/src/routes/adminUsers.js
// ---------------------------------------------------------------------------
// Admin Console API ('user:manage', administrators only):
//   GET  /admin/overview                 counts for the console header
//   GET  /admin/users?verification=...   accounts + proof metadata
//   GET  /admin/users/:id/proof          the uploaded proof document (inline)
//   POST /admin/users/:id/verification   approve / reject the proof
//   POST /admin/users/:id/status         suspend / reactivate an account
//   GET  /admin/serving                  primary / backup model serving status
//   POST /admin/failover-drill           mark the primary model down or restore it
//
// Every decision is written to the immutable audit log. An administrator
// cannot review, suspend or reject their own account.
// ---------------------------------------------------------------------------
const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { auditAction, logEvent } = require('../middleware/audit');
const { asyncHandler, HttpError, uuidParam } = require('../middleware/errors');
const Users = require('../models/users');
const Inference = require('../services/inferenceClient');
const { query } = require('../db/pool');

const router = express.Router();
router.param('id', uuidParam);
const gate = [requireAuth, requirePermission('user:manage')];

const listQuery = z.object({
  verification: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
});
const decisionBody = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500, 'Note is too long (max 500 characters)').optional(),
}).strict().refine((b) => b.decision !== 'reject' || (b.note && b.note.length >= 3),
  { message: 'Give the reason for rejecting, so the applicant knows what to fix', path: ['note'] });
const statusBody = z.object({ status: z.enum(['active', 'suspended']) }).strict();

router.get('/admin/overview', ...gate, asyncHandler(async (req, res) => {
  const { rows: [row] } = await query(
    `SELECT (SELECT COUNT(*)::int FROM users) AS users,
            (SELECT COUNT(*)::int FROM users WHERE verification_status = 'pending') AS pending_verifications,
            (SELECT COUNT(*)::int FROM users WHERE status = 'suspended') AS suspended,
            (SELECT COUNT(*)::int FROM lab_reports) AS reports,
            (SELECT COUNT(*)::int FROM predictions) AS predictions,
            (SELECT COUNT(*)::int FROM predictions WHERE served_by = 'backup') AS backup_served,
            (SELECT COUNT(*)::int FROM confirmed_cases WHERE is_active) AS confirmed_cases,
            (SELECT COUNT(*)::int FROM ngos) AS ngos,
            (SELECT COUNT(*)::int FROM alerts WHERE status = 'open') AS open_alerts`);
  const { rows: byRole } = await query(
    `SELECT r.name AS role, COUNT(u.id)::int AS users
       FROM roles r LEFT JOIN users u ON u.role_id = r.id GROUP BY r.name ORDER BY r.name`);
  res.json({ ...row, byRole });
}));

router.get('/admin/users', ...gate, asyncHandler(async (req, res) => {
  const { verification } = listQuery.parse(req.query);
  res.json(await Users.listForAdmin({ verification: !verification || verification === 'all' ? null : verification }));
}));

router.get('/admin/users/:id/proof', ...gate,
  auditAction('VIEW_PROOF_DOCUMENT', (req) => ({ type: 'user', id: req.params.id })),
  asyncHandler(async (req, res) => {
    const doc = await Users.getProof(req.params.id);
    if (!doc) throw new HttpError(404, 'No proof document on file for this account');
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Length', doc.size_bytes);
    res.setHeader('Content-Disposition', `inline; filename="${doc.filename.replace(/[^\x20-\x7e]|"/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(doc.content);
  }));

router.post('/admin/users/:id/verification', ...gate,
  auditAction('REVIEW_PROOF', (req) => ({ type: 'user', id: req.params.id })),
  asyncHandler(async (req, res) => {
    const { decision, note } = decisionBody.parse(req.body);
    if (req.params.id === req.user.id) throw new HttpError(400, 'You cannot review your own account');
    const updated = await Users.setVerification(req.params.id, {
      status: decision === 'approve' ? 'approved' : 'rejected', note: note || null, reviewerId: req.user.id,
    });
    if (!updated) throw new HttpError(404, 'Account not found');
    await logEvent({
      actorUserId: req.user.id, actorRole: req.user.role_name,
      action: decision === 'approve' ? 'ACCOUNT_APPROVED' : 'ACCOUNT_REJECTED',
      resourceType: 'user', resourceId: updated.id,
      ip: req.ip, userAgent: req.headers['user-agent'] || null,
      metadata: { note: note || null },
    });
    res.json(updated);
  }));

router.post('/admin/users/:id/status', ...gate,
  auditAction('SET_ACCOUNT_STATUS', (req) => ({ type: 'user', id: req.params.id })),
  asyncHandler(async (req, res) => {
    const { status } = statusBody.parse(req.body);
    if (req.params.id === req.user.id) throw new HttpError(400, 'You cannot suspend your own account');
    const target = await Users.findById(req.params.id);
    if (!target) throw new HttpError(404, 'Account not found');
    if (status === 'active' && !target.mfa_enabled) {
      throw new HttpError(400, 'This account has not finished MFA enrolment; it activates when the user completes it');
    }
    await Users.setStatus(target.id, status);
    res.json({ id: target.id, status });
  }));

// --- Model serving: primary / backup ------------------------------------------
router.get('/admin/serving', requireAuth, requirePermission('model:register'),
  asyncHandler(async (req, res) => {
    res.json(await Inference.health());
  }));

router.post('/admin/failover-drill', requireAuth,
  auditAction('FAILOVER_DRILL', () => ({ type: 'ml_model' })),
  requirePermission('model:register'),
  asyncHandler(async (req, res) => {
    const { primaryDown } = z.object({ primaryDown: z.boolean() }).strict().parse(req.body);
    await Inference.drill(primaryDown);
    res.json(await Inference.health());
  }));

module.exports = router;
