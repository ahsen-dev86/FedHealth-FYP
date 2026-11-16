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
const MlModels = require('../models/mlModels');
const Inference = require('../services/inferenceClient');
const { query } = require('../db/pool');
const { contract } = require('../contract');

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

// Primary / backup model availability: which model is answering right now, the
// version and measured test accuracy of each, and how many predictions in the
// window the backup actually served. Aggregate only; no patient data.
router.get('/serving', ...gate, asyncHandler(async (req, res) => {
  const days = daysOf(req);
  const status = await Inference.health();
  const inProcess = status.primary?.failover || null;
  const registry = async (version) => {
    if (!version) return null;
    const row = await MlModels.findByNameVersion(contract.model_name, version);
    const m = row?.metrics || {};
    return row ? { registered: true, active: row.is_active, testAccuracy: m.split === 'test' ? m.accuracy ?? null : null,
                    macroF1: m.split === 'test' ? m.macro_f1 ?? null : null } : { registered: false };
  };
  const primaryVersion = inProcess?.primary?.version || null;
  const backupVersion = inProcess?.backup?.version || status.backupReplica?.version || null;
  const { rows: [usage] } = await query(
    `SELECT COUNT(*)::int AS total,
            (COUNT(*) FILTER (WHERE served_by = 'backup'))::int AS backup,
            MAX(created_at) FILTER (WHERE served_by = 'backup') AS last_backup_at
       FROM predictions WHERE created_at >= now() - ($1 || ' days')::interval`, [days]);
  res.json({
    checkedAt: new Date().toISOString(),
    serving: status.serving,                       // 'primary' | 'backup' | 'none'
    drillActive: !!inProcess?.drill_active,
    primary: {
      reachable: !!status.primary?.ok,
      available: !!status.primary?.ok && inProcess?.primary?.mode !== 'unavailable',
      version: primaryVersion, mode: inProcess?.primary?.mode || null,
      reason: inProcess?.primary?.reason || (status.primary?.ok ? null : 'inference service unreachable'),
      ...(await registry(primaryVersion)),
    },
    backup: {
      configured: !!status.backupConfigured,
      inProcess: inProcess?.backup ? { available: inProcess.backup.mode !== 'unavailable', reason: inProcess.backup.reason || null } : null,
      replica: status.backupReplica?.configured ? { available: !!status.backupReplica.ok } : null,
      version: backupVersion,
      ...(await registry(backupVersion)),
    },
    breaker: { open: !!status.breaker?.open, failoversSinceStart: status.breaker?.failovers || 0, lastPrimaryFaultAt: status.breaker?.lastFailureAt || null },
    usage: { days, predictions: usage.total, servedByBackup: usage.backup, lastServedByBackupAt: usage.last_backup_at },
  });
}));

router.get('/limitations', ...gate, asyncHandler(async (req, res) => {
  res.json(await ModelHealth.limitations());
}));

module.exports = router;
