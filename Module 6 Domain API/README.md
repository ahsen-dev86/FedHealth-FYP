# Four-class screening inference

The active model is `cbc_multiclass`, with ordered healthy/anemia/thalassemia/leukemia
scores. Point the service at one verified bundle with `FEDHEALTH_MODEL_DIR`
(e.g. `FYP_model_data_drive/FYP/four_class/four_class_v1/seed42/centralized/model`), or set
`MODELS_DIR` to a directory containing `cbc_multiclass/`. All manifest and reload checks run at
startup. Missing artifacts return unavailable/503. Incompatible or corrupt artifacts stop
startup. No automatic fallback is trained, and the separate carrier model is gone.

Install the repository's requirements-test.txt in a virtual environment (TensorFlow 2.20.0 /
Keras 3.15.1; older Keras cannot load the bundles), then run
`python "Module 6 Domain API/app.py"` from the repository root. `HOST` (default 127.0.0.1; set
0.0.0.0 inside a container) and `PORT` (default 8000) choose the address; `INFERENCE_API_KEY`
requires an `X-API-Key` header on /infer and /normalize. For deployment use a WSGI server; the
Flask development server is for local checks.

- `POST /infer` accepts `model`, a `cbc` object, and either a per-feature `units` object or
  explicit `canonical_units: true`. CBC or unit keys outside the 10 features are rejected (400).
  The response adds `canonical_cbc` (what the model scored), `imputed_features` (median-filled),
  `risk_threshold`, `risk_rule` and `calibration`. Flask sorts JSON object keys; the class order
  is the `classes` array.
- `POST /normalize` runs the same unit conversion and range checks without scoring.
- `GET /contract` returns the ordered features, classes, canonical units and plausible ranges;
  the Node backend compares it with its exported copy at startup.
- `GET /models`, `GET /health`.

Missing RDW/NEUTp (or any feature) are median-imputed; unit conversion is never inferred from
magnitude. Scores are a screening aid requiring doctor confirmation. The unvalidated
thalassemia rule flags are disabled (`rule_flags` is always `{}`). A selected round 0 is labeled
centralized. `RISK_THRESHOLD` (default 0.30, leukemia score) is a configurable demo flag, not a
clinical decision threshold.

The Node side of Module 6 (routes, prediction service, inference client, alerting, OCR, symptom
parser) and its migration were moved into `Module 1-2 Merged Backend/src` and `init/010` on
`feat/integration`; this folder now holds only the Python service. Register measured metrics
with `node scripts/register-model.js` in the backend (it reads the final-test `*_metrics.json`);
the database seed invents no scores.
