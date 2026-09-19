import sys
import unittest
from pathlib import Path

import numpy as np

MODULE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_DIR))

from validation import ValidationTracker, load_validation_arrays  # noqa: E402


class FakeModel:
    def __init__(self, predictions):
        self.predictions = iter(predictions)
        self.weights = None

    def set_weights(self, weights):
        self.weights = weights

    def predict(self, X, verbose=0):
        return next(self.predictions)


class ValidationTests(unittest.TestCase):
    def test_loads_module3_validation_keys(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "arrays.npz"
            np.savez(
                path,
                Xval=np.ones((3, 14), dtype=np.float32),
                yval=np.array([0, 1, 2]),
            )
            X, y = load_validation_arrays(path, 14, 3)
        self.assertEqual(X.shape, (3, 14))
        np.testing.assert_array_equal(y, [0, 1, 2])

    def test_keeps_best_round_and_freezes_after_patience(self):
        y = np.array([0, 1])
        good = np.array([[0.9, 0.1], [0.1, 0.9]])
        bad = np.array([[0.1, 0.9], [0.9, 0.1]])
        model = FakeModel([good, bad, bad])
        tracker = ValidationTracker(
            model, np.ones((2, 1)), y, n_classes=2, patience=2
        )

        tracker.evaluate(0, [np.array([0.0])], {})
        tracker.evaluate(1, [np.array([1.0])], {})
        tracker.evaluate(2, [np.array([2.0])], {})

        self.assertEqual(tracker.best_round, 0)
        self.assertEqual(tracker.selection_stopped_at, 2)
        np.testing.assert_array_equal(tracker.best_weights[0], [0.0])


if __name__ == "__main__":
    unittest.main()
