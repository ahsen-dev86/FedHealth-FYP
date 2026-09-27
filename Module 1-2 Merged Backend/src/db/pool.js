// backend/src/db/pool.js
// ---------------------------------------------------------------------------
// Central PostgreSQL connection pool. Every model imports { query, getClient }
// from here so that (a) we share one pool and (b) all DB access goes through
// PARAMETERIZED queries — user input is never string-concatenated into SQL.
// ---------------------------------------------------------------------------
const { Pool } = require('pg'); // node-postgres: connection pool + parameterized query support

const pool = new Pool({
  host:               process.env.PGHOST     || 'localhost',
  port:               parseInt(process.env.PGPORT || '5432', 10),
  user:               process.env.PGUSER     || 'fedhealth_app',
  password:           process.env.PGPASSWORD || 'change_me_in_prod',
  database:           process.env.PGDATABASE || 'fedhealth',
  max:                parseInt(process.env.PG_POOL_MAX || '10', 10), // max simultaneous clients in the pool
  idleTimeoutMillis:  30000, // close a client that's been idle this long
  connectionTimeoutMillis: 5000, // give up acquiring a client after this long
});

// A pooled-but-idle client can still error (e.g. dropped connection); log it
// so it isn't a silent, unhandled 'error' event that crashes the process.
pool.on('error', (err) => {
  console.error('[db] unexpected idle client error:', err.message);
});

/** Run a parameterized query against the shared pool (auto-acquires/releases a client). */
async function query(text, params) {
  return pool.query(text, params);
}

/** Acquire a single client from the pool for manual multi-statement use (caller must release()). */
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
