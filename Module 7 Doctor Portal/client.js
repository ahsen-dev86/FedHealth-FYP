// frontend/src/api/client.js
// ---------------------------------------------------------------------------
// Tiny fetch wrapper for the FedHealth backend. Attaches the JWT access token,
// centralizes error handling, and supports JSON + multipart (OCR) requests.
//
// The token is read from a getter so AuthContext owns storage; this module has
// no state of its own.
// ---------------------------------------------------------------------------

// In dev, vite proxies '/api' -> the backend. In prod set VITE_API_URL.
const BASE = import.meta.env.VITE_API_URL || '/api';

let tokenGetter = () => null;
export function setTokenGetter(fn) { tokenGetter = fn; }

// Shared response handler: parses JSON (or text) and throws an Error with the
// server's message + status/data attached when the response isn't ok.
async function handle(res) {
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const message = (data && data.error) || res.statusText || 'Request failed';
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Builds the Authorization header from the current token (if any), merged
// with any extra headers the caller needs (e.g. Content-Type).
function authHeaders(extra = {}) {
  const t = tokenGetter();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}

export const api = {
  get: (path) =>
    fetch(`${BASE}${path}`, { headers: authHeaders() }).then(handle),

  // `token` lets callers override the stored session token — used for the
  // pre-auth token during login/MFA, before a full session token exists.
  post: (path, body, token) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: authHeaders({
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }),
      body: JSON.stringify(body || {}),
    }).then(handle),

  // multipart upload (OCR image). Do NOT set Content-Type; the browser adds the
  // multipart boundary automatically.
  upload: (path, formData) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    }).then(handle),
};
