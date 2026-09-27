// backend/src/models/alerts.js
// ---------------------------------------------------------------------------
// NIH alert feed. high_risk_case alerts must reference their prediction and
// outbreak_cluster alerts need a district + condition (chk_alert_shape);
// condition is one of the four classes (chk_alerts_condition). Payloads are
// aggregate context only — never a patient_ref or raw CBC.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

// Use the transaction client if one was passed in (so an alert can be written
// atomically alongside the prediction that triggered it), otherwise the shared pool.
const run = (db) => (db ? db.query.bind(db) : query);

// Raises an alert for a single high-risk prediction result. Type is fixed to
// 'high_risk_case' so it's always paired with a prediction_id (chk_alert_shape).
async function createHighRiskCase({
  predictionId, severity = 'high', title, description = '', condition = null,
  district = null, province = null, latitude = null, longitude = null, payload = {},
}, db = null) {
  const { rows } = await run(db)(
    `INSERT INTO alerts (type, prediction_id, severity, title, description, condition,
                         district, province, latitude, longitude, payload)
     VALUES ('high_risk_case', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`, // RETURNING * hands back the full inserted row without a second SELECT
    [predictionId, severity, title, description, condition, district, province, latitude, longitude,
      JSON.stringify(payload)]
  );
  return rows[0];
}

/** De-duplicated via dedup_key (e.g. `outbreak:${district}:${condition}:${isoWeek}`). */
async function createOutbreakCluster({
  severity = 'high', title, description = '', district, province = null, condition,
  latitude = null, longitude = null, payload = {}, dedupKey,
}, db = null) {
  const { rows } = await run(db)(
    `INSERT INTO alerts (type, severity, title, description, district, province, condition,
                         latitude, longitude, payload, dedup_key)
     VALUES ('outbreak_cluster', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (dedup_key) DO NOTHING
     RETURNING *`,
    [severity, title, description, district, province, condition, latitude, longitude,
      JSON.stringify(payload), dedupKey]
  );
  return rows[0] || null;
}

/** Accepts acknowledge(alertId, userId) or acknowledge({ alertId, userId }). */
async function acknowledge(alertId, userId) {
  if (alertId && typeof alertId === 'object') ({ alertId, userId } = alertId);
  const { rows } = await query(
    `UPDATE alerts SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = now()
      WHERE id = $1 RETURNING *`,
    [alertId, userId]
  );
  return rows[0] || null;
}

/** Feed for the NIH tier; status NULL = all. */
async function list({ status = null, limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT id, type, severity, title, description, condition, district, province,
            latitude, longitude, payload, status, created_at, acknowledged_at
       FROM alerts
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY created_at DESC
      LIMIT $2`,
    [status, limit]
  );
  return rows;
}

// Convenience wrapper around list() for callers that filter by a single status.
async function listByStatus(status, limit = 100) {
  return list({ status, limit });
}

module.exports = { createHighRiskCase, createOutbreakCluster, acknowledge, list, listByStatus };
