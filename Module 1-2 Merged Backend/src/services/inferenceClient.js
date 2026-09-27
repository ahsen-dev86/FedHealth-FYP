// backend/src/services/inferenceClient.js
// ---------------------------------------------------------------------------
// Thin HTTP client for the Python inference service (Module 6 Domain API/app.py).
// All model logic stays in Python; the backend sends CBC values with their
// declared units and gets back calibrated four-class confidences. Uses Node's
// global fetch, so no extra dependency.
//
// Status mapping: a 400 from the service is the caller's input (unit, range,
// unknown field) and is passed through as 400; 503 means no verified model is
// loaded; anything else is a 502/504 gateway error.
// ---------------------------------------------------------------------------
const { inference } = require('../config');
const { HttpError } = require('../middleware/errors');
const { CLASSES, FEATURES } = require('../contract');

// JSON headers, plus the shared API key only when one is configured.
function headers() {
  return {
    'Content-Type': 'application/json',
    ...(inference.apiKey ? { 'X-API-Key': inference.apiKey } : {}),
  };
}

/** Call the inference service with an abort-based timeout, then map its status per the header note above. */
async function call(pathname, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), inference.timeoutMs);
  try {
    const res = await fetch(`${inference.url}${pathname}`, {
      method, headers: headers(), signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const detail = data.error || res.status;
    if (res.status === 400) throw new HttpError(400, String(detail));
    if (res.status === 503) throw new HttpError(503, `inference service has no verified model: ${detail}`);
    if (res.status === 401) throw new HttpError(502, 'inference service rejected the backend API key');
    throw new HttpError(502, `inference service error: ${detail}`);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e.name === 'AbortError') throw new HttpError(504, 'inference service timeout');
    throw new HttpError(502, `inference service unreachable: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Score one CBC record.
 * @param {string} model  'cbc_multiclass' (four-class screening)
 * @param {object} cbc    {WBC: 9010, ...} values as given
 * @param {object|null} units  {WBC: '/mm3', ...}; null => values are canonical
 */
async function infer(model, cbc, units = null) {
  return call('/infer', {
    method: 'POST',
    body: { model, cbc, ...(units ? { units } : { canonical_units: true }) },
  });
}

/**
 * Reject a response that does not follow the four-class contract, and check the
 * service converted units exactly as the backend did (drift between the Python
 * and exported JSON contracts would show up here first).
 */
function assertContract(inf, expectedCanonical = null) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Flask's jsonify sorts object keys, so `scores` arrives alphabetically; the
  // class ORDER is carried by the `classes` array and the key SET must match.
  if (!same(inf.classes, CLASSES)) {
    throw new HttpError(502, `inference classes ${JSON.stringify(inf.classes)} do not match ${JSON.stringify(CLASSES)}`);
  }
  if (!same(Object.keys(inf.scores || {}).sort(), [...CLASSES].sort())) {
    throw new HttpError(502, `inference score keys ${JSON.stringify(Object.keys(inf.scores || {}))} are not the four classes`);
  }
  if (!same(inf.features, FEATURES)) {
    throw new HttpError(502, 'inference feature order does not match the contract');
  }
  if (expectedCanonical && inf.canonical_cbc) {
    for (const [feature, value] of Object.entries(expectedCanonical)) {
      const served = inf.canonical_cbc[feature];
      if (served == null || Math.abs(served - value) > 1e-9 * Math.max(1, Math.abs(value))) {
        throw new HttpError(502, `unit conversion drift for ${feature}: backend ${value}, service ${served}`);
      }
    }
  }
  // Re-key in contract order so every API response lists classes/features the same way.
  const inOrder = (obj, keys) => (obj ? Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]])) : obj);
  return {
    ...inf,
    scores: inOrder(inf.scores, CLASSES),
    canonical_cbc: inOrder(inf.canonical_cbc, FEATURES),
    canonical_units: inOrder(inf.canonical_units, FEATURES),
  };
}

/** What the inference service currently serves (mode + version per model). */
async function listModels() {
  return call('/models');
}

async function health() {
  try {
    return await call('/health');
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** The service's own contract, for the startup drift check. */
async function contract() {
  return call('/contract');
}

module.exports = { infer, assertContract, listModels, health, contract };
