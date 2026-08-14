// backend/src/db/pool.js
// ---------------------------------------------------------------------------
// Central PostgreSQL connection pool. Every model imports { query, getClient }
// from here so that (a) we share one pool and (b) all DB access goes through
// PARAMETERIZED queries — user input is never string-concatenated into SQL,
// which is our baseline defense against SQL injection.
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

// If an idle pooled client errors (e.g. DB restarts), log it; pg replaces it.
pool.on('error', (err) => {
  console.error('[db] unexpected idle client error:', err.message);
});

/**
 * Run a single parameterized query.
 * @param {string} text  SQL with $1,$2,... placeholders
 * @param {Array}  params values bound to the placeholders
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Check out a dedicated client for a multi-statement transaction.
 * Caller MUST call client.release() in a finally block.
 */
async function getClient() {
  return pool.connect();
}

module.exports = { pool, query, getClient };
