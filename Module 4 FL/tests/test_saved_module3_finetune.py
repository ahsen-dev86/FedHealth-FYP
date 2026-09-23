"""Check exact Module 3 split reconstruction before Flower is started."""
import sys
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

MODULE = Path(__file__).resolve().parents[1]
ROOT = MODULE.parent
sys.path.insert(0, str(MODULE))

from experiment_data import load_split_manifest  # noqa: E402
from final_evaluate import final_evaluate  # noqa: E402
from fedhealth_ml import preprocess as pp, schema  # noqa: E402
from make_module3_split import make_module3_split  # noqa: E402


class SavedModule3SplitTests(unittest.TestCase):
    def _artifacts(self, directory):
        csv_path = ROOT / "anemia_diagnosed_cbc_data_v4.csv"
        X, y = pp.load_anemia(csv_path)
        split = pp.stratified_split(X, y, seed=42)
        prep = pp.CBCPreprocessor(schema.MODEL_A_FEATURES).fit(split["X_train"])
        model3 = directory / "model3"
        model3.mkdir()
        prep.save(model3 / "preprocessor.joblib")
        (model3 / "ann.keras").write_bytes(b"placeholder-model-for-split-test")
        (model3 / "meta.json").write_text(
            json.dumps({"classes": list(schema.MODEL_A_CLASSES)}),
            encoding="utf-8")
        arrays = {}
        for name, suffix in (("train", "tr"), ("val", "val"), ("test", "te")):
            arrays[f"X{suffix}"] = prep.transform(split[f"X_{name}"])
            arrays[f"y{suffix}"] = pp.encode_labels(
                split[f"y_{name}"], schema.MODEL_A_CLASSES)
        np.savez(model3 / "arrays.npz", **arrays)
        return csv_path, model3

    def test_saved_artifacts_match_original_train_validation_and_test_rows(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            csv_path, model3 = self._artifacts(directory)
            output = directory / "split"
            manifest = make_module3_split(csv_path, model3, output)
            self.assertEqual(manifest["module3_rows"],
                             {"train": 896, "validation": 128, "test": 257})
            self.assertEqual(manifest["purpose"],
                             "module4_saved_module3_ann_finetune_split")
            self.assertEqual(sum(manifest["files"][f"lab_{i:02d}"]["rows"]
                                 for i in range(3)), 896)
            self.assertEqual(manifest["files"]["validation"]["rows"], 128)
            self.assertGreater(
                manifest["duplicate_groups_across_module3_splits"]["train_test"], 0)
            self.assertFalse((output / "locked_test.csv").exists())
            self.assertEqual(load_split_manifest(output)["source_sha256"],
                             manifest["source_sha256"])
            with self.assertRaisesRegex(ValueError, "not an independent"):
                final_evaluate(output, directory / "unused", final_test=True)
            with self.assertRaises(FileExistsError):
                make_module3_split(csv_path, model3, output)

    def test_rejects_arrays_from_a_different_preprocessor(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            csv_path, model3 = self._artifacts(directory)
            with np.load(model3 / "arrays.npz", allow_pickle=False) as source:
                arrays = {name: source[name].copy() for name in source.files}
            arrays["Xtr"][0, 0] += 1
            np.savez(model3 / "arrays.npz", **arrays)
            with self.assertRaises(AssertionError):
                make_module3_split(csv_path, model3, directory / "split")

    def test_rejects_different_class_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            csv_path, model3 = self._artifacts(directory)
            (model3 / "meta.json").write_text(
                json.dumps({"classes": list(reversed(schema.MODEL_A_CLASSES))}),
                encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "class order"):
                make_module3_split(csv_path, model3, directory / "split")


if __name__ == "__main__":
    unittest.main()
