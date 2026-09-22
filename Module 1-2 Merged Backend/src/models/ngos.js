// backend/src/models/ngos.js
// ---------------------------------------------------------------------------
// NGO profiles for the Help Portal. An NGO's profile row is created lazily —
// the first time its user hits GET/PUT /help/ngos/me — rather than at
// register time, so the auth flow (Module 2) stays untouched by Module 6.5's
// concerns.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

const PUBLIC_FIELDS = `
  id, name, mission, description, logo_url, website,
  contact_email, contact_phone, district, province, donation_info,
  verified, created_at`;

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

/** Fetch the caller's NGO profile, creating an empty one on first access. */
async function getOrCreateForUser(userId, fallbackName) {
  const existing = await getByUserId(userId);
  if (existing) return existing;
  const { rows } = await query(
    `INSERT INTO ngos (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId, fallbackName || 'New NGO']
  );
  return rows[0];
}

async function updateForUser(userId, {
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
      WHERE user_id = $1
      RETURNING *`,
    [userId, name, mission, description, logoUrl || null, website || null,
      contactEmail || null, contactPhone || null, district || null, province || null,
      donationInfo ? JSON.stringify(donationInfo) : null]
  );
  return rows[0] || null;
}

module.exports = { listPublic, getPublicById, getByUserId, getOrCreateForUser, updateForUser };
