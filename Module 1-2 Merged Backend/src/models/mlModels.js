// backend/src/models/mlModels.js
// ---------------------------------------------------------------------------
// Registry of trained model versions. Each prediction references the exact
// model version that produced it; each registered version stores its MEASURED
// metrics (scripts/register-model.js loads final_test/*_metrics.json) — the
// seed never invents scores. Functions take an optional `db` (a transaction
// client from withTransaction) and default to the shared pool.
// ---------------------------------------------------------------------------
const { query, withTransaction } = require('../db/pool');

// Use the caller's transaction client if given, otherwise the shared pool.
const run = (db) => (db ? db.query.bind(db) : query);

// Inserts a model version, or updates it in place if (name, version) already
// exists (idempotent re-registration). is_active is OR'd with the existing
// value so re-running registration never silently deactivates a live model.
async function register({
  name, version, diseaseScope = null, classes, metrics = {}, calibration = null, isActive = false,
  provenance = {}, limitations = {}, trainingData = {},
}, db = null) {
  const { rows } = await run(db)(
    `INSERT INTO ml_models (name, version, disease_scope, classes, metrics, calibration, is_active,
                            provenance, limitations, training_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (name, version) DO UPDATE
       SET disease_scope = EXCLUDED.disease_scope, classes = EXCLUDED.classes,
           metrics = EXCLUDED.metrics, calibration = EXCLUDED.calibration,
           provenance = EXCLUDED.provenance, limitations = EXCLUDED.limitations,
           training_data = EXCLUDED.training_data,
           is_active = ml_models.is_active OR EXCLUDED.is_active
     RETURNING *`,
    [name, version, diseaseScope, JSON.stringify(classes), JSON.stringify(metrics), calibration, isActive,
      JSON.stringify(provenance), JSON.stringify(limitations), JSON.stringify(trainingData)]
  );
  return rows[0];
}

/** Activate one version and deactivate every other version of the same name, atomically. */
async function setActive(id, db = null) {
  const body = async (client) => {
    const { rows } = await client.query('SELECT name FROM ml_models WHERE id = $1', [id]);
    if (!rows[0]) return null;
    await client.query('UPDATE ml_models SET is_active = FALSE WHERE name = $1 AND id <> $2', [rows[0].name, id]);
    const upd = await client.query('UPDATE ml_models SET is_active = TRUE WHERE id = $1 RETURNING *', [id]);
    return upd.rows[0];
  };
  return db ? body(db) : withTransaction(body);
}

async function findById(id, db = null) {
  const { rows } = await run(db)('SELECT * FROM ml_models WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findByNameVersion(name, version, db = null) {
  const { rows } = await run(db)('SELECT * FROM ml_models WHERE name = $1 AND version = $2', [name, version]);
  return rows[0] || null;
}

// Active model, optionally narrowed to one name; the WHERE clause is built up
// dynamically since the name filter is optional.
async function findActive(name = null, db = null) {
  const params = [];
  let where = 'is_active = true';
  if (name) { params.push(name); where += ` AND name = $${params.length}`; }
  const { rows } = await run(db)(
    `SELECT * FROM ml_models WHERE ${where} ORDER BY created_at DESC LIMIT 1`,
    params
  );
  return rows[0] || null;
}

/** Module 6 name for findActive(name). */
const getActive = (name, db = null) => findActive(name, db);

// Registry listing for admin/dashboard views; pulls accuracy/macro_f1 straight
// out of the jsonb `metrics` column instead of returning the whole blob.
async function listAll(db = null) {
  const { rows } = await run(db)(
    `SELECT id, name, version, disease_scope, classes, calibration, is_active, created_at,
            metrics ->> 'accuracy' AS accuracy, metrics ->> 'macro_f1' AS macro_f1
       FROM ml_models ORDER BY created_at DESC`);
  return rows;
}

module.exports = { register, setActive, findById, findByNameVersion, findActive, getActive, listAll };
