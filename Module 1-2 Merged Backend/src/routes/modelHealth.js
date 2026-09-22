// backend/src/routes/modelHealth.js
// ---------------------------------------------------------------------------
// AI Model Health dashboard (new — sits alongside /nih at the same
// 'nih:dashboard' permission tier). Aggregate-only: active model version,
// accuracy/loss history, per-node status, data intake volume/nature, and the
// encryption configuration used by the last FL training run.
// ---------------------------------------------------------------------------
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errors');
const ModelHealth = require('../models/modelHealth');

const router = express.Router();
const gate = [requireAuth, requirePermission('nih:dashboard')];

router.get('/summary', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.summary());
}));

router.get('/accuracy-history', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.accuracyHistory());
}));

router.get('/nodes', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.nodes());
}));

router.get('/data-intake', ...gate, asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  res.json(await ModelHealth.dataIntake({ days }));
}));

router.get('/node-contribution', ...gate, asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  res.json(await ModelHealth.nodeContribution({ days }));
}));

router.get('/encryption', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.encryptionStatus());
}));

module.exports = router;
