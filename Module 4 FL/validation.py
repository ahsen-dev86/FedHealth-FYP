"""Global validation and predeclared safety-gated best-round selection."""
import numpy as np
from sklearn.metrics import confusion_matrix, log_loss

from aggregation import weights_sha256


def evaluate_probabilities(y_true, probabilities, n_classes):
    probabilities = np.asarray(probabilities, dtype=float)
    y_true = np.asarray(y_true, dtype=int)
    if probabilities.shape != (len(y_true), n_classes) or not np.isfinite(
        probabilities
    ).all():
        raise ValueError("Invalid validation probability matrix")
    if (probabilities < 0).any() or (probabilities > 1).any() or not np.allclose(
        probabilities.sum(axis=1), 1, atol=1e-4
    ):
        raise ValueError("Validation probabilities must sum to one")
    predicted = probabilities.argmax(axis=1)
    cm = confusion_matrix(y_true, predicted, labels=np.arange(n_classes))
    tp = np.diag(cm).astype(float)
    support = cm.sum(axis=1)
    predicted_counts = cm.sum(axis=0)
    precision = np.divide(tp, predicted_counts, out=np.zeros_like(tp),
                          where=predicted_counts != 0)
    recall = np.divide(tp, support, out=np.zeros_like(tp), where=support != 0)
    f1 = np.divide(2 * precision * recall, precision + recall,
                   out=np.zeros_like(tp), where=(precision + recall) != 0)
    return {
        "log_loss": float(log_loss(y_true, probabilities,
                                   labels=np.arange(n_classes))),
        "accuracy": float(tp.sum() / len(y_true)),
        "balanced_accuracy": float(recall.mean()),
        "macro_f1": float(f1.mean()),
        "weighted_f1": float(np.dot(f1, support) / len(y_true)),
        "sick_called_healthy": int(cm[1:, 0].sum()),
        "per_class_recall": recall.tolist(),
        "per_class_support": support.astype(int).tolist(),
        "confusion_matrix": cm.astype(int).tolist(),
    }


class ValidationTracker:
    """Run every round, retain lowest-loss model meeting baseline safety rules."""

    def __init__(self, model, X, y, *, n_classes,
                 max_macro_f1_drop=0.05, max_extra_sick_healthy=0):
        if max_macro_f1_drop < 0 or max_extra_sick_healthy < 0:
            raise ValueError("Safety allowances cannot be negative")
        self.model = model
        self.X = np.asarray(X)
        self.y = np.asarray(y)
        self.n_classes = n_classes
        self.max_macro_f1_drop = float(max_macro_f1_drop)
        self.max_extra_sick_healthy = int(max_extra_sick_healthy)
        self.history = []
        self.best_round = None
        self.best_weights = None
        self.best_metrics = None
        self.best_sha256 = None
        self.baseline = None

    def evaluate(self, server_round, parameters, config):
        round_number = int(server_round)
        weight_hash = weights_sha256(parameters)
        if self.history and self.history[-1]["round"] == round_number:
            if self.history[-1]["weights_sha256"] != weight_hash:
                raise ValueError("Same validation round received different weights")
            metrics = self.history[-1]
            return metrics["log_loss"], self._flower_metrics(metrics)
        if self.history and round_number != self.history[-1]["round"] + 1:
            raise ValueError("Validation rounds must be sequential")
        if not self.history and round_number != 0:
            raise ValueError("Round-zero validation is required")
        self.model.set_weights(parameters)
        probabilities = self.model.predict(self.X, verbose=0)
        metrics = evaluate_probabilities(self.y, probabilities, self.n_classes)
        if round_number == 0:
            self.baseline = dict(metrics)
        safe = (metrics["macro_f1"] >=
                self.baseline["macro_f1"] - self.max_macro_f1_drop and
                metrics["sick_called_healthy"] <=
                self.baseline["sick_called_healthy"] + self.max_extra_sick_healthy)
        metrics["eligible"] = bool(safe)
        metrics["round"] = round_number
        metrics["weights_sha256"] = weight_hash
        self.history.append(metrics)
        if safe and (self.best_metrics is None or
                     metrics["log_loss"] < self.best_metrics["log_loss"]):
            self.best_round = round_number
            self.best_metrics = dict(metrics)
            self.best_weights = [np.array(layer, copy=True) for layer in parameters]
            self.best_sha256 = weight_hash
        print(f"[validation] round {round_number}: "
              f"loss={metrics['log_loss']:.4f}, macro-F1={metrics['macro_f1']:.3f}, "
              f"eligible={safe}")
        return metrics["log_loss"], self._flower_metrics(metrics)

    @staticmethod
    def _flower_metrics(metrics):
        return {key: value for key, value in metrics.items()
                if key in {"accuracy", "balanced_accuracy", "macro_f1",
                           "weighted_f1", "sick_called_healthy", "eligible"}}
