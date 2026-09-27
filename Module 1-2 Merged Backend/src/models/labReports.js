// backend/src/models/labReports.js
// ---------------------------------------------------------------------------
// A lab_report is one CBC record. `cbc` holds CANONICAL values (the model's
// input, checked by chk_lab_reports_cbc_contract); `cbcReported` and
// `cbcUnits` keep the values and unit strings as entered or printed, before
// conversion. `patientRef` is an OPAQUE pseudonymous token (pseudonymize.js).
// district/province/latitude/longitude may be omitted; the DB trigger (003)
// backfills them from the parent lab. sex, age and symptoms are clinical
// context and are NOT model inputs. Optional `db` = transaction client.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

// Use the caller's transaction client if given, otherwise the shared pool.
const run = (db) => (db ? db.query.bind(db) : query);

// Inserts one CBC report. cbc/cbcUnits/cbcReported/symptoms are jsonb columns,
// so objects are serialized with JSON.stringify before being sent to pg.
async function create({
  labId = null, createdBy, source, patientRef,
  sex = null, ageYears = null, cbc, cbcUnits = {}, cbcReported = {}, symptoms = {},
  district = null, province = null, latitude = null, longitude = null,
  collectedAt = null,
}, db = null) {
  const { rows } = await run(db)(
    `INSERT INTO lab_reports
       (lab_id, created_by, source, patient_ref, sex, age_years, cbc, cbc_units, cbc_reported, symptoms,
        district, province, latitude, longitude, collected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [labId, createdBy, source, patientRef, sex, ageYears, JSON.stringify(cbc),
      JSON.stringify(cbcUnits), JSON.stringify(cbcReported), JSON.stringify(symptoms),
      district, province, latitude, longitude, collectedAt]
  );
  return rows[0];
}

async function findById(id, db = null) {
  const { rows } = await run(db)('SELECT * FROM lab_reports WHERE id = $1', [id]);
  return rows[0] || null;
}

/** All reports for one pseudonymous patient, oldest first — longitudinal trends. */
async function listByPatient(patientRef, db = null) {
  const { rows } = await run(db)(
    `SELECT * FROM lab_reports
      WHERE patient_ref = $1
      ORDER BY COALESCE(collected_at, created_at), created_at`,
    [patientRef]
  );
  return rows;
}

/**
 * Same, with each report's latest prediction (scores, top/confirmed condition,
 * model version) attached as `prediction` (null when none was run).
 */
async function listByPatientWithPredictions(patientRef, db = null) {
  const { rows } = await run(db)(
    // Correlated subquery + to_jsonb: pulls just the latest prediction (joined
    // to ml_models for its name/version) per report as a single nested object,
    // avoiding a separate round-trip per report for the caller.
    `SELECT lr.*,
            (SELECT to_jsonb(x) FROM (
                SELECT p.id, p.scores, p.top_condition, p.top_confidence, p.risk_flag,
                       p.imputed_features, p.confirmed_condition, p.confirmed_at, p.created_at,
                       m.name AS model_name, m.version AS model_version
                  FROM predictions p JOIN ml_models m ON m.id = p.model_id
                 WHERE p.lab_report_id = lr.id
                 ORDER BY p.created_at DESC LIMIT 1) x) AS prediction
       FROM lab_reports lr
      WHERE lr.patient_ref = $1
      ORDER BY COALESCE(lr.collected_at, lr.created_at), lr.created_at`,
    [patientRef]
  );
  return rows;
}

async function listByLab(labId, limit = 100, db = null) {
  const { rows } = await run(db)(
    'SELECT * FROM lab_reports WHERE lab_id = $1 ORDER BY created_at DESC LIMIT $2',
    [labId, limit]
  );
  return rows;
}

module.exports = { create, findById, listByPatient, listByPatientWithPredictions, listByLab };
