"""Pure, testable validation and arithmetic for plaintext ANN FedAvg."""
import hashlib
import json

import numpy as np


def weights_sha256(layers):
    digest = hashlib.sha256()
    for layer in layers:
        array = np.asarray(layer)
        digest.update(json.dumps({"shape": array.shape, "dtype": str(array.dtype)},
                                 separators=(",", ":")).encode("utf-8"))
        digest.update(np.ascontiguousarray(array).tobytes())
    return digest.hexdigest()


def aggregate_updates(updates, reference_weights, allowed_labs, *,
                      expected_input_sha256, preprocessor_sha256,
                      expected_train_rows=None):
    """Reject malformed updates, then calculate example-weighted FedAvg."""
    allowed_labs = set(allowed_labs)
    if not updates or len(updates) != len(allowed_labs):
        raise ValueError("Every configured lab must provide one update")
    seen = set()
    checked = []
    for update in updates:
        lab_id, layers, count, metrics = update
        if lab_id not in allowed_labs or lab_id in seen:
            raise ValueError(f"Unknown or duplicate lab: {lab_id}")
        seen.add(lab_id)
        if isinstance(count, (bool, np.bool_)) or not isinstance(
            count, (int, np.integer)
        ) or count < 1:
            raise ValueError(f"Invalid example count from {lab_id}")
        if metrics.get("train_rows") != count:
            raise ValueError(f"Inconsistent reported training rows from {lab_id}")
        if expected_train_rows is not None and count != expected_train_rows[lab_id]:
            raise ValueError(f"Unexpected training row count from {lab_id}")
        if metrics.get("preprocessor_sha256") != preprocessor_sha256:
            raise ValueError(f"Wrong shared preprocessor at {lab_id}")
        if metrics.get("received_sha256") != expected_input_sha256:
            raise ValueError(f"{lab_id} trained from different global weights")
        if len(layers) != len(reference_weights):
            raise ValueError(f"Wrong number of tensors from {lab_id}")
        converted = []
        for index, (layer, expected) in enumerate(zip(layers, reference_weights)):
            array = np.asarray(layer)
            if array.shape != np.asarray(expected).shape or (
                array.dtype != np.asarray(expected).dtype
            ) or array.dtype.kind != "f":
                raise ValueError(f"Invalid tensor shape or type from {lab_id}: {index}")
            if not np.isfinite(array).all():
                raise ValueError(f"Non-finite tensor from {lab_id}: {index}")
            converted.append(array)
        returned_hash = weights_sha256(converted)
        if metrics.get("returned_sha256") != returned_hash:
            raise ValueError(f"Returned-weight fingerprint mismatch from {lab_id}")
        checked.append((lab_id, converted, count, returned_hash))
    if seen != allowed_labs:
        raise ValueError("One or more configured labs are missing")
    total = sum(count for _, _, count, _ in checked)
    result = []
    for index, expected in enumerate(reference_weights):
        weighted = sum(layer[index].astype(np.float64) * count
                       for _, layer, count, _ in checked)
        average = (weighted / total).astype(np.asarray(expected).dtype)
        if not np.isfinite(average).all():
            raise ValueError("Non-finite aggregate")
        result.append(average)
    trace = {
        "total_examples": int(total),
        "received_sha256": expected_input_sha256,
        "returned_sha256": {lab: digest for lab, _, _, digest in checked},
        "train_rows": {lab: int(count) for lab, _, count, _ in checked},
        "aggregated_sha256": weights_sha256(result),
    }
    return result, trace


def pooled_confusion_metrics(client_metrics, *, n_classes, allowed_labs,
                             preprocessor_sha256, expected_eval_rows=None):
    """Sum integer confusion matrices before calculating overall scores."""
    allowed_labs = set(allowed_labs)
    if len(client_metrics) != len(allowed_labs):
        raise ValueError("Every lab must report evaluation counts")
    seen = set()
    matrix = np.zeros((n_classes, n_classes), dtype=np.int64)
    for count, metrics in client_metrics:
        lab_id = metrics.get("lab_id")
        if lab_id not in allowed_labs or lab_id in seen:
            raise ValueError(f"Unknown or duplicate evaluating lab: {lab_id}")
        seen.add(lab_id)
        if metrics.get("preprocessor_sha256") != preprocessor_sha256:
            raise ValueError(f"Wrong shared preprocessor at {lab_id}")
        if isinstance(count, bool) or not isinstance(count, (int, np.integer)) or count < 1:
            raise ValueError(f"Invalid evaluation count from {lab_id}")
        if expected_eval_rows is not None and count != expected_eval_rows[lab_id]:
            raise ValueError(f"Unexpected evaluation row count from {lab_id}")
        try:
            candidate = np.asarray(json.loads(metrics["confusion_matrix"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Invalid confusion matrix from {lab_id}") from exc
        if candidate.shape != matrix.shape or candidate.dtype.kind not in "iu" or (
            candidate < 0
        ).any() or candidate.sum() != count:
            raise ValueError(f"Invalid confusion counts from {lab_id}")
        matrix += candidate
    if seen != allowed_labs:
        raise ValueError("Missing lab evaluation")
    tp = np.diag(matrix).astype(float)
    support = matrix.sum(axis=1)
    predicted = matrix.sum(axis=0)
    precision = np.divide(tp, predicted, out=np.zeros_like(tp), where=predicted != 0)
    recall = np.divide(tp, support, out=np.zeros_like(tp), where=support != 0)
    f1 = np.divide(2 * precision * recall, precision + recall,
                   out=np.zeros_like(tp), where=(precision + recall) != 0)
    total = int(matrix.sum())
    return {
        "accuracy": float(tp.sum() / total),
        "balanced_accuracy": float(recall.mean()),
        "macro_f1": float(f1.mean()),
        "weighted_f1": float(np.dot(f1, support) / total),
        "sick_called_healthy": int(matrix[1:, 0].sum()),
        "per_class_recall": json.dumps(recall.tolist()),
        "per_class_support": json.dumps(support.tolist()),
        "confusion_matrix": json.dumps(matrix.tolist()),
        "evaluation_rows": total,
    }
