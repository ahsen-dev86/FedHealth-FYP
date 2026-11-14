"""Verified four-class inference. Missing artifacts are explicitly unavailable."""
# Loads the trained preprocessor + hybrid (ANN+XGBoost) model bundle produced by
# Module 3/4 and wraps it as the object app.py calls per request. If no verified
# bundle is present, build_predictor() returns a stub that always fails loudly
# instead of silently serving an untrained/placeholder model.
import math
import os
import time
from pathlib import Path
import sys
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fedhealth_ml import schema
from fedhealth_ml.preprocess import normalize_units
from fedhealth_ml.artifacts import load_bundle

# Demo risk-flagging rule surfaced in every response so callers know it is a
# configurable screening cutoff, not a clinically validated diagnostic threshold.
RISK_RULE = "leukemia score >= risk_threshold (configurable demo flag, not a clinical decision threshold)"


EXPLANATION_METHOD = "exact_shapley_median_baseline"
EXPLANATION_NOTE = ("Exact Shapley values over the measured CBC values. Each value's contribution is the change "
                    "in the model's calibrated score when that value replaces the training median, averaged over "
                    "every combination of the other values. Contributions add up to the score minus the score of "
                    "a reference record at the training medians. They describe this model, not disease biology.")


class UnavailablePredictor:
    """Placeholder used when no verified model artifacts are found; always raises on predict()."""
    mode, version = "unavailable", "untrained"
    def __init__(self, reason="no verified artifact bundle configured"):
        self.reason = reason
    def predict(self, cbc, units, explain=False):
        raise RuntimeError("Train Module 3 and configure a verified four-class artifact bundle")


class HybridPredictor:
    """Serves the trained ANN+XGBoost hybrid model for the four-class CBC screen."""
    def __init__(self, name, cfg):
        self.prep, self.hybrid, self.meta = load_bundle(cfg["artifact_dir"])
        if self.hybrid.xgb is None:
            raise ValueError("Serving the hybrid requires its matching local XGBoost head")
        self.name, self.version = name, self.meta["version"]
        self.mode = "federated_hybrid" if self.meta["origin"] == "federated_finetune" and self.meta.get("selected_round", 0) > 0 else "centralized_hybrid"
        self.threshold = float(os.environ.get("RISK_THRESHOLD", ".30"))
        if not 0 <= self.threshold <= 1:
            raise ValueError("RISK_THRESHOLD must be between zero and one")

    def explain(self, canonical, scaled):
        """Exact Shapley attribution of each class score to the measured CBC values.

        The reference ("absent") value of a feature is its training median, which is
        also what the fitted preprocessor imputes for an unmeasured value. With k
        measured values the model is evaluated on all 2^k present/absent
        combinations (k <= 10, so at most 1024 rows in one batch); unmeasured
        values sit at the median in every row and get a contribution of zero."""
        start = time.perf_counter()
        features = schema.FEATURES
        present = [i for i, f in enumerate(features) if not math.isnan(canonical[f])]
        k = len(present)
        baseline = self.prep.transform({f: float("nan") for f in features})[0]
        masks = np.arange(1 << k)
        rows = np.repeat(baseline[None, :], len(masks), axis=0)
        for bit, column in enumerate(present):
            rows[(masks >> bit) & 1 == 1, column] = scaled[column]
        proba = self.hybrid.predict_proba(rows)
        sizes = np.array([bin(m).count("1") for m in masks])
        fact = [math.factorial(n) for n in range(k + 1)]
        phi = np.zeros((len(features), len(schema.CLASSES)))
        for bit, column in enumerate(present):
            without = masks[(masks >> bit) & 1 == 0]
            weights = np.array([fact[s] * fact[k - s - 1] / fact[k] for s in sizes[without]])
            phi[column] = (weights[:, None] * (proba[without | (1 << bit)] - proba[without])).sum(axis=0)
        medians = [float(v) for v in self.prep.imputer.statistics_]
        return {
            "method": EXPLANATION_METHOD,
            "note": EXPLANATION_NOTE,
            "baseline_scores": {c: float(v) for c, v in zip(schema.CLASSES, proba[0])},
            "reference_values": dict(zip(features, medians)),
            "contributions": {c: {f: float(phi[i, j]) for i, f in enumerate(features)}
                              for j, c in enumerate(schema.CLASSES)},
            "measured_features": [features[i] for i in present],
            "model_evaluations": int(len(masks)),
            "ms": int((time.perf_counter() - start) * 1000),
        }

    def predict(self, cbc, units, explain=False):
        """Normalize raw CBC values to canonical units, run the model, and shape the full response payload."""
        canonical = normalize_units(cbc, units=units)
        scaled = self.prep.transform(canonical)
        p = self.hybrid.predict_proba(scaled)[0]
        explanation = None
        if explain:
            try:
                explanation = self.explain(canonical, scaled[0])
            except Exception as exc:  # an explanation must never cost the clinician the scores
                explanation = {"method": EXPLANATION_METHOD, "error": f"explanation unavailable: {type(exc).__name__}"}
        scores = {c: float(v) for c, v in zip(schema.CLASSES, p)}
        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        missing = [f for f in schema.FEATURES if math.isnan(canonical[f])]
        return {"model_name": self.name, "model_version": self.version, "mode": self.mode,
                "explanation": explanation,
                "classes": schema.CLASSES, "features": schema.FEATURES,
                "scores": scores, "ranked": ranked, "top_condition": ranked[0][0],
                "top_confidence": ranked[0][1], "risk_flag": scores["leukemia"] >= self.threshold,
                "risk_threshold": self.threshold, "risk_rule": RISK_RULE,
                # Values the model actually scored, in canonical units; missing ones were
                # filled with training medians by the fitted preprocessor.
                "canonical_cbc": {f: (None if math.isnan(v) else v) for f, v in canonical.items()},
                "canonical_units": schema.UNITS, "imputed_features": missing,
                "calibration": {"method": "temperature_scaling", "temperature": self.meta["temperature"]},
                "rule_flags": {}, "screening_only": True, "requires_doctor_confirmation": True,
                "data_sha256": self.meta["data_sha256"], "selected_round": self.meta.get("selected_round"),
                "reference_head": self.meta.get("reference_head", "centralized reference XGBoost")}


def build_predictor(name, cfg):
    """Factory: load the real predictor if its artifact directory exists, else return the unavailable stub."""
    path = Path(cfg["artifact_dir"])
    if not path.exists():
        return UnavailablePredictor()
    # An incomplete/corrupt artifact directory must not silently activate a fallback.
    return HybridPredictor(name, cfg)
