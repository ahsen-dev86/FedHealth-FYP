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

function authHeaders(extra = {}) {
  const t = tokenGetter();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}

function jsonRequest(method) {
  return (path, body, token) =>
    fetch(`${BASE}${path}`, {
      method,
      headers: authHeaders({
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }),
      body: JSON.stringify(body || {}),
    }).then(handle);
}

export const api = {
  get: (path) =>
    fetch(`${BASE}${path}`, { headers: authHeaders() }).then(handle),

  post: jsonRequest('POST'),
  put: jsonRequest('PUT'),
  patch: jsonRequest('PATCH'),

  // multipart upload (OCR image). Do NOT set Content-Type; the browser adds the
  // multipart boundary automatically.
  upload: (path, formData) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    }).then(handle),
};
