"""Evaluate one preselected ANN on the locked test set, once, at the end."""
import argparse
import json
from pathlib import Path

from aggregation import weights_sha256
from experiment_data import load_arrays, sha256_file
from fedhealth_ml import preprocess as pp, schema
from validation import evaluate_probabilities


def final_evaluate(split_dir, model_dir, *, final_test=False):
    if not final_test:
        raise ValueError("Locked test requires explicit --final-test")
    split_dir, model_dir = Path(split_dir).resolve(), Path(model_dir).resolve()
    split = json.loads((split_dir / "split_manifest.json").read_text(
        encoding="utf-8"))
    if split.get("purpose") != "module4_duplicate_aware_split":
        raise ValueError("Saved Module 3 fine-tuning is not an independent locked-test experiment")
    import tensorflow as tf
    experiment = json.loads((model_dir.parent / "results.json").read_text(
        encoding="utf-8"))
    if model_dir.name != experiment["integration_candidate"] or (
        experiment["integration_seed_predeclared"] != 42
    ):
        raise ValueError("Only the predeclared seed-42 integration candidate may be tested")
    result_path = model_dir / "final_test_metrics.json"
    if result_path.exists():
        raise FileExistsError(f"Locked test was already recorded: {result_path}")
    manifest = json.loads((model_dir / "manifest.json").read_text(
        encoding="utf-8"))
    run = manifest["run_info"]
    if run.get("initial_model_source") == "saved_module3_ann":
        raise ValueError("Saved Module 3 fine-tuning is not an independent locked-test experiment")
    if run["purpose"] != "module4_ann_federation" or (
        run["input_sha256"]["validation"] != split["files"]["validation"]["sha256"]
    ):
        raise ValueError("Model does not match this experiment split")
    for filename in ("ann.keras", "preprocessor.joblib"):
        if sha256_file(model_dir / filename) != manifest["sha256"][filename]:
            raise ValueError(f"Saved artifact checksum mismatch: {filename}")
    test_info = split["files"]["locked_test"]
    test_path = split_dir / test_info["path"]
    if sha256_file(test_path) != test_info["sha256"]:
        raise ValueError("Locked test checksum mismatch")
    model = tf.keras.models.load_model(model_dir / "ann.keras", compile=False)
    if weights_sha256(model.get_weights()) != run["selected_weights_sha256"]:
        raise ValueError("Saved model is not the selected validation round")
    prep = pp.CBCPreprocessor.load(model_dir / "preprocessor.joblib")
    Xte, yte = load_arrays(test_path, prep)
    metrics = evaluate_probabilities(yte, model.predict(Xte, verbose=0),
                                     len(schema.MODEL_A_CLASSES))
    counts = {class_name: f"{int(metrics['confusion_matrix'][i][i])}/"
              f"{int(metrics['per_class_support'][i])}"
              for i, class_name in enumerate(schema.MODEL_A_CLASSES)}
    report = {
        "evaluation_set": "locked_test", "test_rows": len(yte),
        "selected_round": run["selected_round"],
        "selected_model_contains_federated_updates": run["selected_round"] > 0,
        "model_sha256": manifest["sha256"]["ann.keras"],
        "test_sha256": test_info["sha256"],
        "metrics": metrics, "per_class_recall_counts": counts,
    }
    with result_path.open("x", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split-dir", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--final-test", action="store_true")
    args = parser.parse_args()
    print(json.dumps(final_evaluate(args.split_dir, args.model_dir,
                                    final_test=args.final_test), indent=2))


if __name__ == "__main__":
    main()
