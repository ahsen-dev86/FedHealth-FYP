# fl/common/task.py
# ---------------------------------------------------------------------------
# Code shared by the FL server and every lab client, so they agree on the model
# architecture, the feature schema, and the weight (de)serialization format.
#
# KEY FL invariant — consistent normalization across labs:
# FedAvg only makes sense if every lab turns a raw CBC into the SAME feature
# vector. So all labs use ONE preprocessor (median-impute + scaler) fit on a
# shared reference set, distributed like agreed clinical reference ranges. It
# contains only summary statistics (medians/means/stds) — NOT patient data — so
# this does not break "raw data never leaves the lab". A fully federated
# normalization is a documented future enhancement.
# ---------------------------------------------------------------------------
import os
import sys

import numpy as np
import pandas as pd

# --- make fedhealth_ml importable (repo layout: fl/common -> ../../ml) -------
_ML = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ml"))
if _ML not in sys.path:
    sys.path.insert(0, _ML)
from fedhealth_ml import schema, preprocess as pp  # noqa: E402

# Model A ("cbc_multiclass") is what we federate in this module.
FEATURES = schema.MODEL_A_FEATURES
CLASSES = schema.MODEL_A_CLASSES
INPUT_DIM = len(FEATURES)
N_CLASSES = len(CLASSES)


# --- Shared preprocessor -----------------------------------------------------
def load_or_fit_preprocessor(reference_csv, cache_path):
    """Load the shared preprocessor if present, else fit it once on the
    reference dataset and cache it. In production this is the Module 3 artifact
    (preprocessor.joblib) shipped to labs; here we can derive it so the demo
    runs stand-alone."""
    if os.path.exists(cache_path):
        return pp.CBCPreprocessor.load(cache_path)
    X, _ = pp.load_anemia(reference_csv)
    prep = pp.CBCPreprocessor(FEATURES).fit(X)
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    prep.save(cache_path)
    return prep


# --- Per-lab data ------------------------------------------------------------
def load_partition_data(shard_csv, preprocessor, test_frac=0.2, seed=42):
    """Load one lab's shard -> scaled/encoded (X_train, y_train, X_test, y_test).
    Pure pandas/sklearn (no TensorFlow), so it can be unit-tested independently."""
    df = pd.read_csv(shard_csv)
    X = pp.clean_ranges(df, FEATURES)
    y = df["Diagnosis"].map(schema.ANEMIA_LABEL_MAP)

    # Local, stratified holdout so each lab can evaluate the global model.
    from sklearn.model_selection import train_test_split
    # Guard: tiny/degenerate classes can't be stratified — fall back gracefully.
    try:
        Xtr, Xte, ytr, yte = train_test_split(
            X, y, test_size=test_frac, stratify=y, random_state=seed)
    except ValueError:
        Xtr, Xte, ytr, yte = train_test_split(
            X, y, test_size=test_frac, random_state=seed)

    Xtr = preprocessor.transform(Xtr)
    Xte = preprocessor.transform(Xte)
    ytr = pp.encode_labels(ytr, CLASSES)
    yte = pp.encode_labels(yte, CLASSES)
    return Xtr, ytr, Xte, yte


# --- Model (TensorFlow) ------------------------------------------------------
def get_model():
    """Build the federated ANN (same architecture on server + every client)."""
    from fedhealth_ml import models
    return models.build_ann(input_dim=INPUT_DIM, n_classes=N_CLASSES,
                            hidden=(64, 32), dropout=0.3)


def get_weights(model):
    """ANN weights as a list of numpy arrays — the federated parameters."""
    return model.get_weights()


def set_weights(model, weights):
    model.set_weights(weights)


# --- Flower <-> numpy bridge (kept here so Module 5 can wrap it) -------------
def ndarrays_to_parameters(ndarrays):
    from flwr.common import ndarrays_to_parameters as _f
    return _f(ndarrays)


def parameters_to_ndarrays(parameters):
    from flwr.common import parameters_to_ndarrays as _f
    return _f(parameters)


# --- Metrics used by clients + the strategy ---------------------------------
def local_metrics(y_true, y_pred):
    """Balanced metrics so a lab with a skewed shard still reports honestly."""
    from sklearn.metrics import accuracy_score, f1_score, balanced_accuracy_score
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
    }
