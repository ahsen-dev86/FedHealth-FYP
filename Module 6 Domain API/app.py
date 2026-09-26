"""Four-class screening API; CBC units are part of the request contract."""
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
from flask import Flask, request, jsonify
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
PREDICTORS = {n: P.build_predictor(n, c) for n, c in MODEL_CONFIGS.items()}
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
    return INFERENCE_API_KEY and request.headers.get("X-API-Key") != INFERENCE_API_KEY


def _is_number(value):
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
    return None if value is None or (isinstance(value, float) and math.isnan(value)) else float(value)


@app.get("/health")
def health():
    ready = all(p.mode != "unavailable" for p in PREDICTORS.values())
    return jsonify(ok=ready, service="fedhealth-inference", models={n: p.mode for n, p in PREDICTORS.items()}), 200 if ready else 503


@app.get("/models")
def models():
    return jsonify({n: {"mode": p.mode, "version": p.version, "classes": schema.CLASSES,
                       "features": schema.FEATURES, "canonical_units": schema.UNITS} for n, p in PREDICTORS.items()})


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
    if PREDICTORS[name].mode == "unavailable":
        return jsonify(error="verified trained artifacts unavailable"), 503
    start = time.perf_counter()
    try:
        result = PREDICTORS[name].predict(cbc, units)
    except (ValueError, TypeError) as exc:
        return jsonify(error=str(exc)), 400
    result["inference_ms"] = int((time.perf_counter() - start) * 1000)
    return jsonify(result)


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))
