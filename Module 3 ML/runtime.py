"""Deterministic seeds and compact, serializable run provenance.

Shared helpers used by every training/evaluation entry point: seed_all() makes
a run reproducible (Python/NumPy/TensorFlow RNGs + deterministic TF ops), and
environment()/write_json() record exactly what produced a given artifact
(package versions, git commit, source-file hashes) alongside its outputs.
"""
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import random
import subprocess
import tempfile
import numpy as np

# Route Matplotlib's cache/config dir into the OS temp dir so Colab/CI runs
# without a writable home directory don't fail on import.
os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "fedhealth-matplotlib"))


def seed_all(seed):
    """Seed every RNG (Python, NumPy, TensorFlow/Keras) and force deterministic
    TensorFlow ops, so a training run with the same seed reproduces the same
    weights/metrics. Must be called before building/training any model."""
    os.environ.setdefault("TF_DETERMINISTIC_OPS", "1")
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")  # quiet TF's INFO/WARNING log spam
    os.environ.setdefault("TF_NUM_INTRAOP_THREADS", "2")  # small fixed thread pool keeps CPU timing/order reproducible
    os.environ.setdefault("TF_NUM_INTEROP_THREADS", "2")
    random.seed(seed)
    np.random.seed(seed)
    import tensorflow as tf
    tf.keras.utils.set_random_seed(seed)
    tf.config.experimental.enable_op_determinism()


def environment():
    """Snapshot of the run's provenance: installed package versions, Python/OS
    info, the current git commit, and a hash of every Module 3/4 source file —
    so any saved artifact can later be traced back to the exact code that made it."""
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
    """Write a value as pretty-printed, trailing-newline-terminated JSON.
    `allow_nan=False` makes a NaN/Infinity in a metric fail loudly instead of
    silently writing invalid JSON."""
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
