"""Four-class screening API; CBC units are part of the request contract."""
import os
import sys
import time
from pathlib import Path
from flask import Flask, request, jsonify
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fedhealth_ml import schema
import predictors as P

MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/models"))
INFERENCE_API_KEY = os.environ.get("INFERENCE_API_KEY", "")
MODEL_CONFIGS = {schema.MODEL_NAME: {"features": schema.FEATURES, "classes": schema.CLASSES,
                "artifact_dir": MODELS_DIR / schema.MODEL_NAME}}
PREDICTORS = {n: P.build_predictor(n, c) for n, c in MODEL_CONFIGS.items()}
app = Flask(__name__)


@app.get("/health")
def health():
    ready = all(p.mode != "unavailable" for p in PREDICTORS.values())
    return jsonify(ok=ready, service="fedhealth-inference", models={n: p.mode for n, p in PREDICTORS.items()}), 200 if ready else 503


@app.get("/models")
def models():
    return jsonify({n: {"mode": p.mode, "version": p.version, "classes": schema.CLASSES,
                       "features": schema.FEATURES, "canonical_units": schema.UNITS} for n, p in PREDICTORS.items()})


@app.post("/infer")
def infer():
    if INFERENCE_API_KEY and request.headers.get("X-API-Key") != INFERENCE_API_KEY:
        return jsonify(error="unauthorized"), 401
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error="JSON object required"), 400
    name = body.get("model", schema.MODEL_NAME)
    if name not in PREDICTORS:
        return jsonify(error="unknown model"), 400
    cbc, units = body.get("cbc"), body.get("units")
    if body.get("canonical_units") is True and units is None:
        units = schema.UNITS
    if not isinstance(cbc, dict) or not cbc or not isinstance(units, dict):
        return jsonify(error="Provide CBC values and declared units, or canonical_units: true"), 400
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
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
