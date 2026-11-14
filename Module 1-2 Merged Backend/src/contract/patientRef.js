// backend/src/contract/patientRef.js
// ---------------------------------------------------------------------------
// The FedHealth patient ID: FH-XXXX-XXXX.
//
//   * 8 Crockford base32 characters (0-9 and A-Z without I, L, O, U, so a
//     hand-copied ID cannot confuse 1/I/L or 0/O).
//   * The first 7 are random (35 bits); the 8th is a check character, so a
//     mistyped ID is rejected instead of silently opening an empty history.
//   * It carries no name, date of birth, CNIC or phone number: it is a
//     pseudonym issued by GET /patients/new-ref and written on the patient's
//     card or file by the clinic.
//
// A LIMS integration may instead send the 64-hex HMAC token from
// models/pseudonymize.js; both shapes are accepted for stored reports.
// frontend/src/lib/patientRef.js is the same code for the browser, and
// test/unit/patientRef.test.js checks the two agree.
// ---------------------------------------------------------------------------
const crypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const FH_REF = /^FH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const LIMS_TOKEN = /^[0-9a-f]{64}$/;
const WEIGHTS = [1, 3, 5, 7, 9, 11, 13]; // odd, so every single-character typo changes the check

/** Check character for the 7 body characters. */
function checkChar(body) {
  let sum = 0;
  for (let i = 0; i < 7; i += 1) sum += ALPHABET.indexOf(body[i]) * WEIGHTS[i];
  return ALPHABET[sum % 32];
}

/** "FH-XXXX-XXXX" from 7 body characters. */
function format(body) {
  const all = body + checkChar(body);
  return `FH-${all.slice(0, 4)}-${all.slice(4)}`;
}

/** A new random patient ID. */
function generate(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(7);
  let body = '';
  for (let i = 0; i < 7; i += 1) body += ALPHABET[bytes[i] % 32];
  return format(body);
}

/**
 * Tidy what a person typed: upper-case, read I/L as 1 and O as 0, drop spaces
 * and punctuation, re-insert the dashes. Returns the input trimmed when it
 * cannot be an FH ID (e.g. a LIMS token), so validation reports it.
 */
function normalize(raw) {
  const text = String(raw ?? '').trim();
  if (LIMS_TOKEN.test(text)) return text;
  const chars = text.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[^0-9A-Z]/g, '');
  const body = chars.startsWith('FH') ? chars.slice(2) : chars;
  if (body.length !== 8 || /U/.test(body)) return text;
  return `FH-${body.slice(0, 4)}-${body.slice(4)}`;
}

/** '' when `ref` is an acceptable patient reference, else what is wrong with it. */
function refError(ref) {
  const text = String(ref ?? '');
  if (!text.trim()) return 'Enter the patient ID (FH-XXXX-XXXX) or generate a new one';
  if (LIMS_TOKEN.test(text)) return '';
  if (text.includes('@')) return 'Use the FedHealth patient ID, not an email address';
  if (/^\d{5}-?\d{7}-?\d$/.test(text)) return 'This looks like a CNIC number; use the FedHealth patient ID instead';
  if (/^(\+?92|0)3\d{2}-?\d{7}$/.test(text)) return 'This looks like a phone number; use the FedHealth patient ID instead';
  if (!FH_REF.test(text)) return 'Patient ID must look like FH-XXXX-XXXX (letters and digits; generate one for a new patient)';
  const chars = text.replace(/^FH-/, '').replace('-', '');
  if (checkChar(chars.slice(0, 7)) !== chars[7]) return 'Patient ID check character does not match; re-read the ID for a typo';
  return '';
}

const isValid = (ref) => refError(ref) === '';

module.exports = { ALPHABET, FH_REF, LIMS_TOKEN, checkChar, format, generate, normalize, refError, isValid };
