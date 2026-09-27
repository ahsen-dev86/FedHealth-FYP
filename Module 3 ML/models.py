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
import numpy as np  # numerical arrays; TensorFlow/XGBoost are imported lazily below where needed


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
              epochs=100, batch_size=32, patience=10, verbose=1, seed=42):
    """Train with early stopping on val loss. Returns the Keras history."""
    import tensorflow as tf
    es = tf.keras.callbacks.EarlyStopping(
        monitor="val_loss", patience=patience, min_delta=1e-4, restore_best_weights=True)
    train = array_dataset(X_train, y_train, batch_size, shuffle=True, seed=seed)
    val = array_dataset(X_val, y_val, batch_size)
    history = ann.fit(train, validation_data=val, epochs=epochs,
                      class_weight=class_weight, callbacks=[es, tf.keras.callbacks.TerminateOnNaN()], verbose=verbose, shuffle=False)
    if not all(np.isfinite(v).all() for v in history.history.values()):
        raise ValueError("Non-finite training history")
    return history


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
        from .metrics import evaluate
        evaluate(y_int, proba)

        def nll(T):
            z = logits / max(T, 1e-3)
            z = z - z.max(axis=1, keepdims=True)
            p = np.exp(z); p /= p.sum(axis=1, keepdims=True)
            return -np.mean(np.log(np.clip(p[np.arange(len(y_int)), y_int], eps, 1.0)))

        res = minimize_scalar(nll, bounds=(0.05, 10.0), method="bounded")
        if not res.success or not np.isfinite(res.fun):
            raise ValueError("Calibration optimization failed")
        self.T = float(res.x) if res.fun <= nll(1.0) else 1.0
        return self

    def transform(self, proba):
        if not np.isfinite(self.T) or not .05 <= self.T <= 10.:
            raise ValueError("Invalid temperature")
        eps = 1e-8
        z = np.log(np.clip(np.asarray(proba, dtype=np.float64), eps, 1.0)) / self.T
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
        return np.asarray(self._embedder(np.asarray(X), training=False))

    def _features(self, X):
        """XGBoost input = [ANN embedding | scaled raw indices]."""
        return np.hstack([self._embed(X), np.asarray(X)])

    def fit_meta(self, X_train, y_train_int, X_val, y_val_int,
                 n_estimators=300, max_depth=4, learning_rate=0.05, seed=42):
        """Train the XGBoost head on ANN embeddings, then calibrate on val.
        Class imbalance is handled with balanced sample weights."""
        from xgboost import XGBClassifier
        from sklearn.utils.class_weight import compute_sample_weight

        if set(np.unique(y_train_int)) != set(range(len(self.classes))):
            raise ValueError("A local XGBoost head requires all four training classes")
        F_train = self._features(X_train)
        sw = compute_sample_weight("balanced", y_train_int)
        self.xgb = XGBClassifier(
            n_estimators=n_estimators, max_depth=max_depth,
            learning_rate=learning_rate, subsample=0.9, colsample_bytree=0.9,
            objective="multi:softprob", num_class=len(self.classes),
            eval_metric="mlogloss", tree_method="hist", random_state=seed, n_jobs=2, early_stopping_rounds=20)
        self.xgb.fit(F_train, y_train_int, sample_weight=sw,
                     eval_set=[(self._features(X_val), y_val_int)], verbose=False)

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

    @classmethod
    def load(cls, out_dir):
        from .artifacts import load_bundle
        return load_bundle(out_dir)[1]


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
    """Build a confusion matrix from hard predictions and summarize it via
    metrics.from_confusion (accuracy/F1/per-class recall, etc.)."""
    from .metrics import from_confusion
    from sklearn.metrics import confusion_matrix
    return from_confusion(confusion_matrix(y_true_int, y_pred_int, labels=range(len(classes))), classes)


def write_registry_metrics(out_dir, metrics):
    """Persist a metrics dict as metrics.json for the model registry."""
    from pathlib import Path
    from .runtime import write_json
    write_json(Path(out_dir) / "metrics.json", metrics)


def array_dataset(X, y, batch_size=32, *, shuffle=False, seed=42):
    """Bound TF input threads, keeping small Colab/CPU runs predictable."""
    import tensorflow as tf
    ds = tf.data.Dataset.from_tensor_slices((np.asarray(X, dtype="float32"), np.asarray(y, dtype="int64")))
    if shuffle:
        ds = ds.shuffle(len(X), seed=seed, reshuffle_each_iteration=True)
    opts = tf.data.Options()
    opts.threading.private_threadpool_size = 1
    opts.threading.max_intra_op_parallelism = 1
    return ds.batch(batch_size).with_options(opts).prefetch(1)
