// backend/src/middleware/errors.js
// ---------------------------------------------------------------------------
// Error plumbing shared across the API.
//   * asyncHandler  — wraps async route handlers so thrown errors reach next().
//   * HttpError     — an error carrying an HTTP status + optional code.
//   * errorHandler  — the terminal middleware that shapes every error response,
//                     translating known PostgreSQL and Zod errors into clean
//                     HTTP statuses (e.g. the gov-domain trigger -> 400).
// ---------------------------------------------------------------------------
const { ZodError } = require('zod');

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// eslint-disable-next-line no-unused-vars  (Express needs the 4-arg signature)
function errorHandler(err, req, res, next) {
  // Request body failed validation.
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.flatten() });
  }

  // Known PostgreSQL SQLSTATE codes.
  switch (err.code) {
    case '23505': // unique_violation (e.g. duplicate email)
      return res.status(409).json({ error: 'Already exists' });
    case '23514': // check_violation (e.g. NIH gov-domain trigger rejection)
      return res.status(400).json({ error: err.message });
    case '23503': // foreign_key_violation (e.g. bad labId)
      return res.status(400).json({ error: 'Referenced record does not exist' });
    case '42501': // insufficient_privilege (e.g. attempt to mutate audit_logs)
      return res.status(403).json({ error: 'Operation not permitted' });
    default:
      break;
  }

  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err); // keep 4xx quiet, log real faults
  res.status(status).json({ error: err.message || 'Internal error', code: err.code });
}

module.exports = { asyncHandler, HttpError, errorHandler };
