// backend/src/models/supplyRequests.js
// ---------------------------------------------------------------------------
// Supply requests (blood/medicine/equipment/funds) posted by an NGO. Public
// browsing joins in the NGO's name/district so the donor board doesn't need a
// second round-trip; ownership writes are always scoped by ngo_id, which the
// route layer resolves from req.user.id -> Ngos.getByUserId -> ngo.id.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

// Donor-board feed: only still-actionable requests (open/partially fulfilled),
// each filter param optional (NULL = don't filter on it), sorted most-urgent
// first via an explicit CASE ranking (urgency is text, not naturally ordered).
async function listPublic({ category = null, province = null, urgency = null } = {}) {
  const { rows } = await query(
    `SELECT sr.*, n.name AS ngo_name, n.district AS ngo_district
       FROM supply_requests sr
       JOIN ngos n ON n.id = sr.ngo_id
      WHERE sr.status IN ('open', 'partially_fulfilled')
        AND ($1::text IS NULL OR sr.category = $1)
        AND ($2::text IS NULL OR sr.province = $2)
        AND ($3::text IS NULL OR sr.urgency = $3)
      ORDER BY
        CASE sr.urgency WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        sr.created_at DESC`,
    [category, province, urgency]
  );
  return rows;
}

async function listForNgo(ngoId) {
  const { rows } = await query(
    'SELECT * FROM supply_requests WHERE ngo_id = $1 ORDER BY created_at DESC',
    [ngoId]
  );
  return rows;
}

async function create(ngoId, {
  category, bloodGroup, title, description, quantity, urgency, neededBy, district, province,
}) {
  const { rows } = await query(
    `INSERT INTO supply_requests
       (ngo_id, category, blood_group, title, description, quantity, urgency, needed_by, district, province)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'medium'), $8, $9, $10)
     RETURNING *`,
    [ngoId, category, bloodGroup || null, title, description || '', quantity || null,
      urgency || null, neededBy || null, district || null, province || null]
  );
  return rows[0];
}

/** Update/close a request, scoped to the owning ngoId so one NGO can't touch another's. */
async function updateOwned(requestId, ngoId, { title, description, quantity, urgency, status, neededBy }) {
  const { rows } = await query(
    `UPDATE supply_requests SET
        title = COALESCE($3, title),
        description = COALESCE($4, description),
        quantity = COALESCE($5, quantity),
        urgency = COALESCE($6, urgency),
        status = COALESCE($7, status),
        needed_by = COALESCE($8, needed_by),
        updated_at = now()
      WHERE id = $1 AND ngo_id = $2
      RETURNING *`,
    [requestId, ngoId, title, description, quantity, urgency, status, neededBy]
  );
  return rows[0] || null;
}

module.exports = { listPublic, listForNgo, create, updateOwned };
