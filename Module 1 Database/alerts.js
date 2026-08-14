// backend/src/models/alerts.js
// ---------------------------------------------------------------------------
// Alerts power the NIH predictive-alerting feed (scope 6.5.2). They are created
// by the alerting logic (Module 6/8) when a cluster or high-risk case crosses a
// threshold, and acknowledged by NIH officials.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

async function create({
  type, severity, title, description = '',
  condition = null, district = null, province = null,
  latitude = null, longitude = null, payload = {},
}) {
  const { rows } = await query(
    `INSERT INTO alerts
       (type, severity, title, description, condition,
        district, province, latitude, longitude, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [type, severity, title, description, condition,
     district, province, latitude, longitude, JSON.stringify(payload)]
  );
  return rows[0];
}

/** List alerts, optionally filtered by status ('open'|'acknowledged'|'resolved'). */
async function list({ status = null, limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT * FROM alerts
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY created_at DESC
      LIMIT $2`,
    [status, limit]
  );
  return rows;
}

async function acknowledge({ alertId, userId }) {
  const { rows } = await query(
    `UPDATE alerts
        SET status = 'acknowledged',
            acknowledged_by = $2,
            acknowledged_at = now()
      WHERE id = $1
      RETURNING *`,
    [alertId, userId]
  );
  return rows[0];
}

module.exports = { create, list, acknowledge };
