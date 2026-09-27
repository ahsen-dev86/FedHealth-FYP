// backend/src/models/predictions.js
// ---------------------------------------------------------------------------
// Predictions store the model's per-condition confidence map (`scores`) — the
// system's ONLY automated output. There is no categorical AI diagnosis.
// A diagnosis exists only once a doctor sets `confirmed_condition` via
// confirmByDoctor(). The NIH tier reads ONLY nihClusters() (an aggregated,
// anonymized view) — never individual prediction rows.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

/**
 * Persist an inference result.
 * @param scores        object of {conditionKey: confidence(0..1)} — required
 * @param topCondition  highest-scoring key (triage/sort convenience, NOT a dx)
 * @param topConfidence its confidence
 * @param riskFlag      true if this case should feed NIH alerting
 */
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
    [labReportId, modelId, JSON.stringify(scores),
     topCondition, topConfidence, riskFlag, inferenceMs]
  );
  return rows[0];
}

/** Fetch a single prediction by its primary key. */
async function findById(id) {
  const { rows } = await query('SELECT * FROM predictions WHERE id = $1', [id]);
  return rows[0] || null;
}

/** All predictions ever run against one lab report, newest first. */
async function listByReport(labReportId) {
  const { rows } = await query(
    'SELECT * FROM predictions WHERE lab_report_id = $1 ORDER BY created_at DESC',
    [labReportId]
  );
  return rows;
}

/**
 * A doctor confirms (or overrides) the case. This is the authoritative
 * diagnosis in FedHealth — the model never asserts one on its own.
 */
async function confirmByDoctor({ predictionId, doctorId, confirmedCondition, notes = null }) {
  const { rows } = await query(
    `UPDATE predictions
        SET confirmed_by        = $2,
            confirmed_condition = $3,
            confirmed_at        = now(),
            doctor_notes        = $4
      WHERE id = $1
      RETURNING *`,
    [predictionId, doctorId, confirmedCondition, notes]
  );
  return rows[0];
}

/**
 * Aggregated, anonymized clusters for the NIH dashboard/heatmap. Reads the
 * nih_prediction_clusters VIEW, which contains NO patient refs or raw CBC.
 * Optional filters by province and/or condition.
 */
async function nihClusters({ province = null, condition = null } = {}) {
  const { rows } = await query(
    `SELECT * FROM nih_prediction_clusters
      WHERE ($1::text IS NULL OR province  = $1)
        AND ($2::text IS NULL OR condition = $2)
      ORDER BY day DESC, case_count DESC`,
    [province, condition]
  );
  return rows;
}

module.exports = { create, findById, listByReport, confirmByDoctor, nihClusters };
