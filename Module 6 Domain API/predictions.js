// backend/src/routes/predictions.js
// ---------------------------------------------------------------------------
// Read a prediction (confidence scores + rule flags) and let a DOCTOR confirm
// the diagnosis. Confirmation is the only authoritative diagnosis in FedHealth;
// the model never asserts one.
// ---------------------------------------------------------------------------
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { auditAction } = require('../middleware/audit');
const { asyncHandler, HttpError } = require('../middleware/errors');
const Predictions = require('../models/predictions');

const router = express.Router();

router.get('/predictions/:id', requireAuth, requirePermission('prediction:read'),
  asyncHandler(async (req, res) => {
    const p = await Predictions.findById(req.params.id);
    if (!p) throw new HttpError(404, 'prediction not found');
    res.json(p);
  }));

// Doctor confirms (or overrides) the diagnosis.
router.post('/predictions/:id/confirm', requireAuth, requirePermission('prediction:confirm'),
  auditAction('CONFIRM_DIAGNOSIS', (req) => ({ type: 'prediction', id: req.params.id })),
  asyncHandler(async (req, res) => {
    const { confirmedCondition, notes } = req.body;
    if (!confirmedCondition) throw new HttpError(400, 'confirmedCondition is required');
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
