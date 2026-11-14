#!/usr/bin/env node
// backend/scripts/migrate-patient-refs.js
// ---------------------------------------------------------------------------
// Re-key reports stored before the FedHealth patient ID format existed.
//
// Every distinct legacy patient_ref (e.g. "pt007", "e2e-pt-2026...") gets one
// new FH-XXXX-XXXX ID; all of that patient's reports move to it together, so
// longitudinal history is preserved. LIMS HMAC tokens (64 hex) are already a
// consistent format and are left alone. The old -> new mapping is kept in
// patient_ref_migrations, which makes the change reversible:
//
//   UPDATE lab_reports lr SET patient_ref = m.old_ref
//     FROM patient_ref_migrations m WHERE lr.patient_ref = m.new_ref;
//
// When no legacy reference remains, chk_lab_reports_patient_ref_format is
// VALIDATEd, so the database itself guarantees the format from then on.
//
//   node scripts/migrate-patient-refs.js           # dry run: report only
//   node scripts/migrate-patient-refs.js --apply   # re-key in one transaction
//
// Runs as the PostgreSQL superuser from the repository-root .env (like db-setup).
// ---------------------------------------------------------------------------
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');
const PatientRef = require('../src/contract/patientRef');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apply = process.argv.includes('--apply');
const LEGACY = `NOT (patient_ref ~ '^FH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' OR patient_ref ~ '^[0-9a-f]{64}$')`;

async function main() {
  if (!process.env.PG_SUPERUSER_PASSWORD) throw new Error('PG_SUPERUSER_PASSWORD is not set in the repository-root .env');
  const client = new Client({
    host: process.env.PGHOST || 'localhost', port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'fedhealth',
    user: process.env.PG_SUPERUSER || 'postgres', password: process.env.PG_SUPERUSER_PASSWORD,
  });
  await client.connect();
  try {
    const { rows: legacy } = await client.query(
      `SELECT patient_ref, COUNT(*)::int AS reports FROM lab_reports WHERE ${LEGACY} GROUP BY 1 ORDER BY 1`);
    const reports = legacy.reduce((n, r) => n + r.reports, 0);
    console.log(`[migrate-patient-refs] ${legacy.length} legacy patient reference(s) on ${reports} report(s)`);
    if (!apply) {
      legacy.slice(0, 10).forEach((r) => console.log(`  ${r.patient_ref}  (${r.reports})`));
      if (legacy.length > 10) console.log(`  ... and ${legacy.length - 10} more`);
      console.log('[migrate-patient-refs] dry run; pass --apply to re-key them');
      return;
    }

    await client.query('BEGIN');
    try {
      const { rows: taken } = await client.query(
        `SELECT patient_ref AS ref FROM lab_reports UNION SELECT new_ref FROM patient_ref_migrations`);
      const used = new Set(taken.map((r) => r.ref));
      for (const { patient_ref: oldRef } of legacy) {
        const { rows: [known] } = await client.query('SELECT new_ref FROM patient_ref_migrations WHERE old_ref = $1', [oldRef]);
        let newRef = known?.new_ref;
        if (!newRef) {
          do { newRef = PatientRef.generate(); } while (used.has(newRef));
          used.add(newRef);
          await client.query('INSERT INTO patient_ref_migrations (old_ref, new_ref) VALUES ($1, $2)', [oldRef, newRef]);
        }
        await client.query('UPDATE lab_reports SET patient_ref = $2 WHERE patient_ref = $1', [oldRef, newRef]);
      }
      const { rows: [left] } = await client.query(`SELECT COUNT(*)::int AS n FROM lab_reports WHERE ${LEGACY}`);
      if (left.n) throw new Error(`${left.n} report(s) still carry a legacy reference`);
      await client.query('ALTER TABLE lab_reports VALIDATE CONSTRAINT chk_lab_reports_patient_ref_format');
      await client.query('COMMIT');
      console.log(`[migrate-patient-refs] re-keyed ${legacy.length} patient(s); format constraint validated`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(`[migrate-patient-refs] ${e.message}`); process.exit(1); });
