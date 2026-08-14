# ml/fedhealth_ml/models.py
# ---------------------------------------------------------------------------
# The Hybrid ANN -> XGBoost model, plus calibration, metrics, and the bridge to
# Flower federated learning.
#
# ARCHITECTURE (and the privacy-relevant split — explain this at defense):
#   * The ANN (Keras) is the FEDERATED component. Its weights are what FedAvg
#     averages and what Paillier encrypts (Modules 4-5). Neural-net weights are
#     a weighted-averageable, encryptable representation — trees are not, which
#     is why the booster is NOT federated.
#   * XGBoost is a LOCAL meta-learner stacked on the ANN's penultimate
#     "embedding" (plus the scaled raw indices). In real deployment each lab
#     trains its own booster on the shared federated ANN; here in Colab we train
#     one centrally as the reference model.
#   * Output is a CALIBRATED per-condition confidence vector (temperature
#     scaling, Guo et al. 2017) — NEVER a hard categorical label. The doctor
#     confirms the diagnosis (scope 6.2.2).
#
# TF/XGBoost run in Colab; this module is import-light so schema/preprocess can
# be used without them installed.
# ---------------------------------------------------------------------------
import json
import os
import numpy as np


# --- ANN (Keras) ------------------------------------------------------------
def build_ann(input_dim, n_classes, hidden=(64, 32), dropout=0.3, l2=1e-4, lr=1e-3):
    """A small, regularized feed-forward classifier. The last hidden layer is
    named 'embedding' so we can extract it as XGBoost input. Kept small so the
    weight vector Paillier must encrypt stays tractable (Module 5)."""
    import tensorflow as tf
    from tensorflow.keras import layers, regularizers, Model, Input

    inp = Input(shape=(input_dim,), name="cbc_input")
    x = inp
    for i, h in enumerate(hidden[:-1]):
        x = layers.Dense(h, activation="relu",
                         kernel_regularizer=regularizers.l2(l2),
                         name=f"dense_{i}")(x)
        x = layers.Dropout(dropout, name=f"drop_{i}")(x)
    # Final hidden layer = the embedding fed to XGBoost.
    x = layers.Dense(hidden[-1], activation="relu",
                     kernel_regularizer=regularizers.l2(l2),
                     name="embedding")(x)
    out = layers.Dense(n_classes, activation="softmax", name="softmax")(x)

    model = Model(inp, out, name="fedhealth_ann")
    model.compile(optimizer=tf.keras.optimizers.Adam(lr),
                  loss="sparse_categorical_crossentropy",
                  metrics=["accuracy"])
    return model


def embedding_model(ann):
    """A sub-model mapping CBC input -> the 'embedding' layer activations."""
    from tensorflow.keras import Model
    return Model(ann.input, ann.get_layer("embedding").output, name="embedder")


def class_weights(y_int, n_classes):
    """Balanced class weights (inverse frequency) -> dict for Keras class_weight.
    This is our primary lever against the model biasing toward frequent classes
    like 'healthy' and ignoring rare ones like 'leukemia'."""
    counts = np.bincount(y_int, minlength=n_classes).astype(float)
    counts[counts == 0] = 1.0
    w = counts.sum() / (n_classes * counts)
    return {i: float(w[i]) for i in range(n_classes)}


def train_ann(ann, X_train, y_train, X_val, y_val, class_weight=None,
              epochs=150, batch_size=32, patience=15, verbose=1):
    """Train with early stopping on val loss. Returns the Keras history."""
    import tensorflow as tf
    es = tf.keras.callbacks.EarlyStopping(
        monitor="val_loss", patience=patience, restore_best_weights=True)
    return ann.fit(X_train, y_train,
                   validation_data=(X_val, y_val),
                   epochs=epochs, batch_size=batch_size,
                   class_weight=class_weight, callbacks=[es], verbose=verbose)


# --- Temperature scaling (calibration) --------------------------------------
class TemperatureScaler:
    """Single-parameter calibration (Guo et al., 2017). Softens/sharpens a
    probability vector so the reported confidence better matches real accuracy.
    Fit on validation predictions only."""

    def __init__(self):
        self.T = 1.0

    def fit(self, proba, y_int):
        from scipy.optimize import minimize_scalar
        eps = 1e-8
        logits = np.log(np.clip(proba, eps, 1.0))
        y_int = np.asarray(y_int)

        def nll(T):
            z = logits / max(T, 1e-3)
            z = z - z.max(axis=1, keepdims=True)
            p = np.exp(z); p /= p.sum(axis=1, keepdims=True)
            return -np.mean(np.log(np.clip(p[np.arange(len(y_int)), y_int], eps, 1.0)))

        res = minimize_scalar(nll, bounds=(0.05, 10.0), method="bounded")
        self.T = float(res.x)
        return self

    def transform(self, proba):
        eps = 1e-8
        z = np.log(np.clip(proba, eps, 1.0)) / self.T
        z = z - z.max(axis=1, keepdims=True)
        p = np.exp(z); p /= p.sum(axis=1, keepdims=True)
        return p


