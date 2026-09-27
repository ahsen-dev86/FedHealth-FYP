// backend/src/models/mlModels.js
// ---------------------------------------------------------------------------
// Registry of trained model versions. Each prediction references the exact
// model that produced it, and each version stores its validation metrics
// (macro-F1, per-class recall) — the evidence you show at defense that the
// model isn't biased toward one disease.
// ---------------------------------------------------------------------------
const { query, getClient } = require('../db/pool');

/**
 * Register (or upsert) a model version. `classes` and `metrics` are JS values
 * we explicitly JSON.stringify, since they're semantic documents rather than
 * ad-hoc row data.
 */
async function register({
  name, version, diseaseScope, classes, metrics = {}, calibration = null,
}) {
  const { rows } = await query(
    `INSERT INTO ml_models (name, version, disease_scope, classes, metrics, calibration)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (name, version) DO UPDATE
        SET disease_scope = EXCLUDED.disease_scope,
            classes       = EXCLUDED.classes,
            metrics       = EXCLUDED.metrics,
            calibration   = EXCLUDED.calibration
     RETURNING *`,
    [name, version, diseaseScope,
     JSON.stringify(classes), JSON.stringify(metrics), calibration]
  );
  return rows[0];
}

/**
 * Mark one version active, deactivating any other version of the same model
 * name — done in a transaction so there's never zero-or-two active versions.
 */
async function setActive(id) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT name FROM ml_models WHERE id = $1', [id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return null; }

    await client.query('UPDATE ml_models SET is_active = FALSE WHERE name = $1', [rows[0].name]);
    const upd = await client.query(
      'UPDATE ml_models SET is_active = TRUE WHERE id = $1 RETURNING *', [id]
    );
    await client.query('COMMIT');
    return upd.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** The currently active version for a model name (used at inference time). */
async function getActive(name) {
  const { rows } = await query(
    `SELECT * FROM ml_models
      WHERE name = $1 AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}

/** Fetch a single model version by its primary key. */
async function findById(id) {
  const { rows } = await query('SELECT * FROM ml_models WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = { register, setActive, getActive, findById };
