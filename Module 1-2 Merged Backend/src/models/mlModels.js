// backend/src/models/mlModels.js
const { query } = require('../db/pool');

async function register({ name, version, diseaseScope = null, classes, metrics = {}, calibration = null, isActive = false }) {
  const { rows } = await query(
    `INSERT INTO ml_models (name, version, disease_scope, classes, metrics, calibration, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (name, version) DO UPDATE
       SET metrics = EXCLUDED.metrics, calibration = EXCLUDED.calibration, is_active = EXCLUDED.is_active
     RETURNING *`,
    [name, version, diseaseScope, JSON.stringify(classes), JSON.stringify(metrics), calibration, isActive]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await query('SELECT * FROM ml_models WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findActive(name = null) {
  const params = [];
  let where = 'is_active = true';
  if (name) { params.push(name); where += ` AND name = $${params.length}`; }
  const { rows } = await query(
    `SELECT * FROM ml_models WHERE ${where} ORDER BY created_at DESC LIMIT 1`,
    params
  );
  return rows[0] || null;
}

module.exports = { register, findById, findActive };
