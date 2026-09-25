"""Deterministic seeds and compact, serializable run provenance."""
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import random
import subprocess
import tempfile
import numpy as np

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "fedhealth-matplotlib"))


def seed_all(seed):
    os.environ.setdefault("TF_DETERMINISTIC_OPS", "1")
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    os.environ.setdefault("TF_NUM_INTRAOP_THREADS", "2")
    os.environ.setdefault("TF_NUM_INTEROP_THREADS", "2")
    random.seed(seed)
    np.random.seed(seed)
    import tensorflow as tf
    tf.keras.utils.set_random_seed(seed)
    tf.config.experimental.enable_op_determinism()


def environment():
    packages = {}
    for name in ["tensorflow", "keras", "xgboost", "scikit-learn", "numpy", "pandas", "flwr", "joblib", "scipy"]:
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    root = Path(__file__).resolve().parents[1]
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.SubprocessError):
        commit = "unavailable"
    # Source hashes also identify uncommitted verification runs.
    from .data import sha256
    source = {str(p.relative_to(root)): sha256(p, canonical=True) for folder in ["Module 3 ML", "Module 4 FL"] for p in (root / folder).glob("*.py")}
    return {"python": platform.python_version(), "platform": platform.platform(), "packages": packages, "git_commit": commit, "source_sha256": source}


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
