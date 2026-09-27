// backend/src/routes/modelHealth.js
// ---------------------------------------------------------------------------
// AI Model Health dashboard (same 'nih:dashboard' tier as Surveillance).
// Aggregate-only: the registered model and its measured test metrics, the
// imported federated runs (validation per round), FL lab partitions, live
// intake from this database, training-data counts, encryption truth per run
// and the measured limitations. See models/modelHealth.js for sources.
// ---------------------------------------------------------------------------
const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errors');
const ModelHealth = require('../models/modelHealth');

const router = express.Router();
const gate = [requireAuth, requirePermission('nih:dashboard')];
const daysOf = (req) => Math.min(Math.max(Number(req.query.days) || 30, 1), 365); // clamp ?days= to 1..365, default 30

router.get('/summary', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.summary());
}));

router.get('/runs', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.runs());
}));

router.get('/accuracy-history', ...gate, asyncHandler(async (req, res) => {
  const { run } = z.object({ run: z.string().uuid().optional() }).parse(req.query);
  res.json(await ModelHealth.accuracyHistory({ runId: run || null }));
}));

router.get('/nodes', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.nodes());
}));

router.get('/data-intake', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.dataIntake({ days: daysOf(req) }));
}));

// Training rows per FL lab per run (from run settings; no time window applies).
router.get('/node-contribution', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.nodeContribution());
}));

router.get('/training-data', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.trainingData());
}));

router.get('/encryption', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.encryptionStatus());
}));

router.get('/limitations', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.limitations());
}));

module.exports = router;
