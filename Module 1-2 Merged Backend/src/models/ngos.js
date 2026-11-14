// backend/src/models/ngos.js
// ---------------------------------------------------------------------------
// NGO profiles for the Help Portal. An NGO's profile row is created lazily —
// the first time its user hits GET/PUT /help/ngos/me — rather than at
// register time, so the auth flow (Module 2) stays untouched by Module 6.5's
// concerns.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

// Fields safe to show on the public Help Portal (excludes internal columns like user_id).
const PUBLIC_FIELDS = `
  id, name, mission, description, logo_url, website,
  contact_email, contact_phone, district, province, donation_info,
  verified, created_at`;

// Public NGO directory, each with a count of its currently open supply
// requests (LEFT JOIN + FILTER so NGOs with zero open requests still show 0).
async function listPublic() {
  const { rows } = await query(
    `SELECT n.${PUBLIC_FIELDS.replace(/\n\s*/g, ' ')},
            COUNT(sr.id) FILTER (WHERE sr.status = 'open') AS open_request_count
       FROM ngos n
       LEFT JOIN supply_requests sr ON sr.ngo_id = n.id
      GROUP BY n.id
      ORDER BY n.name`
  );
  return rows.map((r) => ({ ...r, open_request_count: Number(r.open_request_count) }));
}

async function getPublicById(id) {
  const { rows } = await query(`SELECT ${PUBLIC_FIELDS} FROM ngos WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function getByUserId(userId) {
  const { rows } = await query('SELECT * FROM ngos WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

/**
 * Fetch the caller's NGO profile, creating an empty one on first access.
 * The new row's contact_email defaults to the account's login email so the
 * profile form doesn't start with an empty contact field.
 */
async function getOrCreateForUser(userId, fallbackName, fallbackEmail) {
  const existing = await getByUserId(userId);
  if (existing) return existing;
  const { rows } = await query(
    `INSERT INTO ngos (user_id, name, contact_email) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId, fallbackName || 'New NGO', fallbackEmail || null]
  );
  return rows[0];
}

// Partial update of the caller's NGO profile. Most fields use COALESCE so an
// omitted (undefined -> null) value keeps the existing column instead of
// wiping it; logoUrl/website/contact fields are set directly so they CAN be cleared.
async function updateForUser(userId, data) {
  return updateWhere('user_id', userId, data);
}

/** Same partial update, addressed by NGO id (administrator acting for an NGO). */
async function updateById(ngoId, data) {
  return updateWhere('id', ngoId, data);
}

// `column` is one of two literals chosen above, never request input.
async function updateWhere(column, key, {
  name, mission, description, logoUrl, website,
  contactEmail, contactPhone, district, province, donationInfo,
}) {
  const { rows } = await query(
    `UPDATE ngos SET
        name = COALESCE($2, name),
        mission = COALESCE($3, mission),
        description = COALESCE($4, description),
        logo_url = $5,
        website = $6,
        contact_email = $7,
        contact_phone = $8,
        district = $9,
        province = $10,
        donation_info = COALESCE($11, donation_info),
        updated_at = now()
      WHERE ${column} = $1
      RETURNING *`,
    [key, name, mission, description, logoUrl || null, website || null,
      contactEmail || null, contactPhone || null, district || null, province || null,
      donationInfo ? JSON.stringify(donationInfo) : null]
  );
  return rows[0] || null;
}

async function getById(id) {
  const { rows } = await query('SELECT * FROM ngos WHERE id = $1', [id]);
  return rows[0] || null;
}

/** Every NGO with its owner account and request counts (administrator view). */
async function listForAdmin() {
  const { rows } = await query(
    `SELECT n.*, u.email AS owner_email, u.full_name AS owner_name, u.verification_status AS owner_verification,
            COUNT(sr.id)::int AS request_count,
            (COUNT(sr.id) FILTER (WHERE sr.status = 'open'))::int AS open_request_count
       FROM ngos n
       LEFT JOIN users u ON u.id = n.user_id
       LEFT JOIN supply_requests sr ON sr.ngo_id = n.id
      GROUP BY n.id, u.email, u.full_name, u.verification_status
      ORDER BY n.name`
  );
  return rows;
}

/** Mark an NGO as verified (shown as a badge on the public Help Portal) or not. */
async function setVerified(id, verified) {
  const { rows } = await query(
    'UPDATE ngos SET verified = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, verified]);
  return rows[0] || null;
}

module.exports = {
  listPublic, getPublicById, getByUserId, getOrCreateForUser, updateForUser,
  getById, updateById, listForAdmin, setVerified,
};
