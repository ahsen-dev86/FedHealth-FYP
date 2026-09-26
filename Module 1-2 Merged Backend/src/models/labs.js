// backend/src/models/labs.js
const { query } = require('../db/pool');

async function create({ name, district, province, latitude, longitude, limsType = null, flClientId = null }) {
  const { rows } = await query(
    `INSERT INTO labs (name, lims_type, district, province, latitude, longitude, fl_client_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [name, limsType, district, province, latitude, longitude, flClientId]
  );
  return rows[0];
}

async function findById(id, db = null) {
  const { rows } = await (db ? db.query.bind(db) : query)('SELECT * FROM labs WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findByFlClientId(flClientId) {
  const { rows } = await query('SELECT * FROM labs WHERE fl_client_id = $1', [flClientId]);
  return rows[0] || null;
}

async function listAll() {
  const { rows } = await query('SELECT * FROM labs ORDER BY name');
  return rows;
}

module.exports = { create, findById, findByFlClientId, listAll, list: listAll };
