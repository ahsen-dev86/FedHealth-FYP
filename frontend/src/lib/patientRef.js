// frontend/src/lib/patientRef.js
// The FedHealth patient ID: FH-XXXX-XXXX (Crockford base32, last character is a
// check character). Same rules as the backend's src/contract/patientRef.js;
// frontend/tests/patientRef.test.mjs checks the two agree.
//
// The ID is a pseudonym: no name, date of birth, CNIC or phone number. The
// doctor generates one for a new patient and writes it on the patient's card;
// a returning patient's ID is typed in to open their history.

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const FH_REF = /^FH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const LIMS_TOKEN = /^[0-9a-f]{64}$/;
const WEIGHTS = [1, 3, 5, 7, 9, 11, 13];

/** Check character for the 7 body characters. */
export function checkChar(body) {
  let sum = 0;
  for (let i = 0; i < 7; i += 1) sum += ALPHABET.indexOf(body[i]) * WEIGHTS[i];
  return ALPHABET[sum % 32];
}

/** "FH-XXXX-XXXX" from 7 body characters. */
export function formatRef(body) {
  const all = body + checkChar(body);
  return `FH-${all.slice(0, 4)}-${all.slice(4)}`;
}

/** A new random patient ID (the API's GET /patients/new-ref also checks it is unused). */
export function generateRef() {
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  let body = '';
  for (let i = 0; i < 7; i += 1) body += ALPHABET[bytes[i] % 32];
  return formatRef(body);
}

/** Tidy a complete typed ID: upper-case, I/L -> 1, O -> 0, dashes re-inserted. */
export function normalizeRef(raw) {
  const text = String(raw ?? '').trim();
  if (LIMS_TOKEN.test(text)) return text;
  const chars = text.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[^0-9A-Z]/g, '');
  const body = chars.startsWith('FH') ? chars.slice(2) : chars;
  if (body.length !== 8 || /U/.test(body)) return text;
  return `FH-${body.slice(0, 4)}-${body.slice(4)}`;
}

/**
 * Format while the doctor types: keeps only ID characters and places the
 * dashes, so "fh7k3m" shows as "FH-7K3M". A pasted LIMS token is left alone.
 */
export function formatWhileTyping(raw) {
  const text = String(raw ?? '');
  if (/^[0-9a-f]{20,64}$/.test(text.trim())) return text.trim();
  let chars = text.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[^0-9A-Z]/g, '');
  if (chars.startsWith('FH')) chars = chars.slice(2);
  else if (chars === 'F') return 'F';
  chars = chars.slice(0, 8);
  if (!chars && !/^fh/i.test(text.trim())) return '';
  return `FH-${chars.slice(0, 4)}${chars.length > 4 ? `-${chars.slice(4)}` : ''}`;
}

/** '' when `ref` is an acceptable patient ID, else what is wrong with it (API wording). */
export function patientRefError(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return 'Enter the patient ID (FH-XXXX-XXXX) or generate a new one';
  if (LIMS_TOKEN.test(text)) return '';
  if (text.includes('@')) return 'Use the FedHealth patient ID, not an email address';
  if (/^\d{5}-?\d{7}-?\d$/.test(text)) return 'This looks like a CNIC number; use the FedHealth patient ID instead';
  if (/^(\+?92|0)3\d{2}-?\d{7}$/.test(text)) return 'This looks like a phone number; use the FedHealth patient ID instead';
  if (!FH_REF.test(text)) return 'Patient ID must look like FH-XXXX-XXXX (letters and digits; generate one for a new patient)';
  const chars = text.replace(/^FH-/, '').replace('-', '');
  if (checkChar(chars.slice(0, 7)) !== chars[7]) return 'Patient ID check character does not match; re-read the ID for a typo';
  return '';
}
