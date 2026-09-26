"""Verified four-class inference. Missing artifacts are explicitly unavailable."""
import math
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fedhealth_ml import schema
from fedhealth_ml.preprocess import normalize_units
from fedhealth_ml.artifacts import load_bundle

RISK_RULE = "leukemia score >= risk_threshold (configurable demo flag, not a clinical decision threshold)"


class UnavailablePredictor:
    mode, version = "unavailable", "untrained"
    def predict(self, cbc, units):
        raise RuntimeError("Train Module 3 and configure a verified four-class artifact bundle")


class HybridPredictor:
    def __init__(self, name, cfg):
        self.prep, self.hybrid, self.meta = load_bundle(cfg["artifact_dir"])
        if self.hybrid.xgb is None:
            raise ValueError("Serving the hybrid requires its matching local XGBoost head")
        self.name, self.version = name, self.meta["version"]
        self.mode = "federated_hybrid" if self.meta["origin"] == "federated_finetune" and self.meta.get("selected_round", 0) > 0 else "centralized_hybrid"
        self.threshold = float(os.environ.get("RISK_THRESHOLD", ".30"))
        if not 0 <= self.threshold <= 1:
            raise ValueError("RISK_THRESHOLD must be between zero and one")

    def predict(self, cbc, units):
        canonical = normalize_units(cbc, units=units)
        p = self.hybrid.predict_proba(self.prep.transform(canonical))[0]
        scores = {c: float(v) for c, v in zip(schema.CLASSES, p)}
        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        missing = [f for f in schema.FEATURES if math.isnan(canonical[f])]
        return {"model_name": self.name, "model_version": self.version, "mode": self.mode,
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
    path = Path(cfg["artifact_dir"])
    if not path.exists():
        return UnavailablePredictor()
    # An incomplete/corrupt artifact directory must not silently activate a fallback.
    return HybridPredictor(name, cfg)
