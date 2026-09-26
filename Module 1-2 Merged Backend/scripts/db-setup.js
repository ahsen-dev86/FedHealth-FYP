#!/usr/bin/env node
// backend/scripts/db-setup.js
// ---------------------------------------------------------------------------
// Local (no Docker) database setup for PostgreSQL with PostGIS:
//   1. create/refresh the least-privilege fedhealth_app login role with the
//      PGPASSWORD from the git-ignored backend .env (never the 005 placeholder)
//   2. create the PGDATABASE database if it is missing
//   3. check PostGIS is available, then apply init/*.sql in file-name order,
//      recording each file + SHA-256 in schema_migrations so re-runs skip what
//      is already applied and refuse to silently re-apply an edited file
//   4. prove the app role can log in and cannot mutate audit_logs
//
// Superuser credentials are read from the git-ignored repository-root .env
// (PG_SUPERUSER, PG_SUPERUSER_PASSWORD) and are only used by this script.
//
//   node scripts/db-setup.js            # create + migrate (idempotent)
//   node scripts/db-setup.js --reset    # DROP and rebuild PGDATABASE (fedhealth only)
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // PG_SUPERUSER*
dotenv.config({ path: path.resolve(__dirname, '../.env') });    // PGHOST.. + app PGPASSWORD

const INIT_DIR = path.resolve(__dirname, '../init');
const host = process.env.PGHOST || 'localhost';
const port = parseInt(process.env.PGPORT || '5432', 10);
const database = process.env.PGDATABASE || 'fedhealth';
const appUser = process.env.PGUSER || 'fedhealth_app';
const appPassword = process.env.PGPASSWORD;
const superUser = process.env.PG_SUPERUSER || 'postgres';
const superPassword = process.env.PG_SUPERUSER_PASSWORD;
const reset = process.argv.includes('--reset');

function fail(message) {
  console.error(`[db-setup] ${message}`);
  process.exit(1);
}

if (!superPassword) fail('PG_SUPERUSER_PASSWORD is not set in the repository-root .env');
if (!appPassword || appPassword === 'change_me_in_prod') {
  fail('Set a random PGPASSWORD in the backend .env (the 005 placeholder is refused)');
}
if (!/^[a-z_][a-z0-9_]*$/.test(database) || !/^[a-z_][a-z0-9_]*$/.test(appUser)) {
  fail('PGDATABASE and PGUSER must be simple lower-case identifiers');
}

async function connect(db, user = superUser, password = superPassword) {
  const client = new Client({ host, port, database: db, user, password });
  await client.connect();
  return client;
}

async function main() {
  const admin = await connect('postgres');
  try {
    const { rows: [role] } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
    const verb = role ? 'ALTER' : 'CREATE';
    const { rows: [ddl] } = await admin.query(
      `SELECT format('${verb} ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql`, [appUser, appPassword]);
    await admin.query(ddl.sql);
    console.log(`[db-setup] role ${appUser}: ${role ? 'password refreshed' : 'created'}`);

    if (reset) {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      console.log(`[db-setup] dropped database ${database} (--reset)`);
    }
    const { rows: [db] } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (!db) {
      await admin.query(`CREATE DATABASE ${database}`);
      console.log(`[db-setup] created database ${database}`);
    }
  } finally {
    await admin.end();
  }

  const client = await connect(database);
  try {
    const { rows: ext } = await client.query(
      `SELECT name, default_version FROM pg_available_extensions
        WHERE name IN ('postgis','pgcrypto','citext') ORDER BY name`);
    console.log(`[db-setup] available: ${ext.map((e) => `${e.name} ${e.default_version}`).join(', ')}`);
    if (!ext.some((e) => e.name === 'postgis')) fail('PostGIS is not installed on this server');

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        sha256     TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const { rows: done } = await client.query('SELECT filename, sha256 FROM schema_migrations');
    const applied = new Map(done.map((r) => [r.filename, r.sha256]));

    const files = fs.readdirSync(INIT_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(INIT_DIR, file), 'utf8');
      const sha = crypto.createHash('sha256').update(sql).digest('hex');
      if (applied.has(file)) {
        if (applied.get(file) !== sha) {
          fail(`${file} changed after it was applied; write a new migration or rebuild with --reset`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, sha256) VALUES ($1, $2)', [file, sha]);
        await client.query('COMMIT');
        console.log(`[db-setup] applied ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        fail(`${file} failed: ${e.message}`);
      }
    }
    await client.query(`GRANT SELECT ON schema_migrations TO ${appUser}`);

    const { rows: installed } = await client.query(
      `SELECT extname, extversion FROM pg_extension WHERE extname IN ('postgis','pgcrypto','citext') ORDER BY 1`);
    console.log(`[db-setup] installed: ${installed.map((e) => `${e.extname} ${e.extversion}`).join(', ')}`);
  } finally {
    await client.end();
  }

  // The backend's own credentials must work, and must not be able to rewrite the audit trail.
  const app = await connect(database, appUser, appPassword);
  try {
    const { rows: [who] } = await app.query('SELECT current_user AS u');
    let blocked = false;
    try {
      await app.query('DELETE FROM audit_logs WHERE false');
    } catch (e) {
      blocked = e.code === '42501';
    }
    console.log(`[db-setup] app login ok as ${who.u}; audit_logs DELETE blocked: ${blocked}`);
    if (!blocked) fail('fedhealth_app can DELETE from audit_logs');
  } finally {
    await app.end();
  }
}

main().catch((e) => fail(e.message));
