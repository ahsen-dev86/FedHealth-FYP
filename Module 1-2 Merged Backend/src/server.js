// backend/src/server.js
// ---------------------------------------------------------------------------
// Process entrypoint: build the app and start listening. After start-up the
// backend compares its exported CBC contract with the inference service's
// GET /contract and logs any drift (the service may start later; predictions
// re-check classes and unit conversion on every call anyway).
// ---------------------------------------------------------------------------
const { createApp } = require('./app');
const { port } = require('./config');
const Inference = require('./services/inferenceClient');
const { contract } = require('./contract');

const app = createApp();

// The model service takes ~10 s to load its bundle, so retry for about a minute.
async function checkInferenceContract(attempt = 1) {
  try {
    const served = await Inference.contract();
    // Arrays keep their order (feature/class order matters); object keys are
    // compared sorted because Flask's jsonify sorts them.
    const canon = (v) => (Array.isArray(v) ? v.map(canon)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
    const keys = ['features', 'classes', 'canonical_units', 'plausible_ranges', 'schema_version'];
    const drift = keys.filter((k) => JSON.stringify(canon(served[k])) !== JSON.stringify(canon(contract[k])));
    if (drift.length) console.error(`[fedhealth] CONTRACT DRIFT with inference service: ${drift.join(', ')}`);
    else console.log(`[fedhealth] inference contract matches (${contract.schema_version})`);
  } catch (e) {
    if (attempt < 12) setTimeout(() => checkInferenceContract(attempt + 1), 5000).unref();
    else console.warn(`[fedhealth] inference contract not checked: ${e.message}`);
  }
}

// Last-resort logging: a stray rejection must be visible, not silently crash or hang
// the API. Route errors never get here (asyncHandler forwards them to errorHandler).
process.on('unhandledRejection', (reason) => console.error('[fedhealth] unhandled rejection:', reason));
process.on('uncaughtException', (err) => {
  console.error('[fedhealth] uncaught exception, exiting:', err);
  process.exit(1); // state may be corrupt; restart it (tools/run-local.ps1 -Start, or a compose restart policy)
});

app.listen(port, () => {
  console.log(`[fedhealth] backend API listening on http://localhost:${port}`);
  checkInferenceContract();
});
