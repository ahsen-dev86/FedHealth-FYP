// backend/src/routes/predictions.js
// ---------------------------------------------------------------------------
// Read a prediction (four-class confidence scores) and let a DOCTOR confirm
// the diagnosis. Confirmation is the only authoritative diagnosis in FedHealth;
// the model never asserts one. The condition must be one of the four classes
// (zod here, chk_predictions_confirmed_condition in the DB), and the DB trigger
// rejects any confirmer who is not a doctor/admin. Denied (403) attempts are
// audited too: auditAction runs before requirePermission.
// ---------------------------------------------------------------------------
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { auditAction } = require('../middleware/audit');
const { asyncHandler, HttpError } = require('../middleware/errors');
const Predictions = require('../models/predictions');
const { confirmBody } = require('../validators/domain');

const router = express.Router();

router.get('/predictions/:id', requireAuth, requirePermission('prediction:read'),
  asyncHandler(async (req, res) => {
    const p = await Predictions.findById(req.params.id);
    if (!p) throw new HttpError(404, 'prediction not found');
    res.json(p);
  }));

// Doctor confirms (or overrides) the diagnosis.
router.post('/predictions/:id/confirm', requireAuth,
  auditAction('CONFIRM_DIAGNOSIS', (req) => ({ type: 'prediction', id: req.params.id })),
  requirePermission('prediction:confirm'),
  asyncHandler(async (req, res) => {
    const { confirmedCondition, notes } = confirmBody.parse(req.body);
    const updated = await Predictions.confirmByDoctor({
      predictionId: req.params.id,
      doctorId: req.user.id,
      confirmedCondition,
      notes: notes || null,
    });
    if (!updated) throw new HttpError(404, 'prediction not found');
    res.json(updated);
  }));

module.exports = router;
