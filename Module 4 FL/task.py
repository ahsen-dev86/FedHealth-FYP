"""Shared four-class model and strict lab data preparation."""
import json
import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix
from fedhealth_ml import schema, models
from fedhealth_ml.preprocess import normalize_units, encode_labels, CBCPreprocessor

N_CLASSES = len(schema.CLASSES)


def get_model(lr=.0001, architecture=None):
    import tensorflow as tf
    if architecture is None:
        return models.build_ann(10, 4, lr=lr)
    model = tf.keras.models.model_from_json(architecture)
    model.compile(optimizer=tf.keras.optimizers.Adam(learning_rate=lr),
                  loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    return model


def prepare_partition_records(df, *, units):
    if df.empty or "split" not in df or set(df.split) != {"train"}:
        raise ValueError("Lab input must contain only explicitly marked training rows")
    if df.row_id.duplicated().any():
        raise ValueError("Duplicate lab row IDs")
    rows = [normalize_units(row, units=units) for row in df[schema.FEATURES].to_dict("records")]
    return pd.DataFrame(rows, columns=schema.FEATURES), encode_labels(df.label)


def local_metrics(y, predicted):
    return {"confusion_matrix": json.dumps(confusion_matrix(y, predicted, labels=range(4)).tolist())}


get_weights = models.get_ann_weights
set_weights = models.set_ann_weights


def load_or_fit_preprocessor(unused, path):
    return CBCPreprocessor.load(path)  # Automatic local fitting is forbidden.
