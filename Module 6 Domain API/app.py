"""Four-class screening API; CBC units are part of the request contract."""
# Module 6 Domain API — Flask service that wraps the trained ANN (Module 3) and
# exposes it over HTTP as /infer, /normalize, /contract, /models, /health. The
# Node/Express backend (Module 1-2) calls this service rather than loading the
# model itself, so the ML runtime stays isolated from the web/auth stack.
import math
import os
import sys
import time
from pathlib import Path
# Pin TensorFlow's oneDNN kernels off before TF loads so single predictions are
# bit-for-bit reproducible whoever launches the service (as in tests/conftest.py).
# Both settings reproduce the recorded validation results (421/480, log loss
# 0.35894); oneDNN's different float rounding only moves rare borderline cases.
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
from flask import Flask, request, jsonify  # Flask: lightweight Python web framework used for this HTTP microservice
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fedhealth_ml import schema
from fedhealth_ml.preprocess import normalize_units
import predictors as P

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))
# FEDHEALTH_MODEL_DIR points straight at one verified bundle (e.g. .../seed42/centralized/model),
# so the trained files do not have to be copied into <MODELS_DIR>/cbc_multiclass.
MODEL_DIR = Path(os.environ["FEDHEALTH_MODEL_DIR"]) if os.environ.get("FEDHEALTH_MODEL_DIR") else MODELS_DIR / schema.MODEL_NAME
INFERENCE_API_KEY = os.environ.get("INFERENCE_API_KEY", "")
MODEL_CONFIGS = {schema.MODEL_NAME: {"features": schema.FEATURES, "classes": schema.CLASSES,
                "artifact_dir": MODEL_DIR}}
# --- Fallback model (no single point of failure) -----------------------------
# FEDHEALTH_BACKUP_MODEL_DIR names a second verified bundle (an independently
# trained model for the same contract, e.g. another seed). It serves when the
# primary bundle cannot be loaded or raises while scoring. Every response says
# which one answered (`served_by`), so a backup result is never mistaken for a
# primary one. A whole second process started with FEDHEALTH_REPLICA_ROLE=backup
# covers the case where this process dies; the Node backend fails over to it.
BACKUP_DIR = Path(os.environ["FEDHEALTH_BACKUP_MODEL_DIR"]) if os.environ.get("FEDHEALTH_BACKUP_MODEL_DIR") else None
REPLICA_ROLE = "backup" if os.environ.get("FEDHEALTH_REPLICA_ROLE", "primary").lower() == "backup" else "primary"
DRILL = {"primary_down": False}  # failover drill switch (POST /drill); never set by a prediction request


def _load_primary(name, cfg):
    """The primary predictor. Without a backup a broken bundle stops the service (fail loudly);
    with one, the failure is recorded and the backup serves."""
    if BACKUP_DIR is None:
        return P.build_predictor(name, cfg)
    try:
        return P.build_predictor(name, cfg)
    except Exception as exc:  # corrupt or mismatched primary bundle
        print(f"[inference] primary bundle for {name} failed to load: {exc!r}; backup will serve", file=sys.stderr)
        return P.UnavailablePredictor(f"primary bundle failed to load: {type(exc).__name__}")


def _load_backup(name, cfg):
    """The backup predictor, or None when no backup bundle is configured."""
    if BACKUP_DIR is None:
        return None
    try:
        return P.build_predictor(name, {**cfg, "artifact_dir": BACKUP_DIR})
    except Exception as exc:
        print(f"[inference] backup bundle for {name} failed to load: {exc!r}", file=sys.stderr)
        return P.UnavailablePredictor(f"backup bundle failed to load: {type(exc).__name__}")


PREDICTORS = {n: _load_primary(n, c) for n, c in MODEL_CONFIGS.items()}
BACKUPS = {n: _load_backup(n, c) for n, c in MODEL_CONFIGS.items()}


def _usable(predictor):
    return predictor is not None and predictor.mode != "unavailable"


