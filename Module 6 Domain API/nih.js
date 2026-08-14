// backend/src/routes/nih.js
// ---------------------------------------------------------------------------
// Module 6.5 — NIH tier. Serves ONLY aggregated, anonymized data: the
// district-level prediction clusters (from the nih_prediction_clusters view)
// and the alerts feed. RBAC ensures the NIH role can't reach individual reports
// or predictions (it lacks report:read / prediction:read).
// ---------------------------------------------------------------------------
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { auditAction } = require('../middleware/audit');
const { asyncHandler, HttpError } = require('../middleware/errors');
const Predictions = require('../models/predictions');
const Alerts = require('../models/alerts');

const router = express.Router();

// Aggregated clusters for the geospatial heatmap (Leaflet consumes this).
router.get('/nih/clusters', requireAuth, requirePermission('nih:dashboard'),
  auditAction('NIH_VIEW_CLUSTERS', () => ({ type: 'nih_clusters' })),
  asyncHandler(async (req, res) => {
    const rows = await Predictions.nihClusters({
      province: req.query.province || null,
      condition: req.query.condition || null,
    });
    res.json(rows);
  }));

// Alert feed (outbreak clusters + high-risk cases).
router.get('/nih/alerts', requireAuth, requirePermission('nih:alerts'),
  asyncHandler(async (req, res) => {
    const rows = await Alerts.list({
      status: req.query.status || null,
      limit: Math.min(Number(req.query.limit) || 100, 500),
    });
    res.json(rows);
  }));

// Acknowledge an alert.
router.post('/nih/alerts/:id/ack', requireAuth, requirePermission('nih:alerts'),
  auditAction('NIH_ACK_ALERT', (req) => ({ type: 'alert', id: req.params.id })),
  asyncHandler(async (req, res) => {
    const updated = await Alerts.acknowledge({ alertId: req.params.id, userId: req.user.id });
    if (!updated) throw new HttpError(404, 'alert not found');
    res.json(updated);
  }));

module.exports = router;
