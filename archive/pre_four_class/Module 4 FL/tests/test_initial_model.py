import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import numpy as np

MODULE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_DIR))

# Keep this unit test independent from sklearn/scipy and TensorFlow. The real
# saved Keras artifact is validated in the Colab integration run.
fake_package = ModuleType("fedhealth_ml")
fake_package.schema = SimpleNamespace(
    MODEL_A_FEATURES=[f"feature-{i}" for i in range(14)],
    MODEL_A_CLASSES=[f"class-{i}" for i in range(9)],
)
fake_package.preprocess = SimpleNamespace()
sys.modules["fedhealth_ml"] = fake_package

import task  # noqa: E402


class FakeModel:
    def __init__(self, input_shape=(None, 14), output_shape=(None, 9),
                 weights=None):
        self.input_shape = input_shape
        self.output_shape = output_shape
        self._weights = weights or [
            np.zeros((14, 64), dtype=np.float32),
            np.zeros(64, dtype=np.float32),
        ]

    def get_weights(self):
        return [weight.copy() for weight in self._weights]

    def set_weights(self, weights):
        self._weights = [weight.copy() for weight in weights]


def fake_tensorflow(loaded_model):
    return SimpleNamespace(
        keras=SimpleNamespace(
            models=SimpleNamespace(
                load_model=lambda path, compile=False: loaded_model
            )
        )
    )


class InitialModelTests(unittest.TestCase):
    def load(self, loaded_model, expected_model=None):
        expected_model = expected_model or FakeModel()
        with (
            patch.dict(sys.modules, {"tensorflow": fake_tensorflow(loaded_model)}),
            patch.object(task, "get_model", return_value=expected_model),
        ):
            return task.load_initial_model("module3-ann.keras")

    def test_copies_compatible_module3_weights(self):
        weights = [
            np.full((14, 64), 2.0, dtype=np.float32),
            np.full(64, 3.0, dtype=np.float32),
        ]
        result = self.load(FakeModel(weights=weights))
        for expected, actual in zip(weights, result.get_weights()):
            np.testing.assert_array_equal(expected, actual)

    def test_rejects_wrong_output_shape(self):
        with self.assertRaisesRegex(ValueError, "output shape"):
            self.load(FakeModel(output_shape=(None, 8)))

    def test_rejects_wrong_input_shape(self):
        with self.assertRaisesRegex(ValueError, "input shape"):
            self.load(FakeModel(input_shape=(None, 13)))

    def test_rejects_wrong_weight_count(self):
        weights = [np.zeros((14, 64), dtype=np.float32)]
        with self.assertRaisesRegex(ValueError, "weight count"):
            self.load(FakeModel(weights=weights))

    def test_rejects_wrong_weight_shape(self):
        weights = [
            np.zeros((14, 32), dtype=np.float32),
            np.zeros(64, dtype=np.float32),
        ]
        with self.assertRaisesRegex(ValueError, "weight shape mismatch"):
            self.load(FakeModel(weights=weights))

    def test_rejects_non_finite_weights(self):
        weights = [
            np.full((14, 64), np.nan, dtype=np.float32),
            np.zeros(64, dtype=np.float32),
        ]
        with self.assertRaisesRegex(ValueError, "non-finite"):
            self.load(FakeModel(weights=weights))


if __name__ == "__main__":
    unittest.main()
