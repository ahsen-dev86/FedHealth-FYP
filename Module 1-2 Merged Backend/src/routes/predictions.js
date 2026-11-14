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
const { asyncHandler, HttpError, uuidParam } = require('../middleware/errors');
const Predictions = require('../models/predictions');
const { confirmBody } = require('../validators/domain');
const { query, withTransaction } = require('../db/pool');
const { CLASSES, FEATURES } = require('../contract');

const router = express.Router();
router.param('id', uuidParam);

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
    // The confirmation and its dataset record commit together: a confirmed
    // diagnosis is always in confirmed_cases, and an identical record
    // (same 10 CBC values + same label) is stored once.
    const result = await withTransaction(async (db) => {
      const updated = await Predictions.confirmByDoctor({
        predictionId: req.params.id,
        doctorId: req.user.id,
        confirmedCondition,
        notes: notes || null,
      }, db);
      if (!updated) return null;
      const dataset = await Predictions.recordConfirmedCase(updated.id, db);
      return { ...updated, dataset };
    });
    if (!result) throw new HttpError(404, 'prediction not found');
    res.json(result);
  }));

// --- Confirmed-case dataset (administrator) ----------------------------------
// Counts for the Model Health page, and the records themselves as CSV in the
// training column order (label + the 10 features) for the next training round.
router.get('/dataset/confirmed/summary', requireAuth, requirePermission('dataset:export'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT label, COUNT(*)::int AS records,
              COUNT(*) FILTER (WHERE model_top_condition = label)::int AS model_agreed
         FROM confirmed_cases WHERE is_active GROUP BY label`);
    const { rows: [totals] } = await query(
      `SELECT (SELECT COUNT(*)::int FROM confirmed_cases WHERE is_active) AS records,
              (SELECT COUNT(*)::int FROM predictions WHERE confirmed_condition IS NOT NULL) AS confirmations,
              (SELECT MAX(created_at) FROM confirmed_cases) AS last_added`);
    res.json({
      records: totals.records,
      confirmations: totals.confirmations,
      duplicatesSkipped: Math.max(0, totals.confirmations - totals.records),
      lastAdded: totals.last_added,
      byLabel: Object.fromEntries(CLASSES.map((c) => {
        const row = rows.find((r) => r.label === c);
        return [c, { records: row?.records || 0, modelAgreed: row?.model_agreed || 0 }];
      })),
    });
  }));

router.get('/dataset/confirmed.csv', requireAuth,
  auditAction('DATASET_EXPORT', () => ({ type: 'confirmed_cases' })),
  requirePermission('dataset:export'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT record_hash, label, cbc, model_top_condition, model_version, created_at
         FROM confirmed_cases WHERE is_active ORDER BY created_at`);
    const header = ['record_hash', 'label', ...FEATURES, 'model_top_condition', 'model_version', 'confirmed_at'];
    const lines = rows.map((r) => [
      r.record_hash, r.label, ...FEATURES.map((f) => r.cbc[f] ?? ''),
      r.model_top_condition || '', r.model_version || '', new Date(r.created_at).toISOString(),
    ].join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fedhealth_confirmed_cases.csv"');
    res.send([header.join(','), ...lines].join('\n') + '\n');
  }));

module.exports = router;
