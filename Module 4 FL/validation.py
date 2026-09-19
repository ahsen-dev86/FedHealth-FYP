"""Central validation and best-round selection for FL experiments."""
from pathlib import Path

import numpy as np


def load_validation_arrays(path, input_dim, n_classes):
    """Load the untouched Module 3 validation split."""
    with np.load(Path(path), allow_pickle=False) as arrays:
        X = np.asarray(arrays["Xval"])
        y = np.asarray(arrays["yval"])

    if X.ndim != 2 or X.shape[1] != input_dim:
        raise ValueError(
            f"Validation features must have shape (rows, {input_dim})"
        )
    if y.ndim != 1 or len(y) != len(X):
        raise ValueError("Validation labels must contain one label per row")
    if len(y) == 0 or not np.isfinite(X).all():
        raise ValueError("Validation arrays must be non-empty and finite")
    if not np.issubdtype(y.dtype, np.integer):
        raise ValueError("Validation labels must be integer class indices")
    if np.any(y < 0) or np.any(y >= n_classes):
        raise ValueError("Validation labels are outside the model class range")
    return X, y


class ValidationTracker:
    """Evaluate each global model and retain the best validation round.

    Flower's classic simulation API always completes its configured round
    count. Once patience is exhausted, this tracker freezes model selection:
    later protocol rounds may finish, but they cannot replace the selected
    checkpoint.
    """

    def __init__(self, model, X, y, *, n_classes, patience=3, min_delta=0.0):
        if patience < 1:
            raise ValueError("patience must be at least 1")
        if min_delta < 0:
            raise ValueError("min_delta cannot be negative")

        self.model = model
        self.X = X
        self.y = y
        self.n_classes = n_classes
        self.patience = patience
        self.min_delta = min_delta
        self.best_round = None
        self.best_macro_f1 = float("-inf")
        self.best_weights = None
        self.best_metrics = None
        self.rounds_without_improvement = 0
        self.selection_stopped_at = None
        self.history = []

    def evaluate(self, server_round, parameters, config):
        from sklearn.metrics import (
            accuracy_score,
            balanced_accuracy_score,
            f1_score,
            log_loss,
        )

        self.model.set_weights(parameters)
        probabilities = np.asarray(
            self.model.predict(self.X, verbose=0)
        )
        if probabilities.shape != (len(self.y), self.n_classes):
            raise ValueError("Global ANN returned an invalid validation shape")
        if not np.isfinite(probabilities).all():
            raise ValueError("Global ANN returned non-finite probabilities")

        predicted = np.argmax(probabilities, axis=1)
        metrics = {
            "accuracy": float(accuracy_score(self.y, predicted)),
            "balanced_accuracy": float(
                balanced_accuracy_score(self.y, predicted)
            ),
            "macro_f1": float(
                f1_score(
                    self.y, predicted, average="macro", zero_division=0
                )
            ),
            "weighted_f1": float(
                f1_score(
                    self.y, predicted, average="weighted", zero_division=0
                )
            ),
            "log_loss": float(
                log_loss(
                    self.y,
                    probabilities,
                    labels=np.arange(self.n_classes),
                )
            ),
        }
        self.history.append({"round": int(server_round), **metrics})

        if self.selection_stopped_at is None:
            improved = metrics["macro_f1"] > (
                self.best_macro_f1 + self.min_delta
            )
            if improved:
                self.best_round = int(server_round)
                self.best_macro_f1 = metrics["macro_f1"]
                self.best_weights = [np.array(w, copy=True) for w in parameters]
                self.best_metrics = dict(metrics)
                self.rounds_without_improvement = 0
            elif server_round > 0:
                self.rounds_without_improvement += 1
                if self.rounds_without_improvement >= self.patience:
                    self.selection_stopped_at = int(server_round)

        print(
            f"[validation] round {server_round}: "
            f"macro-F1={metrics['macro_f1']:.3f}"
        )
        if self.selection_stopped_at == server_round:
            print(
                "[validation] selection stopped; "
                f"keeping round {self.best_round}"
            )
        return metrics["log_loss"], metrics

