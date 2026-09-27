// frontend/src/api/client.js
// ---------------------------------------------------------------------------
// Tiny fetch wrapper for the FedHealth backend. Attaches the JWT access token,
// centralizes error handling, and supports JSON + multipart (OCR) requests.
//
// Errors always reach the UI as an Error with a readable message and .status:
// the API's own { error } text for 4xx, a plain explanation when the server or
// the analysis service is unreachable (status 0 / 502-504), and an expired
// session (401 while signed in) triggers the handler AuthContext registers.
//
// The token is read from a getter so AuthContext owns storage; this module has
// no state of its own beyond the two registered callbacks.
// ---------------------------------------------------------------------------

// In dev, vite proxies '/api' -> the backend. In prod set VITE_API_URL.
const BASE = import.meta.env.VITE_API_URL || '/api';

let tokenGetter = () => null;
let unauthorizedHandler = null;
export function setTokenGetter(fn) { tokenGetter = fn; }
export function setUnauthorizedHandler(fn) { unauthorizedHandler = fn; }

const FALLBACK = {
  413: 'The upload or request is too large.',
  429: 'Too many attempts. Wait a few minutes and try again.',
  502: 'The analysis service is not reachable right now. Try again shortly.',
  503: 'The analysis service is not ready (no verified model loaded).',
  504: 'The analysis service took too long to answer. Try again.',
};

// Turn a fetch Response into resolved JSON/text, or throw a normalized Error
// (with .status/.data) for non-2xx responses; also fires unauthorizedHandler
// when a 401 comes back for the token that is still the current one.
async function handle(res, sentToken) {
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text().catch(() => '');
  if (!res.ok) {
    // A 401 on a request made with the session token means the session ended.
    if (res.status === 401 && sentToken && sentToken === tokenGetter() && unauthorizedHandler) {
      unauthorizedHandler();
    }
    const message = (data && data.error) || FALLBACK[res.status] || res.statusText || 'Request failed';
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// fetch() + a network-failure fallback (no response at all, e.g. server down)
// normalized into the same Error shape as handle() produces for HTTP errors.
function send(path, init, token) {
  return fetch(`${BASE}${path}`, init)
    .catch(() => {
      const err = new Error('Cannot reach the FedHealth server. Check that it is running and try again.');
      err.status = 0;
      throw err;
    })
    .then((res) => handle(res, token));
}

// Adds the bearer token (from tokenGetter) to any extra headers, when present.
function authHeaders(extra = {}) {
  const t = tokenGetter();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}

// Factory for the JSON verbs (POST/PUT/PATCH): serializes `body`, sets the
// JSON content type, and allows a one-off `token` override (used pre-login,
// e.g. MFA verification, before AuthContext has a stored session token).
function jsonRequest(method) {
  return (path, body, token) => send(path, {
    method,
    headers: authHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    body: JSON.stringify(body || {}),
  }, token || tokenGetter());
}

// Public surface every page component calls; same shape as client.mock.js so
// swapping the mock in (see vite.config.js) requires no changes to callers.
export const api = {
  get: (path) => send(path, { headers: authHeaders() }, tokenGetter()),

  post: jsonRequest('POST'),
  put: jsonRequest('PUT'),
  patch: jsonRequest('PATCH'),

  // multipart upload (OCR image). Do NOT set Content-Type; the browser adds the
  // multipart boundary automatically.
  upload: (path, formData) => send(path, { method: 'POST', headers: authHeaders(), body: formData }, tokenGetter()),
};
