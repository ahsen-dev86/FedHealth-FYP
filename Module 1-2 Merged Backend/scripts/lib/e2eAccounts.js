// backend/scripts/lib/e2eAccounts.js
// Shared by the end-to-end scripts (e2e-acceptance, e2e-robustness, the
// Playwright live spec's API calls): what a throwaway test account needs now
// that sign-up requires a proof document and administrator approval.
//
//   proofForm(fields)     multipart body for POST /auth/register with a small PDF as proof
//   approveByEmail(email) mark the account approved directly in the database
//                         (the scripts run beside the database; the API path is
//                         covered by scripts/e2e-production.js)
//   refFor(seed)          a valid FH-XXXX-XXXX patient ID derived from a seed,
//                         so a script can reuse "the same patient" by name
const crypto = require('crypto');
const PatientRef = require('../../src/contract/patientRef');

// A one-page PDF: identified as a PDF by its leading bytes.
const PROOF_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

function proofForm(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  form.append('proof', new Blob([PROOF_PDF], { type: 'application/pdf' }), 'e2e-proof.pdf');
  return form;
}

async function approveByEmail(email) {
  // Required lazily so importing this file never opens a database pool by itself.
  const { query } = require('../../src/db/pool');
  const { rowCount } = await query(
    `UPDATE users SET verification_status = 'approved', verification_note = 'approved by an e2e script', verified_at = now()
      WHERE email = $1`, [email]);
  if (rowCount !== 1) throw new Error(`approveByEmail: no account ${email}`);
}

function refFor(seed) {
  const hash = crypto.createHash('sha256').update(String(seed)).digest();
  let body = '';
  for (let i = 0; i < 7; i += 1) body += PatientRef.ALPHABET[hash[i] % 32];
  return PatientRef.format(body);
}

module.exports = { proofForm, approveByEmail, refFor, PROOF_PDF };
