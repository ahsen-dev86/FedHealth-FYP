"""Shared four-class model and strict lab data preparation.

Small utility layer used by both client.py and lims_wrapper.py: rebuilds the
Module 3 ANN architecture (or a client-supplied JSON copy of it) with a fresh
optimizer, and turns a lab's raw dataframe into unit-normalized, encoded
training data using the strict rules from fedhealth_ml.preprocess.
"""
import json
import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix
from fedhealth_ml import schema, models
from fedhealth_ml.preprocess import normalize_units, encode_labels, CBCPreprocessor

N_CLASSES = len(schema.CLASSES)


def get_model(lr=.0001, architecture=None):
    """Build a fresh compiled Keras ANN. With no `architecture`, builds the
    default Module 3 network; given a Keras `to_json()` string, rebuilds that
    exact architecture instead (so the lab's model matches the server's ANN
    layer-for-layer) — either way it gets a brand-new Adam optimizer at `lr`."""
    import tensorflow as tf
    if architecture is None:
        return models.build_ann(10, 4, lr=lr)
    model = tf.keras.models.model_from_json(architecture)
    model.compile(optimizer=tf.keras.optimizers.Adam(learning_rate=lr),
                  loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    return model


def prepare_partition_records(df, *, units):
    """Turn a lab's raw training-only dataframe into (unit-normalized feature
    dataframe, encoded integer labels), using the same normalize_units/
    encode_labels rules as everywhere else in the pipeline."""
    if df.empty or "split" not in df or set(df.split) != {"train"}:
        raise ValueError("Lab input must contain only explicitly marked training rows")
    if df.row_id.duplicated().any():
        raise ValueError("Duplicate lab row IDs")
    rows = [normalize_units(row, units=units) for row in df[schema.FEATURES].to_dict("records")]
    return pd.DataFrame(rows, columns=schema.FEATURES), encode_labels(df.label)


def local_metrics(y, predicted):
    """JSON-serializable confusion matrix for a lab's local predictions."""
    return {"confusion_matrix": json.dumps(confusion_matrix(y, predicted, labels=range(4)).tolist())}


get_weights = models.get_ann_weights
set_weights = models.set_ann_weights


def load_or_fit_preprocessor(unused, path):
    """Always load the shared, already-fitted preprocessor from `path` —
    never fit locally, so every lab uses identical feature scaling."""
    return CBCPreprocessor.load(path)  # Automatic local fitting is forbidden.
