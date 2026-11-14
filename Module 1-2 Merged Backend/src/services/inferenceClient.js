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
//
// No single point of failure: see "Failover" below.
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

/** One HTTP call to one inference replica, with an abort-based timeout and the status mapping above. */
async function callOne(baseUrl, pathname, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), inference.timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method, headers: headers(), signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const detail = data.error || res.status;
    if (res.status === 400) throw new HttpError(400, String(detail));
    if (res.status === 409) throw new HttpError(409, String(detail));
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

// --- Failover between the primary service and the backup replica -------------
// A request goes to the primary. If that fails with a service fault (502/503/504:
// unreachable, no model, timeout, internal error) and INFERENCE_FALLBACK_URL is
// set, the same request is sent to the backup replica. A 4xx is the caller's
// input and is never retried. After a primary fault the breaker stays open for
// inference.breakerMs, so the next requests skip the dead primary instead of
// each waiting for it to time out; the first request after that window tries
// the primary again. (The primary service also holds the backup bundle in
// process, for the case where the service is up but its primary model is not.)
const breaker = { openUntil: 0, lastError: null, lastFailureAt: null, failovers: 0 };
const isServiceFault = (e) => e instanceof HttpError && e.status >= 502 && e.status <= 504;

/** Call the inference service; `replica` in the result says which one answered. */
async function call(pathname, opts = {}) {
  const hasFallback = !!inference.fallbackUrl;
  const primaryFirst = !hasFallback || Date.now() >= breaker.openUntil;
  if (primaryFirst) {
    try {
      const data = await callOne(inference.url, pathname, opts);
      breaker.openUntil = 0;
      return { data, replica: 'primary' };
    } catch (e) {
      if (!hasFallback || !isServiceFault(e)) throw e;
      breaker.openUntil = Date.now() + inference.breakerMs;
      breaker.lastError = e.message;
      breaker.lastFailureAt = new Date().toISOString();
      console.warn(`[fedhealth] primary inference failed (${e.message}); using the backup replica`);
    }
  }
  try {
    const data = await callOne(inference.fallbackUrl, pathname, opts);
    breaker.failovers += 1;
    return { data, replica: 'backup' };
  } catch (e) {
    if (primaryFirst || !isServiceFault(e)) throw e;
    // The breaker sent us to the backup first and it failed too: give the primary its turn.
    const data = await callOne(inference.url, pathname, opts);
    breaker.openUntil = 0;
    return { data, replica: 'primary' };
  }
}

/**
 * Score one CBC record.
 * @param {string} model  'cbc_multiclass' (four-class screening)
 * @param {object} cbc    {WBC: 9010, ...} values as given
 * @param {object|null} units  {WBC: '/mm3', ...}; null => values are canonical
 * @param {object} [options]   explain: also return per-feature Shapley contributions
 */
async function infer(model, cbc, units = null, { explain = true } = {}) {
  const { data, replica } = await call('/infer', {
    method: 'POST',
    body: { model, cbc, explain, ...(units ? { units } : { canonical_units: true }) },
  });
  // 'backup' when the backup replica answered OR the service fell back to its own backup bundle.
  const servedBy = replica === 'backup' || data.served_by === 'backup' ? 'backup' : 'primary';
  return {
    ...data,
    served_by: servedBy,
    failover_reason: servedBy === 'backup'
      ? (data.failover_reason || `primary inference service unavailable: ${breaker.lastError || 'no response'}`)
      : null,
  };
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
  const explanation = inf.explanation && inf.explanation.contributions ? {
    ...inf.explanation,
    baseline_scores: inOrder(inf.explanation.baseline_scores, CLASSES),
    reference_values: inOrder(inf.explanation.reference_values, FEATURES),
    contributions: Object.fromEntries(CLASSES.filter((c) => c in inf.explanation.contributions)
      .map((c) => [c, inOrder(inf.explanation.contributions[c], FEATURES)])),
  } : (inf.explanation || null);
  return {
    ...inf,
    scores: inOrder(inf.scores, CLASSES),
    canonical_cbc: inOrder(inf.canonical_cbc, FEATURES),
    canonical_units: inOrder(inf.canonical_units, FEATURES),
    explanation,
  };
}

/** What the inference service currently serves (mode + version per model). */
async function listModels() {
  return (await call('/models')).data;
}

/** Health of one replica, never throwing. */
async function probe(baseUrl) {
  try {
    return await callOne(baseUrl, '/health');
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Serving status across the primary service (with its in-process backup bundle)
 * and the backup replica. ok = at least one path can score a CBC right now.
 */
async function health() {
  const [primary, replica] = await Promise.all([
    probe(inference.url),
    inference.fallbackUrl ? probe(inference.fallbackUrl) : Promise.resolve(null),
  ]);
  const inProcess = Object.values(primary.failover || {})[0] || null;
  let serving = 'none';
  if (primary.ok) serving = inProcess?.serving === 'backup' ? 'backup' : 'primary';
  else if (replica?.ok) serving = 'backup';
  return {
    ok: serving !== 'none',
    service: 'fedhealth-inference',
    serving,
    models: primary.ok ? primary.models : replica?.ok ? replica.models : undefined,
    primary: { ok: !!primary.ok, error: primary.error || null, failover: inProcess },
    backupReplica: replica
      ? { configured: true, ok: !!replica.ok, error: replica.error || null,
          version: Object.values(replica.failover || {})[0]?.primary?.version || null }
      : { configured: false },
    backupConfigured: !!inference.fallbackUrl || !!inProcess?.backup,
    breaker: {
      open: Date.now() < breaker.openUntil, lastError: breaker.lastError,
      lastFailureAt: breaker.lastFailureAt, failovers: breaker.failovers,
    },
  };
}

/** The service's own contract, for the startup drift check. */
async function contract() {
  return (await call('/contract')).data;
}

/** Failover drill: mark the primary model down (or restore it) inside the primary service. */
async function drill(primaryDown) {
  return callOne(inference.url, '/drill', { method: 'POST', body: { primary_down: !!primaryDown } });
}

module.exports = { infer, assertContract, listModels, health, contract, drill };
