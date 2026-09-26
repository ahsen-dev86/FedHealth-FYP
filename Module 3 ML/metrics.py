"""Identical metrics for centralized, federated and final evaluation."""
import numpy as np
from sklearn.metrics import confusion_matrix, log_loss
from . import schema


def from_confusion(cm, classes=None):
    classes = list(classes or schema.CLASSES)
    cm = np.asarray(cm)
    if cm.shape != (len(classes), len(classes)) or cm.dtype.kind not in "iu" or (cm < 0).any() or not cm.sum():
        raise ValueError("Invalid confusion counts")
    tp, support, predicted = np.diag(cm), cm.sum(axis=1), cm.sum(axis=0)
    recall = np.divide(tp, support, out=np.zeros(len(classes)), where=support > 0)
    precision = np.divide(tp, predicted, out=np.zeros(len(classes)), where=predicted > 0)
    f1 = np.divide(2 * tp, support + predicted, out=np.zeros(len(classes)), where=(support + predicted) > 0)
    return {"accuracy": float(tp.sum() / cm.sum()), "macro_f1": float(f1.mean()),
            "balanced_accuracy": float(recall[support > 0].mean()),
            "per_class_recall": dict(zip(classes, recall.tolist())),
            "per_class": {c: {"recall": float(recall[i]), "precision": float(precision[i]), "f1": float(f1[i]), "support": int(support[i])} for i, c in enumerate(classes)},
            "confusion_matrix": cm.tolist(), "sick_called_healthy": int(cm[1:, 0].sum())}


def evaluate(y, probabilities, *, rows=None):
    y, p = np.asarray(y), np.asarray(probabilities, dtype=float)
    if y.dtype.kind not in "iu" or len(y) == 0 or (y < 0).any() or (y >= 4).any():
        raise ValueError("Invalid target labels")
    if p.shape != (len(y), 4) or not np.isfinite(p).all() or (p < 0).any() or (p > 1).any() or not np.allclose(p.sum(axis=1), 1, atol=1e-5):
        raise ValueError("Invalid class probabilities")
    pred = p.argmax(axis=1)
    p = p / p.sum(axis=1, keepdims=True)
    out = from_confusion(confusion_matrix(y, pred, labels=range(4)))
    out["log_loss"] = float(log_loss(y, p, labels=range(4)))
    confidence, correct = p.max(axis=1), (pred == y)
    bins = np.minimum((confidence * 15).astype(int), 14)
    out["ece_15_bins"] = float(sum(np.mean(bins == b) * abs(correct[bins == b].mean() - confidence[bins == b].mean()) for b in range(15) if np.any(bins == b)))
    if rows is not None:
        if len(rows) != len(y):
            raise ValueError("Misaligned evaluation rows")
        out["subtypes"] = {str(name): {"recall": float(correct[np.asarray(rows.subtype == name)].mean()), "support": int((rows.subtype == name).sum())} for name in sorted(rows.subtype.unique())}
        if "source" in rows:
            out["sources"] = {str(name): evaluate(y[np.asarray(rows.source == name)], p[np.asarray(rows.source == name)]) for name in sorted(rows.source.unique())}
    return out
