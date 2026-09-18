// backend/src/models/nihClusters.js
// ---------------------------------------------------------------------------
// The only query Module 8 (NIH Dashboard) ever needs. Reads
// nih_prediction_clusters — never predictions or lab_reports directly —
// so there is no code path here that can leak a patient_ref or raw CBC
// value to the surveillance tier.
//
// PostgreSQL returns aggregate numerics (count, avg) as strings over the
// wire. Cast them here so callers (charts, sums) get real numbers.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

async function getClusters({ province = null, condition = null } = {}) {
  const { rows } = await query(
    `SELECT * FROM nih_prediction_clusters
      WHERE ($1::text IS NULL OR province = $1)
        AND ($2::text IS NULL OR condition = $2)
      ORDER BY day DESC, case_count DESC`,
    [province, condition]
  );
  return rows.map((r) => ({
    ...r,
    case_count: Number(r.case_count),
    avg_confidence: r.avg_confidence === null ? null : Number(r.avg_confidence),
    high_risk_count: Number(r.high_risk_count),
  }));
}

module.exports = { getClusters };
