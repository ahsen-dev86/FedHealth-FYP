import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix, f1_score

MODULE = Path(__file__).resolve().parents[1]
ROOT = MODULE.parent
sys.path.insert(0, str(MODULE))

from aggregation import (aggregate_updates, pooled_confusion_metrics,
                         weights_sha256)  # noqa: E402
from fedhealth_ml import preprocess as pp, schema  # noqa: E402
from make_splits import make_splits  # noqa: E402
from partition import feature_group_ids  # noqa: E402
from server import load_certificates  # noqa: E402
from validation import ValidationTracker  # noqa: E402
import client  # noqa: E402
from final_evaluate import final_evaluate  # noqa: E402
from run_experiments import summarize  # noqa: E402


class AggregationTests(unittest.TestCase):
    def _update(self, lab, value, count, received):
        layers = [np.array([value, value + 1], dtype=np.float32)]
        return (lab, layers, count, {
            "train_rows": count,
            "preprocessor_sha256": "shared-prep",
            "received_sha256": received,
            "returned_sha256": weights_sha256(layers),
        })

    def test_three_labs_two_rounds_match_manual_fedavg(self):
        initial = [np.zeros(2, dtype=np.float32)]
        received = weights_sha256(initial)
        counts = [2, 3, 5]
        first = [self._update(f"lab-{i:02d}", value, counts[i], received)
                 for i, value in enumerate((1, 3, 5))]
        allowed = [f"lab-{i:02d}" for i in range(3)]
        result, trace = aggregate_updates(
            first, initial, allowed, expected_input_sha256=received,
            preprocessor_sha256="shared-prep")
        manual = (2 * first[0][1][0] + 3 * first[1][1][0] +
                  5 * first[2][1][0]) / 10
        np.testing.assert_allclose(result[0], manual)
        self.assertEqual(trace["train_rows"], dict(zip(allowed, counts)))
        self.assertEqual(trace["aggregated_sha256"], weights_sha256(result))
        second = [self._update(f"lab-{i:02d}", value, counts[i],
                               trace["aggregated_sha256"])
                  for i, value in enumerate((2, 4, 6))]
        next_result, next_trace = aggregate_updates(
            second, initial, allowed,
            expected_input_sha256=trace["aggregated_sha256"],
            preprocessor_sha256="shared-prep")
        manual_next = (2 * second[0][1][0] + 3 * second[1][1][0] +
                       5 * second[2][1][0]) / 10
        np.testing.assert_allclose(next_result[0], manual_next)
        self.assertEqual(next_trace["received_sha256"],
                         trace["aggregated_sha256"])

    def test_rejects_malformed_and_unknown_updates(self):
        initial = [np.zeros(2, dtype=np.float32)]
        received = weights_sha256(initial)
        good = self._update("lab-00", 1, 2, received)
        other = self._update("lab-01", 3, 3, received)
        kwargs = dict(expected_input_sha256=received,
                      preprocessor_sha256="shared-prep")
        broken = [
            ("lab-00", [np.array([np.nan, 1], dtype=np.float32)], 2,
             good[3]),
            ("lab-00", [np.zeros(3, dtype=np.float32)], 2, good[3]),
            ("lab-00", [np.zeros(2, dtype=np.float64)], 2, good[3]),
            ("lab-00", good[1], 0, good[3]),
            ("lab-xx", good[1], 2, good[3]),
            ("lab-00", good[1], 2, {**good[3], "received_sha256": "wrong"}),
            ("lab-00", good[1], 2, {**good[3], "preprocessor_sha256": "wrong"}),
        ]
        for bad in broken:
            with self.subTest(bad=bad[0:3]), self.assertRaises(ValueError):
                aggregate_updates([bad, other], initial,
                                  ["lab-00", "lab-01"], **kwargs)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            aggregate_updates([good, good], initial,
                              ["lab-00", "lab-01"], **kwargs)

    def test_pooled_confusion_gives_actual_macro_f1(self):
        true = np.array([0, 0, 0, 1, 1, 2, 2, 2, 2])
        pred = np.array([0, 0, 1, 0, 1, 2, 0, 2, 2])
        payloads = []
        for i, indices in enumerate((slice(0, 3), slice(3, 5), slice(5, 9))):
            cm = confusion_matrix(true[indices], pred[indices], labels=[0, 1, 2])
            payloads.append((len(true[indices]), {
                "lab_id": f"lab-{i:02d}", "preprocessor_sha256": "shared",
                "confusion_matrix": json.dumps(cm.tolist()),
            }))
        result = pooled_confusion_metrics(
            payloads, n_classes=3,
            allowed_labs=[f"lab-{i:02d}" for i in range(3)],
            preprocessor_sha256="shared")
        self.assertAlmostEqual(result["macro_f1"],
                               f1_score(true, pred, average="macro"))
        self.assertEqual(result["sick_called_healthy"], 2)


