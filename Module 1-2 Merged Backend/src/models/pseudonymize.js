// backend/src/models/pseudonymize.js
// ---------------------------------------------------------------------------
// Derives lab_reports.patient_ref from a lab's own internal record number.
// HMAC-SHA256 (not a plain hash) so the token can't be brute-forced from a
// guessed record number without PATIENT_REF_HMAC_KEY too. The same
// (recordNumber, key) pair always yields the same token, which is what
// lets longitudinal trend charts work across a patient's visits without
// the database ever seeing a name, DOB, or CNIC.
//
// PATIENT_REF_HMAC_KEY must be a long random secret, set once per
// deployment (openssl rand -hex 32), never committed. Rotating it makes
// all previously-issued tokens unlinkable to new ones for the same
// patient — a deliberate, disruptive operation, not routine maintenance.
// ---------------------------------------------------------------------------
const crypto = require('crypto');

// Turns a lab's internal record number into the opaque patient_ref stored on
// lab_reports (see header for why HMAC and why the key matters).
function derivePatientRef(labInternalRecordNumber, hmacKey = process.env.PATIENT_REF_HMAC_KEY) {
  if (!hmacKey) {
    throw new Error('PATIENT_REF_HMAC_KEY is not set — refusing to derive an unkeyed patient_ref');
  }
  return crypto.createHmac('sha256', hmacKey).update(String(labInternalRecordNumber)).digest('hex');
}

module.exports = { derivePatientRef };
