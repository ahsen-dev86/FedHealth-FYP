# Four-class model integration

Copy the selected complete hybrid `model/` directory to `models/cbc_multiclass/`.
It must contain ann.keras, xgb.json, preprocessor.joblib, meta.json, manifest.json
and reload_verified.json. Keep each bundle together; do not mix files from runs.
Use the separate final-test metrics payload to register that exact version.
There is one four-class model and no automatic inference fallback.

The full-stack docker-compose.yml here is a historical assembly template with
paths from the old generated layout. Full Module 9 assembly/deployment is separate
from the Module 3/4 migration. For a current standalone federation development
configuration use `Module 4 FL/compose.yml`, whose build context is the repo root.
Check `docs/VERIFICATION.md` for whether a Docker runtime was available and tested.
