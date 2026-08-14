// backend/src/routes/admin.js
// ---------------------------------------------------------------------------
// Model registry + lab (FL node) management. Registering a model records the
// per-class metrics (macro-F1, per-class recall) from Module 3's metrics.json —
// the on-record evidence that the model is balanced across diseases.
// ---------------------------------------------------------------------------
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { auditAction } = require('../middleware/audit');
const { asyncHandler, HttpError } = require('../middleware/errors');
const MlModels = require('../models/mlModels');
const Labs = require('../models/labs');
const Inference = require('../services/inferenceClient');

const router = express.Router();

// What the inference service is currently serving (mode + version per model).
router.get('/models', requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await Inference.listModels());
  }));

// Register + activate a model version (e.g. after a Colab training run).
// Body: { name, version, diseaseScope, classes[], metrics{}, calibration }
router.post('/models/register', requireAuth, requirePermission('model:register'),
  auditAction('MODEL_REGISTER', (req) => ({ type: 'ml_model', id: req.body?.name })),
  asyncHandler(async (req, res) => {
    const { name, version, diseaseScope, classes, metrics, calibration, activate = true } = req.body;
    if (!name || !version || !Array.isArray(classes)) {
      throw new HttpError(400, 'name, version and classes[] are required');
    }
    const model = await MlModels.register({
      name, version, diseaseScope: diseaseScope || '', classes,
      metrics: metrics || {}, calibration: calibration || null });
    if (activate) await MlModels.setActive(model.id);
    res.status(201).json(model);
  }));

// Register a lab (FL node) — needed for geo + the federation client identity.
router.post('/labs', requireAuth, requirePermission('lab:manage'),
  auditAction('CREATE_LAB', () => ({ type: 'lab' })),
  asyncHandler(async (req, res) => {
    const { name, limsType, district, province, latitude, longitude, flClientId } = req.body;
    if (!name || !district || !province || latitude == null || longitude == null) {
      throw new HttpError(400, 'name, district, province, latitude, longitude are required');
    }
    const lab = await Labs.create({ name, limsType, district, province, latitude, longitude, flClientId });
    res.status(201).json(lab);
  }));

router.get('/labs', requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await Labs.list());
  }));

module.exports = router;
