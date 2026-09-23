"""Read experiment inputs without opening the locked test file."""
import hashlib
import importlib.metadata
import json
import platform
from pathlib import Path

import numpy as np

from fedhealth_ml import preprocess as pp, schema


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_split_manifest(split_dir):
    split_dir = Path(split_dir).resolve()
    manifest = json.loads((split_dir / "split_manifest.json").read_text(
        encoding="utf-8"))
    if manifest.get("purpose") not in {
        "module4_duplicate_aware_split",
        "module4_saved_module3_ann_finetune_split",
    }:
        raise ValueError("Not a Module 4 split manifest")
    for name, info in manifest["files"].items():
        if name == "locked_test":
            continue  # not opened by training or validation code
        path = split_dir / info["path"]
        if sha256_file(path) != info["sha256"]:
            raise ValueError(f"Split checksum mismatch: {name}")
    return manifest


def load_arrays(path, preprocessor):
    X, y = pp.load_anemia(path)
    if list(preprocessor.features) != list(schema.MODEL_A_FEATURES):
        raise ValueError("Preprocessor feature order differs from Model A")
    encoded = pp.encode_labels(y, schema.MODEL_A_CLASSES)
    if len(X) == 0 or (encoded < 0).any():
        raise ValueError("Empty split or unknown class")
    transformed = preprocessor.transform(X)
    if not np.isfinite(transformed).all():
        raise ValueError("Preprocessor produced non-finite features")
    return transformed, encoded


def package_versions():
    result = {"python": platform.python_version()}
    for package in ("numpy", "pandas", "scikit-learn", "tensorflow",
                    "flwr", "ray", "xgboost", "joblib"):
        try:
            result[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            result[package] = None
    return result
