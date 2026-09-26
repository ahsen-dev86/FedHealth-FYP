"""Verified, immutable four-class bundles. Hashes detect mismatched files."""
import json
import hashlib
from pathlib import Path
import shutil
import numpy as np
from . import schema
from .data import sha256
from .preprocess import CBCPreprocessor
from .runtime import write_json, environment


def validate_ann(ann):
    if ann.input_shape != (None, 10) or ann.output_shape != (None, 4):
        raise ValueError("ANN must have ten inputs and four outputs")
    expected = [(10, 64), (64,), (64, 32), (32,), (32, 4), (4,)]
    weights = ann.get_weights()
    if [x.shape for x in weights] != expected or not all(x.dtype == np.float32 and np.isfinite(x).all() for x in weights):
        raise ValueError("Wrong ANN tensor shapes, types or non-finite weights")
    if ann.get_layer("embedding").units != 32 or ann.get_layer("softmax").activation.__name__ != "softmax":
        raise ValueError("Wrong ANN embedding/output contract")
    if [layer.__class__.__name__ for layer in ann.layers] != ["InputLayer", "Dense", "Dropout", "Dense", "Dense"]:
        raise ValueError("Wrong ANN architecture")
    if ann.get_layer("dense_0").activation.__name__ != "relu" or ann.get_layer("embedding").activation.__name__ != "relu" or ann.get_layer("drop_0").rate != .3:
        raise ValueError("Wrong ANN hidden layers")


def inspect_bundle(path, *, data_sha256=None, _allow_unverified=False):
    path = Path(path)
    manifest = json.loads((path / "manifest.json").read_text())
    required = {"ann.keras", "preprocessor.joblib", "meta.json"}
    hashes = manifest.get("sha256", {})
    if not required <= set(hashes):
        raise ValueError("Incomplete artifact manifest")
    for name, digest in hashes.items():
        if Path(name).name != name or sha256(path / name) != digest:
            raise ValueError(f"Artifact checksum mismatch: {name}")
    meta = json.loads((path / "meta.json").read_text())
    if meta.get("schema_version") != schema.SCHEMA_VERSION or meta.get("features") != schema.FEATURES or meta.get("classes") != schema.CLASSES or meta.get("units") != schema.UNITS:
        raise ValueError("Artifact schema, feature/class order or units mismatch")
    if meta.get("data_sha256") != (data_sha256 or schema.CANONICAL_DATA_SHA256):
        raise ValueError("Artifact was trained on a different dataset")
    if meta.get("artifact_type") == "hybrid" and "xgb.json" not in hashes:
        raise ValueError("Missing local XGBoost head")
    for name in ["ann_temperature", "temperature"]:
        if not np.isfinite(meta.get(name, np.nan)) or not .05 <= meta[name] <= 10.:
            raise ValueError("Invalid calibration temperature")
    if not _allow_unverified:
        marker = json.loads((path / "reload_verified.json").read_text())
        if marker.get("passed") is not True or marker.get("manifest_sha256") != sha256(path / "manifest.json"):
            raise ValueError("Artifact reload verification is missing or stale")
    return meta, manifest


def load_bundle(path, *, data_sha256=None, _allow_unverified=False):
    import tensorflow as tf
    from xgboost import XGBClassifier
    from .models import HybridModel, TemperatureScaler
    path = Path(path)
    meta, _ = inspect_bundle(path, data_sha256=data_sha256, _allow_unverified=_allow_unverified)
    prep = CBCPreprocessor.load(path / "preprocessor.joblib")
    if prep.fit_rows != meta["preprocessor_fit_rows"]:
        raise ValueError("Preprocessor training count mismatch")
    ann = tf.keras.models.load_model(path / "ann.keras", compile=False)
    validate_ann(ann)
    xgb = None
    if meta["artifact_type"] == "hybrid":
        xgb = XGBClassifier()
        xgb.load_model(path / "xgb.json")
        if xgb.n_features_in_ != 42 or list(xgb.classes_) != list(range(4)):
            raise ValueError("Wrong XGBoost input/classes")
    temp = TemperatureScaler()
    temp.T = meta["temperature"]
    hybrid = HybridModel(ann, schema.CLASSES, xgb=xgb, temperature=temp, version=meta["version"])
    return prep, hybrid, meta


def save_bundle(path, prep, hybrid, *, run_info, ann_temperature, preprocessor_source=None):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=False)
    validate_ann(hybrid.ann)
    if preprocessor_source:
        shutil.copyfile(preprocessor_source, path / "preprocessor.joblib")
    else:
        prep.save(path / "preprocessor.joblib")
    hybrid.ann.save(path / "ann.keras")
    files = ["ann.keras", "preprocessor.joblib"]
    if hybrid.xgb is not None:
        hybrid.xgb.save_model(path / "xgb.json")
        files.append("xgb.json")
    identity = hashlib.sha256("".join(sha256(path / name) for name in files).encode()).hexdigest()[:12]
    meta = {**run_info, "schema_version": schema.SCHEMA_VERSION, "features": schema.FEATURES,
            "classes": schema.CLASSES, "units": schema.UNITS, "model_name": schema.MODEL_NAME,
            "version": f"{hybrid.version}-{identity}", "artifact_type": "hybrid" if hybrid.xgb is not None else "ann_only",
            "temperature": hybrid.temperature.T, "ann_temperature": float(ann_temperature),
            "preprocessor_fit_rows": prep.fit_rows, "environment": environment(),
            "intended_use": "Public-data screening prototype; doctor confirmation required"}
    write_json(path / "meta.json", meta)
    files.append("meta.json")
    write_json(path / "manifest.json", {"sha256": {name: sha256(path / name) for name in files}})
    restored_prep, restored, _ = load_bundle(path, data_sha256=run_info["data_sha256"], _allow_unverified=True)
    for before, after in zip(hybrid.ann.get_weights(), restored.ann.get_weights()):
        np.testing.assert_array_equal(before, after)
    for attr in ("mean_", "scale_", "var_", "n_samples_seen_"):
        np.testing.assert_array_equal(getattr(prep.scaler, attr), getattr(restored_prep.scaler, attr))
    np.testing.assert_array_equal(prep.imputer.statistics_, restored_prep.imputer.statistics_)
    probe = np.stack([np.zeros(10), np.ones(10), -np.ones(10)]).astype("float32")
    np.testing.assert_allclose(hybrid.ann(probe, training=False), restored.ann(probe, training=False), rtol=1e-6, atol=1e-7)
    if hybrid.xgb is not None:
        np.testing.assert_allclose(hybrid.predict_proba(probe), restored.predict_proba(probe), rtol=1e-6, atol=1e-7)
    write_json(path / "reload_verified.json", {"passed": True, "data_sha256": run_info["data_sha256"], "manifest_sha256": sha256(path / "manifest.json")})
    return path
