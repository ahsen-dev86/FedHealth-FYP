// backend/src/models/predictions.js
// ---------------------------------------------------------------------------
// Predictions store the model's per-condition confidence map (`scores`) —
// the system's ONLY automated output. A diagnosis exists only once a
// doctor sets confirmed_condition via confirmByDoctor(). The DB trigger
// check_confirmation_role (003) rejects that write outright if
// confirmedBy doesn't resolve to a doctor/admin — catch a Postgres error
// with .code === '23514' in the route layer and return HTTP 403; don't
// re-check the role here too, or the two checks can drift apart.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

async function create({
  labReportId, modelId, scores,
  topCondition = null, topConfidence = null,
  riskFlag = false, inferenceMs = null,
}) {
  const { rows } = await query(
    `INSERT INTO predictions
       (lab_report_id, model_id, scores, top_condition, top_confidence, risk_flag, inference_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [labReportId, modelId, JSON.stringify(scores), topCondition, topConfidence, riskFlag, inferenceMs]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await query('SELECT * FROM predictions WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listByReport(labReportId) {
  const { rows } = await query(
    'SELECT * FROM predictions WHERE lab_report_id = $1 ORDER BY created_at DESC',
    [labReportId]
  );
  return rows;
}

async function confirmByDoctor({ predictionId, doctorId, confirmedCondition, notes = null }) {
  const { rows } = await query(
    `UPDATE predictions
        SET confirmed_by = $2, confirmed_condition = $3, doctor_notes = $4
      WHERE id = $1
      RETURNING *`,
    [predictionId, doctorId, confirmedCondition, notes]
  );
  return rows[0];
}

module.exports = { create, findById, listByReport, confirmByDoctor };