def _serving(name):
    """Which predictor answers right now: 'primary', 'backup' or 'none'."""
    if _usable(PREDICTORS[name]) and not DRILL["primary_down"]:
        return "primary"
    return "backup" if _usable(BACKUPS.get(name)) else "none"


def _failover_status(name):
    """Primary/backup state for one model (no file paths)."""
    primary, backup = PREDICTORS[name], BACKUPS.get(name)
    return {"serving": _serving(name), "drill_active": DRILL["primary_down"],
            "primary": {"mode": primary.mode, "version": primary.version,
                        "reason": getattr(primary, "reason", None) if primary.mode == "unavailable" else None},
            "backup": None if backup is None else {
                "mode": backup.mode, "version": backup.version,
                "reason": getattr(backup, "reason", None) if backup.mode == "unavailable" else None}}


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024  # a CBC request is < 1 KB; refuse floods with 413


@app.errorhandler(404)
@app.errorhandler(405)
@app.errorhandler(413)
def _http_error(err):
    return jsonify(error=err.description if err.code != 413 else "Request body is too large"), err.code


@app.errorhandler(Exception)
def _unexpected(err):
    # JSON, not Flask's HTML page, and no internals in the response body.
    app.logger.exception("unexpected inference error")
    code = getattr(err, "code", 500)
    return jsonify(error="Internal error in the inference service" if code >= 500 else str(err)), code


def _unauthorized():
    """True if an API key is configured and the request's X-API-Key header doesn't match."""
    return INFERENCE_API_KEY and request.headers.get("X-API-Key") != INFERENCE_API_KEY


