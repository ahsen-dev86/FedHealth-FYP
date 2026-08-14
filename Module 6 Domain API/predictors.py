# ml/inference_service/predictors.py
# ---------------------------------------------------------------------------
# Prediction backends for the inference service. Three tiers, chosen per model
# at startup so the API is runnable BEFORE Colab training finishes:
#
#   * HybridPredictor  — loads the real Module 3 artifacts (preprocessor + the
#                        federated ANN + XGBoost head + calibration). This is the
#                        production path. Needs TensorFlow + XGBoost.
#   * FallbackPredictor— a sklearn LogisticRegression fit on the reference CSV.
#                        Lets the whole stack demo end-to-end without the trained
#                        artifacts. Clearly labelled mode='fallback' so it's never
#                        mistaken for the federated model.
#   * RulesOnlyPredictor— no ML scores (e.g. thal_screen before a dataset exists);
#                        still returns the interpretable rule flag.
#
# EVERY backend also returns the rule-based thalassemia-trait flag (fedhealth_ml
# .rules), which is model-independent and therefore always real.
# ---------------------------------------------------------------------------
import os
import sys
import time

import numpy as np

_ML = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ML not in sys.path:
    sys.path.insert(0, _ML)
from fedhealth_ml import schema, preprocess as pp, rules  # noqa: E402

# A high-risk condition crossing this summed confidence raises risk_flag
# (feeds the NIH alerting pipeline).
RISK_THRESHOLD = float(os.environ.get("RISK_THRESHOLD", "0.30"))


def _ranked(scores):
    return sorted(scores.items(), key=lambda kv: -kv[1])


def _risk(scores, high_risk_keys, rule_flag):
    """risk_flag = high-risk conditions cross the threshold OR the rule flag
    fires. Kept explicit so it's auditable."""
    hr = sum(scores.get(k, 0.0) for k in high_risk_keys) if scores else 0.0
    return bool(hr >= RISK_THRESHOLD or (rule_flag and rule_flag.get("flag")))


class _Base:
    def __init__(self, name, cfg):
        self.name = name
        self.cfg = cfg
        self.high_risk = set(cfg.get("high_risk", []))
        self.version = "unknown"
        self.mode = "base"

    def _normalize(self, cbc):
        """Rescale real-world report units (e.g. WBC 9,010 /mm³ -> 9.01 10³/µL)
        into the model's training scale before scoring OR rule evaluation."""
        return pp.normalize_units(dict(cbc), self.cfg.get("features"))

    def _wrap(self, cbc, scores):
        """Common response envelope shared by all backends."""
        rule_flag = rules.thalassemia_trait_flag(cbc)  # always real
        ranked = _ranked(scores) if scores else []
        top_c, top_p = (ranked[0] if ranked else (None, None))
        return {
            "model_name": self.name,
            "model_version": self.version,
            "mode": self.mode,
            "scores": {k: round(float(v), 4) for k, v in scores.items()} if scores else None,
            "ranked": [[k, round(float(v), 4)] for k, v in ranked],
            "top_condition": top_c,
            "top_confidence": round(float(top_p), 4) if top_p is not None else None,
            "risk_flag": _risk(scores, self.high_risk, rule_flag),
            "rule_flags": {"thalassemia_trait": rule_flag},
        }


class HybridPredictor(_Base):
    """The real federated model: preprocessor + ANN->XGBoost + calibration."""

    def __init__(self, name, cfg):
        super().__init__(name, cfg)
        from fedhealth_ml import models  # imports TF/XGB lazily
        adir = cfg["artifact_dir"]
        self.prep = pp.CBCPreprocessor.load(os.path.join(adir, "preprocessor.joblib"))
        self.hybrid = models.HybridModel.load(adir)
        self.version = self.hybrid.version
        self.mode = "federated_hybrid"

    def predict(self, cbc):
        cbc = self._normalize(cbc)                    # rescale report units first
        X = self.prep.transform(dict(cbc))            # 1-row scaled matrix
        scores = self.hybrid.predict_scores(X)[0]     # {class: confidence}
        return self._wrap(cbc, scores)


class FallbackPredictor(_Base):
    """sklearn LogisticRegression fit on the reference CSV. Demo-only stand-in."""

    def __init__(self, name, cfg):
        super().__init__(name, cfg)
        from sklearn.pipeline import make_pipeline
        from sklearn.impute import SimpleImputer
        from sklearn.preprocessing import StandardScaler
        from sklearn.linear_model import LogisticRegression

        self.features = cfg["features"]
        X, y = pp.load_anemia(cfg["reference_csv"])   # Model A reference
        self.classes = [c for c in schema.MODEL_A_CLASSES if c in set(y)]
        self.pipe = make_pipeline(
            SimpleImputer(strategy="median"), StandardScaler(),
            LogisticRegression(max_iter=2000, class_weight="balanced"))
        self.pipe.fit(X, y)
        self.version = "fallback-sklearn"
        self.mode = "fallback"

    def predict(self, cbc):
        import pandas as pd
        cbc = self._normalize(cbc)                    # rescale report units first
        row = pd.DataFrame([{f: cbc.get(f, np.nan) for f in self.features}])
        proba = self.pipe.predict_proba(row)[0]
        scores = {c: float(p) for c, p in zip(self.pipe.classes_, proba)}
        return self._wrap(cbc, scores)


class RulesOnlyPredictor(_Base):
    """No trained model available -> return the interpretable rule flag only."""

    def __init__(self, name, cfg):
        super().__init__(name, cfg)
        self.version = "rules-only"
        self.mode = "rules_only"

    def predict(self, cbc):
        return self._wrap(self._normalize(cbc), None)


def build_predictor(name, cfg):
    """Pick the best available backend for a model, most-capable first."""
    adir = cfg.get("artifact_dir")
    if adir and os.path.exists(os.path.join(adir, "meta.json")):
        try:
            return HybridPredictor(name, cfg)
        except Exception as e:  # TF/XGB missing or artifacts incompatible
            print(f"[inference] {name}: hybrid load failed ({e}); trying fallback")
    ref = cfg.get("reference_csv")
    if ref and os.path.exists(ref) and name == "cbc_multiclass":
        try:
            return FallbackPredictor(name, cfg)
        except Exception as e:
            print(f"[inference] {name}: fallback failed ({e}); rules-only")
    return RulesOnlyPredictor(name, cfg)
