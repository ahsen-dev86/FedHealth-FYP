// backend/src/middleware/errors.js
// ---------------------------------------------------------------------------
// Error plumbing shared across the API.
//   * asyncHandler  — wraps async route handlers so thrown errors reach next().
//   * HttpError     — an error carrying an HTTP status + optional code.
//   * uuidParam     — 400 for a malformed :id before it reaches PostgreSQL.
//   * errorHandler  — the terminal middleware that shapes every error response.
//
// Every client mistake gets a 4xx with a message that says what to fix:
// malformed JSON, oversized bodies, bad uploads, Zod validation (first issue
// named), PostgreSQL check/type/FK errors. Unexpected failures return a generic
// 500 (details only in the server log), so internals such as connection
// strings or SQL never reach the client.
// ---------------------------------------------------------------------------
const { ZodError } = require('zod'); // schema validation library; ZodError is thrown on a failed .parse()

/** Wrap an async Express handler so a rejected promise is forwarded to next() (Express doesn't do this itself). */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** An error that already knows its intended HTTP status (and optional app-specific code). */
class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** router.param handler: reject a malformed UUID path parameter with 400. */
function uuidParam(req, res, next, value, name) {
  if (!UUID.test(String(value))) return next(new HttpError(400, `${name} must be a UUID`));
  return next();
}

/** Turn a ZodError into one human-readable message naming the first failing field. */
function zodMessage(err) {
  const issue = err.issues[0];
  if (!issue) return 'Validation failed';
  const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
  if (issue.code === 'unrecognized_keys') return `Unknown field(s): ${issue.keys.join(', ')}`;
  if (issue.code === 'invalid_type' && issue.received === 'undefined') return `${issue.path.join('.') || 'body'} is required`;
  return `${where}${issue.message}`;
}

// Multer (file-upload middleware) error codes mapped to a status + plain-English message.
const MULTER = {
  LIMIT_FILE_SIZE: [413, 'The image is larger than 8 MB'],
  LIMIT_FILE_COUNT: [400, 'Upload one report image at a time'],
  LIMIT_UNEXPECTED_FILE: [400, 'Upload the report image in the field "image"'],
  LIMIT_PART_COUNT: [400, 'Too many form fields'],
  LIMIT_FIELD_VALUE: [413, 'A form field is too large'],
};

// Terminal error middleware: classifies the error (Zod/body-parser/Multer/Postgres/
// HttpError/unknown) and responds with a matching status + safe message.
// eslint-disable-next-line no-unused-vars  (Express needs the 4-arg signature)
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: zodMessage(err), details: err.flatten() });
  }
  // express.json (body-parser) errors
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  if (err.type && /^(encoding|charset)\.unsupported$/.test(err.type)) {
    return res.status(415).json({ error: 'Unsupported request encoding' });
  }
  if (err.name === 'MulterError') {
    const [status, message] = MULTER[err.code] || [400, 'Invalid upload'];
    return res.status(status).json({ error: message });
  }

  // Known PostgreSQL SQLSTATE codes.
  switch (err.code) {
    case '23505': // unique_violation (e.g. duplicate email)
      return res.status(409).json({ error: 'Already exists' });
    case '23514': // check_violation (four-class contract, gov-domain trigger, confirmation role)
      return res.status(400).json({ error: err.message });
    case '23503': // foreign_key_violation (e.g. bad labId)
      return res.status(400).json({ error: 'Referenced record does not exist' });
    case '23502': // not_null_violation
      return res.status(400).json({ error: 'A required value is missing' });
    case '22P02': // invalid_text_representation (e.g. malformed uuid)
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
    case '22003': // numeric_value_out_of_range
    case '22001': // string_data_right_truncation
      return res.status(400).json({ error: 'Invalid value in request' });
    case '42501': // insufficient_privilege (e.g. attempt to mutate audit_logs)
      return res.status(403).json({ error: 'Operation not permitted' });
    default:
      break;
  }

  const status = err instanceof HttpError || (err.status >= 400 && err.status < 500) ? (err.status || 500) : 500;
  if (status >= 500) console.error('[error]', err); // keep 4xx quiet, log real faults
  // Our own HttpErrors carry safe, explicit messages; anything unexpected does not.
  const message = err instanceof HttpError ? err.message : status >= 500 ? 'Internal server error' : err.message;
  res.status(status).json({ error: message, ...(err instanceof HttpError && err.code ? { code: err.code } : {}) });
}

module.exports = { asyncHandler, HttpError, uuidParam, errorHandler };
