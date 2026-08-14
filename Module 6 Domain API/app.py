# ml/inference_service/app.py
# ---------------------------------------------------------------------------
# The Python inference microservice. The Node/Express backend calls this over
# HTTP to score CBC records — keeping all TensorFlow/XGBoost/model logic in
# Python while the API stays in Node. Serves calibrated confidence scores + the
# interpretable thalassemia-trait flag; never a categorical diagnosis.
#
# Model backends are chosen per model at startup (see predictors.build_predictor):
# the real federated artifacts if present, else a labelled sklearn fallback, else
# rules-only — so the whole stack is demoable before Colab training finishes.
#
# Run:  python ml/inference_service/app.py      (Flask dev server)
#       gunicorn -b 0.0.0.0:8000 app:app        (production, see Dockerfile)
# ---------------------------------------------------------------------------
import os
import sys
import time

from flask import Flask, request, jsonify

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from fedhealth_ml import schema  # noqa: E402
import predictors as P  # noqa: E402

MODELS_DIR = os.environ.get("MODELS_DIR", "/models")
ANEMIA_CSV = os.environ.get("ANEMIA_CSV", "../anemia_diagnosed_cbc_data_v4.csv")
THAL_CSV = os.environ.get("THAL_CSV", "")            # set once you have a beta-thal dataset
# Optional shared secret so only the backend can call this service.
INFERENCE_API_KEY = os.environ.get("INFERENCE_API_KEY", "")

MODEL_CONFIGS = {
    "cbc_multiclass": {
        "features": schema.MODEL_A_FEATURES,
        "classes": schema.MODEL_A_CLASSES,
        "high_risk": {"leukemia", "leukemia_with_thrombocytopenia"},
        "reference_csv": ANEMIA_CSV,
        "artifact_dir": os.path.join(MODELS_DIR, "cbc_multiclass"),
    },
    "thal_screen": {
        "features": schema.MODEL_B_FEATURES,
        "classes": schema.MODEL_B_CLASSES,
        "high_risk": {"beta_thal_trait"},
        "reference_csv": THAL_CSV,
        "artifact_dir": os.path.join(MODELS_DIR, "thal_screen"),
    },
}

app = Flask(__name__)

# Build one predictor per model at startup.
PREDICTORS = {}
for _name, _cfg in MODEL_CONFIGS.items():
    PREDICTORS[_name] = P.build_predictor(_name, _cfg)
    print(f"[inference] {_name}: backend={PREDICTORS[_name].mode} "
          f"version={PREDICTORS[_name].version}")


def _check_api_key():
    if INFERENCE_API_KEY and request.headers.get("X-API-Key") != INFERENCE_API_KEY:
        return False
    return True


@app.get("/health")
def health():
    return jsonify(ok=True, service="fedhealth-inference",
                   models={n: p.mode for n, p in PREDICTORS.items()})


@app.get("/models")
def models():
    """Report which backend + version is serving each model (transparency)."""
    return jsonify({
        n: {"mode": p.mode, "version": p.version,
            "classes": MODEL_CONFIGS[n]["classes"],
            "features": MODEL_CONFIGS[n]["features"]}
        for n, p in PREDICTORS.items()
    })


@app.post("/infer")
def infer():
    if not _check_api_key():
        return jsonify(error="unauthorized"), 401

    body = request.get_json(silent=True) or {}
    model = body.get("model", "cbc_multiclass")
    cbc = body.get("cbc")

    if model not in PREDICTORS:
        return jsonify(error=f"unknown model '{model}'"), 400
    if not isinstance(cbc, dict) or not cbc:
        return jsonify(error="'cbc' must be a non-empty object of CBC indices"), 400

    t0 = time.time()
    try:
        result = PREDICTORS[model].predict(cbc)
    except Exception as e:
        return jsonify(error=f"inference failed: {e}"), 500
    result["inference_ms"] = int((time.time() - t0) * 1000)
    return jsonify(result)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port)
