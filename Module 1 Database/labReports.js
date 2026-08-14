// backend/src/models/labReports.js
// ---------------------------------------------------------------------------
// A lab_report is one CBC record. `cbc` is a JS object -> stored as JSONB
// (node-pg JSON-serializes plain objects for jsonb columns automatically).
// `patientRef` is an OPAQUE pseudonymous token (no PII) — it lets us build
// longitudinal trends without ever storing a patient's identity centrally.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

async function create({
  labId = null, createdBy, source, patientRef,
  sex = null, ageYears = null, cbc,
  district = null, province = null, latitude = null, longitude = null,
  collectedAt = null,
}) {
  const { rows } = await query(
    `INSERT INTO lab_reports
       (lab_id, created_by, source, patient_ref, sex, age_years, cbc,
        district, province, latitude, longitude, collected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [labId, createdBy, source, patientRef, sex, ageYears, cbc,
     district, province, latitude, longitude, collectedAt]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await query('SELECT * FROM lab_reports WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * All reports for one pseudonymous patient, oldest first — powers the doctor
 * portal's longitudinal trend charts (scope 6.2.2, e.g. Hb/platelet over time).
 */
async function listByPatient(patientRef) {
  const { rows } = await query(
    `SELECT * FROM lab_reports
      WHERE patient_ref = $1
      ORDER BY collected_at NULLS LAST, created_at`,
    [patientRef]
  );
  return rows;
}

/** Recent reports submitted by a given lab node. */
async function listByLab(labId, limit = 100) {
  const { rows } = await query(
    `SELECT * FROM lab_reports
      WHERE lab_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [labId, limit]
  );
  return rows;
}

module.exports = { create, findById, listByPatient, listByLab };
