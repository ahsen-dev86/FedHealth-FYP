// backend/scripts/bootstrap-admin.js
// ---------------------------------------------------------------------------
// Create the first admin account. Public /register cannot make admins, so this
// script bootstraps one. The admin is created as 'pending' and must still
// enrol MFA on first login (even admins can't skip MFA).
//
// Usage:
//   ADMIN_EMAIL=admin@fedhealth.pk ADMIN_PASSWORD='StrongPass123' \
//   ADMIN_NAME='FedHealth Admin' node scripts/bootstrap-admin.js
// or:
//   node scripts/bootstrap-admin.js admin@fedhealth.pk 'StrongPass123' 'FedHealth Admin'
// ---------------------------------------------------------------------------
require('dotenv').config();
const Users = require('../src/models/users');
const Roles = require('../src/models/roles');
const password = require('../src/auth/password');
const { pool } = require('../src/db/pool');

/** Reads admin email/password/name from env vars or CLI args, then creates the admin user. */
async function main() {
  const email = process.env.ADMIN_EMAIL || process.argv[2];
  const pw = process.env.ADMIN_PASSWORD || process.argv[3];
  const name = process.env.ADMIN_NAME || process.argv[4] || 'FedHealth Admin';

  if (!email || !pw) {
    console.error('Usage: ADMIN_EMAIL=.. ADMIN_PASSWORD=.. [ADMIN_NAME=..] node scripts/bootstrap-admin.js');
    process.exit(1);
  }

  const existing = await Users.findByEmail(email);
  if (existing) {
    console.log(`Admin already exists: ${email}`);
    await pool.end();
    return;
  }

  const role = await Roles.getByName('admin');
  if (!role) {
    console.error('No "admin" role found — run db/seed/seed.sql first.');
    process.exit(1);
  }

  const passwordHash = await password.hash(pw);
  const user = await Users.create({
    email, fullName: name, roleId: role.id,
    organization: 'FedHealth', passwordHash,
  });

  console.log(`Created admin: ${user.email}  (id ${user.id})`);
  console.log('Next: POST /auth/login, then complete MFA setup on first login.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
