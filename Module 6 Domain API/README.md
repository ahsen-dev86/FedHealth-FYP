# Four-class screening inference

The active model is `cbc_multiclass`, with ordered healthy/anemia/thalassemia/leukemia
scores. Set MODELS_DIR to a directory containing `cbc_multiclass/` copied from the
selected complete hybrid bundle. All manifest and reload checks run at startup.
Missing artifacts return unavailable/503. Incompatible or corrupt artifacts stop
startup. No automatic fallback is trained, and the separate carrier model is gone.

Install the repository's requirements-test.txt for local verification, then run
`python "Module 6 Domain API/app.py"` from the repository root. For deployment use
a suitable WSGI server; the Flask development server is for local checks.

POST /infer accepts `model`, a `cbc` object, and either a per-feature `units` object
or explicit `canonical_units: true`. Canonical features/units are exposed at
GET /models. Invalid reports return 400. Missing RDW/NEUTp can be median-imputed;
unit conversion is never inferred from magnitude. The Node inference client declares
canonical units for stored canonical reports, or forwards supplied report units.
OCR/manual ingestion must verify units before storing canonical values.

Scores are a screening aid requiring doctor confirmation. The unvalidated
thalassemia rule flags are disabled. A selected round 0 is labeled centralized.
The risk threshold is a configurable demo flag, not a clinical decision threshold.

The prediction service checks the served version and class list before choosing
a registry row. Register final measured metrics using the generated final-test
`*_metrics.json` payloads; the seed does not invent scores. Apply the accompanying
Module 1 migration to deactivate old model contracts without deleting history.
Full Node/database/UI deployment is outside the Module 3/4 verification boundary.