class SplitAndUnitsTests(unittest.TestCase):
    def test_real_csv_has_disjoint_repeatable_splits(self):
        csv_path = ROOT / "anemia_diagnosed_cbc_data_v4.csv"
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first"
            second = Path(directory) / "second"
            one = make_splits(csv_path, first, seed=42)
            two = make_splits(csv_path, second, seed=42)
            self.assertEqual({k: v["sha256"] for k, v in one["files"].items()},
                             {k: v["sha256"] for k, v in two["files"].items()})
            grouped = {name: set(feature_group_ids(pd.read_csv(first / info["path"])))
                       for name, info in one["files"].items()}
            for a, ids in grouped.items():
                for b, other in grouped.items():
                    if a < b:
                        self.assertFalse(ids & other, (a, b))
            self.assertEqual(sum(v["rows"] for v in one["files"].values()),
                             len(pd.read_csv(csv_path)))
            with self.assertRaises(FileExistsError):
                make_splits(csv_path, first, seed=42)

    def test_explicit_units_fix_hct_and_reject_impossible(self):
        source = pd.read_csv(ROOT / "anemia_diagnosed_cbc_data_v4.csv").iloc[[0]].copy()
        source.loc[:, "HCT"] = 0.38
        source.loc[:, "HGB"] = 124.0
        source.loc[:, "WBC"] = 9000.0
        units = dict(schema.MODEL_A_UNITS)
        units.update({"HCT": "fraction", "HGB": "g/L", "WBC": "cells/uL"})
        converted = pp.convert_declared_units(source, units)
        self.assertAlmostEqual(float(converted["HCT"].iloc[0]), 38.0)
        self.assertAlmostEqual(float(converted["HGB"].iloc[0]), 12.4)
        self.assertAlmostEqual(float(converted["WBC"].iloc[0]), 9.0)
        source.loc[:, "HCT"] = 7.0
        with self.assertRaisesRegex(ValueError, "Impossible HCT"):
            pp.convert_declared_units(source, units)
        canonical = pp.clean_ranges(source, schema.MODEL_A_FEATURES)
        self.assertEqual(float(canonical["HCT"].iloc[0]), 7.0)
        self.assertTrue(pd.isna(canonical["WBC"].iloc[0]))


class FakePredictor:
    def __init__(self, answers):
        self.answers = iter(answers)

    def set_weights(self, weights):
        self.weights = weights

    def predict(self, X, verbose=0):
        return next(self.answers)


class FakeTrainable:
    def set_weights(self, weights):
        self.weights = [np.array(layer, copy=True) for layer in weights]

    def get_weights(self):
        return [np.array(layer, copy=True) for layer in self.weights]

    def fit(self, X, y, **kwargs):
        self.weights[0] += 1.0


class ValidationAndSecurityTests(unittest.TestCase):
    def test_locked_test_needs_explicit_final_flag(self):
        with self.assertRaisesRegex(ValueError, "--final-test"):
            final_evaluate("unused", "unused")

    def test_results_summary_uses_seed_means(self):
        rows = [{"method": "local", "seed": seed, **{
            score: value for score in (
                "accuracy", "balanced_accuracy", "macro_f1", "weighted_f1",
                "log_loss", "sick_called_healthy")}}
                for seed, value in ((42, 1.0), (42, 3.0), (52, 5.0), (52, 7.0))]
        summary = summarize(rows)["local"]["scores"]["macro_f1"]
        self.assertEqual(summary["mean"], 4.0)
        self.assertAlmostEqual(summary["std"], np.sqrt(8.0))

    def test_lab_fit_uses_fresh_model_each_round(self):
        lab = client.LabClient.__new__(client.LabClient)
        lab.lab_id = "lab-00"
        lab.local_epochs = 1
        lab.batch_size = 2
        lab.seed = 42
        lab.preprocessor_sha256 = "shared"
        lab.Xtr = np.ones((3, 1))
        lab.ytr = np.zeros(3, dtype=int)
        lab.class_weight = {0: 1.0}
        built = []

        def fresh():
            model = FakeTrainable()
            built.append(model)
            return model

        incoming = [np.array([5.0], dtype=np.float32)]
        with patch.object(client.task, "get_model", side_effect=fresh), (
            patch.object(client, "seed_all")
        ):
            first, _, _ = lab.fit(incoming, {"server_round": 1})
            second, _, _ = lab.fit(incoming, {"server_round": 2})
        self.assertEqual(len(built), 2)
        np.testing.assert_array_equal(first[0], [6.0])
        np.testing.assert_array_equal(second[0], [6.0])

    def test_best_loss_is_subject_to_predeclared_safety(self):
        y = np.array([0, 1, 1, 0])
        baseline = np.array([[0.8, 0.2], [0.2, 0.8],
                             [0.4, 0.6], [0.7, 0.3]])
        unsafe = np.array([[0.99, 0.01], [0.51, 0.49],
                           [0.01, 0.99], [0.99, 0.01]])
        safe = np.array([[0.9, 0.1], [0.1, 0.9],
                         [0.1, 0.9], [0.9, 0.1]])
        tracker = ValidationTracker(FakePredictor([baseline, unsafe, safe]),
                                    np.ones((4, 1)), y, n_classes=2,
                                    max_macro_f1_drop=0,
                                    max_extra_sick_healthy=0)
        for rnd in range(3):
            tracker.evaluate(rnd, [np.array([rnd], dtype=np.float32)], {})
        self.assertFalse(tracker.history[1]["eligible"])
        self.assertEqual(tracker.best_round, 2)
        np.testing.assert_array_equal(tracker.best_weights[0], [2])

    def test_missing_tls_never_falls_back_silently(self):
        with self.assertRaises(ValueError):
            load_certificates(None, None, None)
        with self.assertRaises(FileNotFoundError):
            load_certificates("missing-ca", "missing-cert", "missing-key")
        self.assertIsNone(load_certificates(None, None, None, insecure_dev=True))


if __name__ == "__main__":
    unittest.main()
