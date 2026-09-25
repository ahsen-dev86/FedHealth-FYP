import copy
import json
import numpy as np
import pytest
from aggregation import aggregate_updates, weights_sha256, pooled_confusion_metrics
from validation import ValidationTracker


def fixture_updates():
    weights = [np.zeros((2, 2), dtype="float32"), np.ones(2, dtype="float32")]
    counts = {"lab-00": 2, "lab-01": 5, "lab-02": 9}
    updates = []
    for i, (lab, n) in enumerate(counts.items()):
        layers = [w + i + 1 for w in weights]
        updates.append((lab, layers, n, {"train_rows": n, "received_sha256": weights_sha256(weights),
            "returned_sha256": weights_sha256(layers), "preprocessor_sha256": "prep"}))
    kwargs = dict(reference_weights=weights, allowed_labs=list(counts), expected_train_rows=counts,
                  expected_input_sha256=weights_sha256(weights), preprocessor_sha256="prep")
    return updates, kwargs


def test_unequal_counts_fedavg_arithmetic():
    updates, kwargs = fixture_updates()
    actual, trace = aggregate_updates(updates, **kwargs)
    for i, value in enumerate(actual):
        expected = sum(u[1][i].astype("float64") * u[2] for u in updates) / 16
        np.testing.assert_allclose(value, expected, atol=1e-7)
    assert trace["total_examples"] == 16


@pytest.mark.parametrize("case", ["unknown", "duplicate", "missing", "count", "bool", "reported", "prep", "start", "returned", "shape", "dtype", "nan", "inf"])
def test_reject_bad_updates(case):
    updates, kwargs = fixture_updates()
    lab, weights, n, metrics = copy.deepcopy(updates[0])
    if case == "unknown": lab = "lab-99"
    if case == "duplicate": lab = "lab-01"
    if case == "missing": updates.pop()
    if case == "count": n += 1; metrics["train_rows"] = n
    if case == "bool": n = True
    if case == "reported": metrics["train_rows"] = 123
    if case == "prep": metrics["preprocessor_sha256"] = "other"
    if case == "start": metrics["received_sha256"] = "other"
    if case == "returned": metrics["returned_sha256"] = "other"
    if case == "shape": weights[0] = np.ones((9, 9), dtype="float32")
    if case == "dtype": weights[0] = weights[0].astype("float64")
    if case == "nan": weights[0][0, 0] = np.nan
    if case == "inf": weights[0][0, 0] = np.inf
    updates[0] = (lab, weights, n, metrics)
    with pytest.raises(ValueError):
        aggregate_updates(updates, **kwargs)


def test_pooled_counts_not_average_of_client_f1():
    results = [(2, {"lab_id": "a", "preprocessor_sha256": "p", "confusion_matrix": json.dumps([[1, 0], [1, 0]])}),
               (8, {"lab_id": "b", "preprocessor_sha256": "p", "confusion_matrix": json.dumps([[0, 0], [0, 8]])})]
    result = pooled_confusion_metrics(results, n_classes=2, allowed_labs=["a", "b"], preprocessor_sha256="p")
    assert result["accuracy"] == pytest.approx(.9)
    assert result["macro_f1"] == pytest.approx((2 / 3 + 16 / 17) / 2)
    results[0][1]["confusion_matrix"] = "[[1, 0], [0, 0]]"
    with pytest.raises(ValueError):
        pooled_confusion_metrics(results, n_classes=2, allowed_labs=["a", "b"], preprocessor_sha256="p")


class Model:
    def set_weights(self, weights): self.p = weights[0]
    def __call__(self, X, training=False): return self.p


def test_round_zero_eligibility_and_late_selection():
    tracker = ValidationTracker(Model(), np.zeros((4, 10)), np.arange(4), n_classes=4)
    p = np.full((4, 4), .1, dtype="float32"); np.fill_diagonal(p, .7)
    tracker.evaluate(0, [p], {})
    worse = np.full((4, 4), .2, dtype="float32"); np.fill_diagonal(worse, .4)
    tracker.evaluate(1, [worse], {})
    assert tracker.best_round == 0
    better = np.full((4, 4), .05, dtype="float32"); np.fill_diagonal(better, .85)
    tracker.evaluate(2, [better], {})
    assert tracker.best_round == 2
    with pytest.raises(ValueError, match="sequential"):
        tracker.evaluate(4, [better], {})
    with pytest.raises(ValueError, match="different weights"):
        tracker.evaluate(2, [p], {})
