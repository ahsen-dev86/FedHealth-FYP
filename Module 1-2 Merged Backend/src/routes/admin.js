// backend/src/routes/admin.js
// ---------------------------------------------------------------------------
// Model registry + lab management. Registering a model records its MEASURED
// metrics (final_test/*_metrics.json via scripts/register-model.js, or this
// API); cbc_multiclass must carry the four classes in contract order.
// auditAction runs before requirePermission so denied attempts are logged.
// ---------------------------------------------------------------------------
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { auditAction } = require('../middleware/audit');
const { asyncHandler } = require('../middleware/errors');
const MlModels = require('../models/mlModels');
const Labs = require('../models/labs');
const Inference = require('../services/inferenceClient');
const { registerModelBody, labBody } = require('../validators/domain');

const router = express.Router();

// What the inference service is currently serving (mode + version per model).
router.get('/models', requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await Inference.listModels());
  }));

// Registry rows (every version, newest first).
router.get('/models/registry', requireAuth, requirePermission('model:register'),
  asyncHandler(async (req, res) => {
    res.json(await MlModels.listAll());
  }));

// Register + (by default) activate a model version.
router.post('/models/register', requireAuth,
  auditAction('MODEL_REGISTER', (req) => ({ type: 'ml_model', id: req.body?.name })),
  requirePermission('model:register'),
  asyncHandler(async (req, res) => {
    const b = registerModelBody.parse(req.body);
    let model = await MlModels.register({
      name: b.name, version: b.version, diseaseScope: b.diseaseScope || '', classes: b.classes,
      metrics: b.metrics || {}, calibration: b.calibration || null,
    });
    if (b.activate !== false) model = await MlModels.setActive(model.id);
    res.status(201).json(model);
  }));

// Register a lab (report geography; FL nodes come from the run records).
router.post('/labs', requireAuth,
  auditAction('CREATE_LAB', () => ({ type: 'lab' })),
  requirePermission('lab:manage'),
  asyncHandler(async (req, res) => {
    const lab = await Labs.create(labBody.parse(req.body));
    res.status(201).json(lab);
  }));

router.get('/labs', requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await Labs.list());
  }));

module.exports = router;
