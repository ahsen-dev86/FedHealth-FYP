// backend/src/routes/nih.js
// ---------------------------------------------------------------------------
// Module 6.5 — NIH tier. Serves ONLY aggregated, anonymized data: the
// district-level prediction clusters (nih_prediction_clusters view) and the
// alerts feed. RBAC keeps the NIH role away from individual reports or
// predictions (it lacks report:read / prediction:read). Conditions are the
// four model classes; clusters group by each prediction's top score.
// auditAction runs before requirePermission so denied attempts are logged.
// ---------------------------------------------------------------------------
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { auditAction } = require('../middleware/audit');
const { asyncHandler, HttpError, uuidParam } = require('../middleware/errors');
const NihClusters = require('../models/nihClusters');
const Alerts = require('../models/alerts');
const { clusterQuery, alertQuery } = require('../validators/domain');

const router = express.Router();
router.param('id', uuidParam);

// Aggregated clusters for the geospatial heatmap (Leaflet consumes this).
router.get('/nih/clusters', requireAuth,
  auditAction('NIH_VIEW_CLUSTERS', () => ({ type: 'nih_clusters' })),
  requirePermission('nih:dashboard'),
  asyncHandler(async (req, res) => {
    const q = clusterQuery.parse(req.query);
    res.json(await NihClusters.getClusters({ province: q.province || null, condition: q.condition || null }));
  }));

// Alert feed (outbreak clusters + high-risk leukemia screening flags).
router.get('/nih/alerts', requireAuth, requirePermission('nih:alerts'),
  asyncHandler(async (req, res) => {
    const q = alertQuery.parse(req.query);
    res.json(await Alerts.list({ status: q.status || null, limit: q.limit || 100 }));
  }));

// Acknowledge an alert.
router.post('/nih/alerts/:id/ack', requireAuth,
  auditAction('NIH_ACK_ALERT', (req) => ({ type: 'alert', id: req.params.id })),
  requirePermission('nih:alerts'),
  asyncHandler(async (req, res) => {
    const updated = await Alerts.acknowledge({ alertId: req.params.id, userId: req.user.id });
    if (!updated) throw new HttpError(404, 'alert not found');
    res.json(updated);
  }));

module.exports = router;
