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
  servedBy = 'primary', explanation = null,
}, db = null) {
  const { rows } = await run(db)(
    `INSERT INTO predictions
       (lab_report_id, model_id, scores, top_condition, top_confidence, risk_flag, inference_ms,
        rule_flags, imputed_features, served_by, explanation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [labReportId, modelId, JSON.stringify(scores), topCondition, topConfidence, riskFlag, inferenceMs,
      JSON.stringify(ruleFlags), JSON.stringify(imputedFeatures), servedBy,
      explanation ? JSON.stringify(explanation) : null]
  );
  return rows[0];
}

/**
 * Add a confirmed diagnosis to the training dataset (confirmed_cases), once.
 * The record is the report's 10 canonical CBC values + the confirmed label;
 * its SHA-256 (fedhealth_case_hash, computed in SQL) is UNIQUE, so an identical
 * record from any doctor, lab or visit is never stored twice. If this
 * prediction was confirmed before with a different label, that earlier record
 * is retired (is_active = false) so the dataset holds the current label only.
 * @returns {{added: boolean, duplicate: boolean, recordHash: string}}
 */
async function recordConfirmedCase(predictionId, db) {
  const q = run(db);
  await q(
    `UPDATE confirmed_cases c SET is_active = FALSE, updated_at = now()
       FROM predictions p
      WHERE p.id = $1 AND c.prediction_id = p.id AND c.label <> p.confirmed_condition AND c.is_active`,
    [predictionId]);
  const { rows } = await q(
    `INSERT INTO confirmed_cases (record_hash, cbc, label, prediction_id, lab_id, confirmed_by,
                                  model_top_condition, model_version)
     SELECT fedhealth_case_hash(lr.cbc, p.confirmed_condition), lr.cbc, p.confirmed_condition, p.id,
            lr.lab_id, p.confirmed_by, p.top_condition, m.version
       FROM predictions p
       JOIN lab_reports lr ON lr.id = p.lab_report_id
       JOIN ml_models m ON m.id = p.model_id
      WHERE p.id = $1 AND p.confirmed_condition IS NOT NULL
     ON CONFLICT (record_hash) DO UPDATE SET is_active = TRUE, updated_at = now()
     RETURNING record_hash, (xmax = 0) AS inserted`,
    [predictionId]);
  const row = rows[0];
  return row ? { added: row.inserted, duplicate: !row.inserted, recordHash: row.record_hash } : { added: false, duplicate: false };
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

module.exports = { create, findById, listByReport, confirmByDoctor, recordConfirmedCase };