def _is_number(value):
    """Strict numeric check for CBC values: real int/float, no bool (bool is an int subclass), must be finite."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _cbc_and_units(body):
    """Validate the request shape shared by /infer and /normalize; return (cbc, units) or an error string.

    Same rules as the Node API: values are JSON numbers (null = not measured; no numeric
    strings, booleans, lists or objects) and units are non-empty strings."""
    cbc, units = body.get("cbc"), body.get("units")
    if body.get("canonical_units") is True and units is None:
        units = schema.UNITS
    if not isinstance(cbc, dict) or not cbc or not isinstance(units, dict):
        return None, None, "Provide CBC values and declared units, or canonical_units: true"
    unknown = sorted(set(cbc) - set(schema.FEATURES))
    if unknown:
        return None, None, f"Unknown CBC field(s): {', '.join(unknown)}; the model uses only {', '.join(schema.FEATURES)}"
    unknown = sorted(set(units) - set(schema.FEATURES))
    if unknown:
        return None, None, f"Units given for unknown field(s): {', '.join(unknown)}"
    for feature, value in cbc.items():
        if value is not None and not _is_number(value):
            return None, None, f"{feature} must be a finite number"
    for feature, unit in units.items():
        if not isinstance(unit, str) or not unit.strip() or len(unit) > 32:
            return None, None, f"Unit for {feature} must be a short text such as {schema.UNITS[feature]!r}"
    return cbc, units, None


def _json_number(value):
    """Coerce a value to a plain JSON-safe float, or None for missing/NaN (JSON has no NaN)."""
    return None if value is None or (isinstance(value, float) and math.isnan(value)) else float(value)


@app.get("/health")
def health():
    """Liveness/readiness probe: ok only if every configured predictor has usable model artifacts loaded."""
    ready = all(_serving(n) != "none" for n in PREDICTORS)
    return jsonify(ok=ready, service="fedhealth-inference", replica_role=REPLICA_ROLE,
                   models={n: p.mode for n, p in PREDICTORS.items()},
                   failover={n: _failover_status(n) for n in PREDICTORS}), 200 if ready else 503


@app.post("/drill")
def drill():
    """Failover drill: mark the primary model as down (or restore it) so the backup path can be
    exercised on purpose. Needs the service API key; refused when no backup is loaded."""
    if not INFERENCE_API_KEY or request.headers.get("X-API-Key") != INFERENCE_API_KEY:
        return jsonify(error="unauthorized"), 401
    body = request.get_json(silent=True) or {}
    if not isinstance(body.get("primary_down"), bool):
        return jsonify(error="primary_down must be true or false"), 400
    if body["primary_down"] and not any(_usable(b) for b in BACKUPS.values()):
        return jsonify(error="no backup model is loaded; drill refused"), 409
    DRILL["primary_down"] = body["primary_down"]
    return jsonify(drill_active=DRILL["primary_down"], failover={n: _failover_status(n) for n in PREDICTORS})


@app.get("/models")
def models():
    """List configured models with their load mode/version and the feature/unit contract."""
    return jsonify({n: {"mode": p.mode, "version": p.version, "classes": schema.CLASSES,
                       "features": schema.FEATURES, "canonical_units": schema.UNITS,
                       "replica_role": REPLICA_ROLE, "failover": _failover_status(n)} for n, p in PREDICTORS.items()})


@app.get("/contract")
def contract():
    """The ordered model contract; the Node backend compares its exported copy against this at startup."""
    return jsonify(schema_version=schema.SCHEMA_VERSION, model_name=schema.MODEL_NAME,
                   features=schema.FEATURES, classes=schema.CLASSES, canonical_units=schema.UNITS,
                   plausible_ranges={f: list(r) for f, r in schema.PLAUSIBLE_RANGES.items()})


@app.post("/normalize")
def normalize():
    """Unit conversion and range check only (no model call); same rules as /infer."""
    if _unauthorized():
        return jsonify(error="unauthorized"), 401
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error="JSON object required"), 400
    cbc, units, error = _cbc_and_units(body)
    if error:
        return jsonify(error=error), 400
    try:
        canonical = normalize_units(cbc, units=units)
    except (ValueError, TypeError) as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(canonical_cbc={f: _json_number(v) for f, v in canonical.items()},
                   canonical_units=schema.UNITS,
                   missing_features=[f for f, v in canonical.items() if _json_number(v) is None])


@app.post("/infer")
def infer():
    """Run the four-class CBC screening model: validate input, normalize units, predict, time it."""
    if _unauthorized():
        return jsonify(error="unauthorized"), 401
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error="JSON object required"), 400
    name = body.get("model", schema.MODEL_NAME)
    if name not in PREDICTORS:
        return jsonify(error="unknown model"), 400
    cbc, units, error = _cbc_and_units(body)
    if error:
        return jsonify(error=error), 400
    explain = body.get("explain") is True
    serving = _serving(name)
    if serving == "none":
        return jsonify(error="verified trained artifacts unavailable"), 503
    start = time.perf_counter()
    failover_reason = None
    if serving == "backup":
        failover_reason = ("failover drill: primary marked down" if DRILL["primary_down"] and _usable(PREDICTORS[name])
                           else getattr(PREDICTORS[name], "reason", "primary model unavailable"))
    try:
        if serving == "primary":
            try:
                result = PREDICTORS[name].predict(cbc, units, explain)
            except (ValueError, TypeError):
                raise  # the caller's input: the backup would reject it too
            except Exception as exc:
                # The primary broke while scoring. Use the backup if there is one.
                app.logger.exception("primary model failed while scoring")
                if not _usable(BACKUPS.get(name)):
                    raise
                serving, failover_reason = "backup", f"primary model error: {type(exc).__name__}"
                result = BACKUPS[name].predict(cbc, units, explain)
        else:
            result = BACKUPS[name].predict(cbc, units, explain)
    except (ValueError, TypeError) as exc:
        return jsonify(error=str(exc)), 400
    result["inference_ms"] = int((time.perf_counter() - start) * 1000)
    # A whole replica started as the backup reports 'backup' even though it is that process's only model.
    result["served_by"] = "backup" if serving == "backup" or REPLICA_ROLE == "backup" else "primary"
    result["failover_reason"] = failover_reason
    return jsonify(result)


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))
