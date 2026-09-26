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

function send(path, init, token) {
  return fetch(`${BASE}${path}`, init)
    .catch(() => {
      const err = new Error('Cannot reach the FedHealth server. Check that it is running and try again.');
      err.status = 0;
      throw err;
    })
    .then((res) => handle(res, token));
}

function authHeaders(extra = {}) {
  const t = tokenGetter();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}

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

export const api = {
  get: (path) => send(path, { headers: authHeaders() }, tokenGetter()),

  post: jsonRequest('POST'),
  put: jsonRequest('PUT'),
  patch: jsonRequest('PATCH'),

  // multipart upload (OCR image). Do NOT set Content-Type; the browser adds the
  // multipart boundary automatically.
  upload: (path, formData) => send(path, { method: 'POST', headers: authHeaders(), body: formData }, tokenGetter()),
};
