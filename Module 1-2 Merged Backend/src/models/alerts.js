// backend/src/models/alerts.js
const { query } = require('../db/pool');

async function createHighRiskCase({ predictionId, severity = 'high', title, description = '', district = null, province = null, condition = null }) {
  const { rows } = await query(
    `INSERT INTO alerts (type, prediction_id, severity, title, description, district, province, condition)
     VALUES ('high_risk_case', $1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [predictionId, severity, title, description, district, province, condition]
  );
  return rows[0];
}

/** De-duplicated via dedup_key (e.g. `outbreak:${district}:${condition}:${isoWeek}`). */
async function createOutbreakCluster({ severity = 'high', title, description = '', district, province = null, condition, payload = {}, dedupKey }) {
  const { rows } = await query(
    `INSERT INTO alerts (type, severity, title, description, district, province, condition, payload, dedup_key)
     VALUES ('outbreak_cluster', $1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (dedup_key) DO NOTHING
     RETURNING *`,
    [severity, title, description, district, province, condition, JSON.stringify(payload), dedupKey]
  );
  return rows[0] || null;
}

async function acknowledge(alertId, userId) {
  const { rows } = await query(
    `UPDATE alerts SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = now()
      WHERE id = $1 RETURNING *`,
    [alertId, userId]
  );
  return rows[0] || null;
}

async function listByStatus(status, limit = 100) {
  const { rows } = await query(
    'SELECT * FROM alerts WHERE status = $1 ORDER BY created_at DESC LIMIT $2',
    [status, limit]
  );
  return rows;
}

module.exports = { createHighRiskCase, createOutbreakCluster, acknowledge, listByStatus };
