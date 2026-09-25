// backend/src/services/inferenceClient.js
// ---------------------------------------------------------------------------
// Thin HTTP client for the Python inference microservice (ml/inference_service).
// Keeps all model logic in Python; the backend just sends CBC values and gets
// back calibrated confidence scores + the interpretable rule flags. Uses the
// built-in global fetch (Node 18+), so no extra dependency.
// ---------------------------------------------------------------------------
const { inference } = require('../config');
const { HttpError } = require('../middleware/errors');

/**
 * Score one CBC record.
 * @param {string} model  'cbc_multiclass' (four-class screening)
 * @param {object} cbc    { HGB: 12.3, MCV: 85, ... }
 * @returns the inference service's JSON response (scores, rule_flags, etc.)
 */
async function infer(model, cbc, units = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), inference.timeoutMs);
  try {
    const res = await fetch(`${inference.url}/infer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(inference.apiKey ? { 'X-API-Key': inference.apiKey } : {}),
      },
      body: JSON.stringify({ model, cbc, ...(units ? { units } : { canonical_units: true }) }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new HttpError(502, `inference service error: ${data.error || res.status}`);
    }
    return data;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e.name === 'AbortError') throw new HttpError(504, 'inference service timeout');
    throw new HttpError(502, `inference service unreachable: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** List which model backends the inference service currently serves. */
async function listModels() {
  try {
    const res = await fetch(`${inference.url}/models`);
    return res.ok ? res.json() : {};
  } catch {
    return {};
  }
}

module.exports = { infer, listModels };
