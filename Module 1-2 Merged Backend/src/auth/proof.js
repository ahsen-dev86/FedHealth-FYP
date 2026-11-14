// backend/src/auth/proof.js
// ---------------------------------------------------------------------------
// Proof-of-role document required at first sign-up:
//   doctor        -> medical licence (PMDC registration)
//   nih_official  -> government employee card
//   lab_tech      -> laboratory employee card
//   ngo           -> NGO / foundation certificate of registration
//
// The file arrives as the multipart field "proof" on POST /auth/register, is
// held in memory (max 5 MB), identified by its leading bytes (the declared
// MIME type and file extension are not trusted), hashed, and stored in
// user_proofs. An administrator reviews it in the Admin Console; until then
// the account cannot open any portal.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const multer = require('multer');
const { HttpError } = require('../middleware/errors');

const MAX_BYTES = 5 * 1024 * 1024;

const PROOF_BY_ROLE = {
  doctor: { docType: 'medical_license', label: 'medical licence (PMDC registration certificate)' },
  nih_official: { docType: 'employee_card', label: 'government employee card' },
  lab_tech: { docType: 'lab_employee_card', label: 'laboratory employee card' },
  ngo: { docType: 'ngo_registration', label: 'NGO certificate of registration' },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 12 },
});

/** MIME type from the file's magic bytes, or null when it is not an accepted document type. */
function sniff(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** A display-safe file name: no path, no control characters, bounded length. */
function safeName(name, mimeType) {
  const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mimeType];
  const base = String(name || 'proof').split(/[\\/]/).pop().replace(/\.[^.]*$/, '')
    .replace(/[^\p{L}\p{N} ._-]/gu, '_').trim().slice(0, 80) || 'proof';
  return `${base}.${ext}`;
}

/**
 * Validate the uploaded proof for a role.
 * @returns {{docType, filename, mimeType, sha256, content}}
 */
function readProof(file, role) {
  const expected = PROOF_BY_ROLE[role];
  if (!expected) throw new HttpError(400, 'Unknown role');
  if (!file || !file.buffer?.length) {
    throw new HttpError(400, `Upload your ${expected.label} as proof (PDF, PNG, JPEG or WebP, up to 5 MB)`, 'PROOF_REQUIRED');
  }
  const mimeType = sniff(file.buffer);
  if (!mimeType) throw new HttpError(400, 'The proof must be a PDF, PNG, JPEG or WebP file', 'PROOF_TYPE');
  return {
    docType: expected.docType,
    filename: safeName(file.originalname, mimeType),
    mimeType,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    content: file.buffer,
  };
}

module.exports = { upload, readProof, sniff, safeName, PROOF_BY_ROLE, MAX_BYTES };