# --- The hybrid model -------------------------------------------------------
class HybridModel:
    """ANN (federated) + XGBoost (local meta) + temperature calibration.
    All methods operate on ALREADY-SCALED input X (use CBCPreprocessor first)."""

    def __init__(self, ann, classes, xgb=None, temperature=None,
                 model_name="cbc_multiclass", version="v1.0.0"):
        self.ann = ann
        self.classes = list(classes)
        self.xgb = xgb
        self.temperature = temperature or TemperatureScaler()
        self.model_name = model_name
        self.version = version
        self._embedder = None

    def _embed(self, X):
        if self._embedder is None:
            self._embedder = embedding_model(self.ann)
        return self._embedder.predict(X, verbose=0)

    def _features(self, X):
        """XGBoost input = [ANN embedding | scaled raw indices]."""
        return np.hstack([self._embed(X), np.asarray(X)])

    def fit_meta(self, X_train, y_train_int, X_val, y_val_int,
                 n_estimators=300, max_depth=4, learning_rate=0.1):
        """Train the XGBoost head on ANN embeddings, then calibrate on val.
        Class imbalance is handled with balanced sample weights."""
        from xgboost import XGBClassifier
        from sklearn.utils.class_weight import compute_sample_weight

        F_train = self._features(X_train)
        sw = compute_sample_weight("balanced", y_train_int)
        self.xgb = XGBClassifier(
            n_estimators=n_estimators, max_depth=max_depth,
            learning_rate=learning_rate, subsample=0.9, colsample_bytree=0.9,
            objective="multi:softprob", num_class=len(self.classes),
            eval_metric="mlogloss", tree_method="hist", random_state=42)
        self.xgb.fit(F_train, y_train_int, sample_weight=sw)

        # Calibrate the (uncalibrated) validation probabilities.
        val_proba = self.xgb.predict_proba(self._features(X_val))
        self.temperature.fit(val_proba, y_val_int)
        return self

    def predict_proba(self, X):
        """Calibrated per-class probability matrix (rows sum to 1)."""
        raw = self.xgb.predict_proba(self._features(X))
        return self.temperature.transform(raw)

    def predict_scores(self, X):
        """List of {class_key: confidence} dicts — the `scores` JSONB the API
        stores. This is the system's only automated output."""
        proba = self.predict_proba(X)
        return [{c: float(round(p, 4)) for c, p in zip(self.classes, row)}
                for row in proba]

    # --- persistence --------------------------------------------------------
    def save(self, out_dir):
        os.makedirs(out_dir, exist_ok=True)
        self.ann.save(os.path.join(out_dir, "ann.keras"))
        self.xgb.save_model(os.path.join(out_dir, "xgb.json"))
        meta = {"model_name": self.model_name, "version": self.version,
                "classes": self.classes, "calibration": "temperature",
                "temperature": self.temperature.T}
        with open(os.path.join(out_dir, "meta.json"), "w") as f:
            json.dump(meta, f, indent=2)

    @classmethod
    def load(cls, out_dir):
        import tensorflow as tf
        from xgboost import XGBClassifier
        with open(os.path.join(out_dir, "meta.json")) as f:
            meta = json.load(f)
        ann = tf.keras.models.load_model(os.path.join(out_dir, "ann.keras"))
        xgb = XGBClassifier()
        xgb.load_model(os.path.join(out_dir, "xgb.json"))
        temp = TemperatureScaler(); temp.T = meta["temperature"]
        return cls(ann, meta["classes"], xgb=xgb, temperature=temp,
                   model_name=meta["model_name"], version=meta["version"])


# --- Flower bridge (used by the FL client in Module 4) ----------------------
def get_ann_weights(ann):
    """ANN weights as a list of numpy arrays — exactly what Flower exchanges and
    FedAvg averages, and what Paillier encrypts element-wise (Module 5)."""
    return ann.get_weights()


def set_ann_weights(ann, weights):
    """Load a list of numpy arrays back into the ANN (e.g. the global model)."""
    ann.set_weights(weights)


# --- Metrics (populate ml_models.metrics for the registry) ------------------
def compute_metrics(y_true_int, y_pred_int, classes):
    """Per-class + macro metrics. Macro-F1 and per-class recall are the numbers
    that show the model is balanced across diseases, not just globally accurate."""
    from sklearn.metrics import (f1_score, balanced_accuracy_score,
                                 recall_score, precision_score)
    labels = list(range(len(classes)))
    per_class = {}
    rec = recall_score(y_true_int, y_pred_int, labels=labels, average=None, zero_division=0)
    prec = precision_score(y_true_int, y_pred_int, labels=labels, average=None, zero_division=0)
    counts = np.bincount(y_true_int, minlength=len(classes))
    for i, c in enumerate(classes):
        per_class[c] = {"recall": round(float(rec[i]), 3),
                        "precision": round(float(prec[i]), 3),
                        "support": int(counts[i])}
    return {
        "macro_f1": round(float(f1_score(y_true_int, y_pred_int, average="macro", zero_division=0)), 3),
        "balanced_accuracy": round(float(balanced_accuracy_score(y_true_int, y_pred_int)), 3),
        "per_class_recall": {c: per_class[c]["recall"] for c in classes},
        "per_class": per_class,
    }


def write_registry_metrics(out_dir, metrics):
    """Write metrics.json for the ml_models registry (Module 2 mlModels.register
    reads this to record how balanced the model is)."""
    with open(os.path.join(out_dir, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
