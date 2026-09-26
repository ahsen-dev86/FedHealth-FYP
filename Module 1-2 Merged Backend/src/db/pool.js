// backend/src/db/pool.js
// ---------------------------------------------------------------------------
// Central PostgreSQL connection pool. Every model imports { query, getClient }
// from here so that (a) we share one pool and (b) all DB access goes through
// PARAMETERIZED queries — user input is never string-concatenated into SQL.
// ---------------------------------------------------------------------------
const { Pool } = require('pg');

const pool = new Pool({
  host:               process.env.PGHOST     || 'localhost',
  port:               parseInt(process.env.PGPORT || '5432', 10),
  user:               process.env.PGUSER     || 'fedhealth_app',
  password:           process.env.PGPASSWORD || 'change_me_in_prod',
  database:           process.env.PGDATABASE || 'fedhealth',
  max:                parseInt(process.env.PG_POOL_MAX || '10', 10),
  idleTimeoutMillis:  30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected idle client error:', err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

/**
 * Run fn(client) inside BEGIN/COMMIT on one pooled client; ROLLBACK on error.
 * Models accept that client as their optional last `db` argument.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, getClient, withTransaction };
