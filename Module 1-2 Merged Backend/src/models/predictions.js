// backend/src/models/predictions.js
// ---------------------------------------------------------------------------
// Predictions store the model's four-class confidence map (`scores`) — the
// system's ONLY automated output. A diagnosis exists only once a doctor sets
// confirmed_condition via confirmByDoctor(). The DB trigger
// check_confirmation_role (003) rejects that write if confirmedBy is not a
// doctor/admin, and the 009 CHECKs reject any class outside
// healthy/anemia/thalassemia/leukemia. Functions take an optional `db`
// (transaction client) and default to the shared pool.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

// Use the caller's transaction client if given, otherwise the shared pool.
const run = (db) => (db ? db.query.bind(db) : query);

// Stores one model inference result against its source lab report. scores/
// ruleFlags/imputedFeatures are jsonb columns, serialized with JSON.stringify.
async function create({
  labReportId, modelId, scores,
  topCondition = null, topConfidence = null,
  riskFlag = false, inferenceMs = null,
  ruleFlags = {}, imputedFeatures = [],
}, db = null) {
  const { rows } = await run(db)(
    `INSERT INTO predictions
       (lab_report_id, model_id, scores, top_condition, top_confidence, risk_flag, inference_ms,
        rule_flags, imputed_features)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [labReportId, modelId, JSON.stringify(scores), topCondition, topConfidence, riskFlag, inferenceMs,
      JSON.stringify(ruleFlags), JSON.stringify(imputedFeatures)]
  );
  return rows[0];
}

// JOIN ml_models so the caller gets the model's name/version alongside the
// prediction without a second lookup (useful for display/audit purposes).
async function findById(id, db = null) {
  const { rows } = await run(db)(
    `SELECT p.*, m.name AS model_name, m.version AS model_version
       FROM predictions p JOIN ml_models m ON m.id = p.model_id
      WHERE p.id = $1`, [id]);
  return rows[0] || null;
}

async function listByReport(labReportId, db = null) {
  const { rows } = await run(db)(
    'SELECT * FROM predictions WHERE lab_report_id = $1 ORDER BY created_at DESC',
    [labReportId]
  );
  return rows;
}

// Records a doctor's confirmed diagnosis over the model's suggestion. The DB
// trigger check_confirmation_role rejects this if doctorId isn't a doctor/admin.
async function confirmByDoctor({ predictionId, doctorId, confirmedCondition, notes = null }, db = null) {
  const { rows } = await run(db)(
    `UPDATE predictions
        SET confirmed_by = $2, confirmed_condition = $3, doctor_notes = $4
      WHERE id = $1
      RETURNING *`,
    [predictionId, doctorId, confirmedCondition, notes]
  );
  return rows[0];
}

module.exports = { create, findById, listByReport, confirmByDoctor };
