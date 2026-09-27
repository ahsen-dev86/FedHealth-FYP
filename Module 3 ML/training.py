"""Centralized reference training. This module never evaluates test rows.

Entry point for Module 3: fits the shared preprocessor, trains the Module 3
ANN (+ a local XGBoost head and two classical baselines) on the train split,
calibrates on validation, and saves a verified bundle. Everything here reports
validation metrics only — the test split stays untouched until final_evaluate.py."""
import argparse
from pathlib import Path
import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier  # classical baseline for comparison
from sklearn.linear_model import LogisticRegression  # classical baseline for comparison
from . import schema, models
from .artifacts import save_bundle
from .data import Dataset, sha256
from .metrics import evaluate
from .preprocess import CBCPreprocessor
from .runtime import seed_all, write_json, environment

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CSV = ROOT / "Dataset/fedhealth_cbc_4class.csv"
DEFAULT_PROVENANCE = ROOT / "Dataset/fedhealth_cbc_4class_provenance.csv"


def prepare(dataset, output):
    """Fit the shared CBCPreprocessor on the training split, save it, and
    record which exact rows/hashes it was fit from (so later federated runs
    can verify they are reusing this same fitted preprocessor)."""
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    prep = CBCPreprocessor().fit(dataset.rows("train")[schema.FEATURES])
    prep.save(output / "preprocessor.joblib")
    info = {**dataset.audit(), "fit_split": "train", "fit_rows": prep.fit_rows,
            "fit_row_ids": dataset.rows("train").row_id.tolist(),
            "preprocessor_sha256": sha256(output / "preprocessor.joblib"), "environment": environment()}
    write_json(output / "preprocess.json", info)
    return prep


def train(dataset, output, *, seed=42, epochs=100, patience=10, trees=300, prepared=None, verbose=2):
    """Train the centralized reference model: build/train the ANN (early
    stopping on validation loss), temperature-calibrate it, fit the local
    XGBoost meta-learner on ANN embeddings, and also fit two classical
    baselines (logistic regression, random forest) purely for comparison.
    Saves a verified bundle plus validation metrics/history/settings. Reuses
    an already-fitted preprocessor from `prepared` if given (checked against
    this dataset), otherwise fits a fresh one from the training split."""
    import json
    import tensorflow as tf
    if epochs < 1 or patience < 1 or trees < 1:
        raise ValueError("Epochs, patience and trees must be positive")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    tf.keras.backend.clear_session()
    seed_all(seed)
    prep_source = None
    if prepared is not None:
        prepared = Path(prepared)
        info = json.loads((prepared / "preprocess.json").read_text())
        prep_source = prepared / "preprocessor.joblib"
        if info["data_sha256"] != dataset.sha256 or info["fit_row_ids"] != dataset.rows("train").row_id.tolist() or sha256(prep_source) != info["preprocessor_sha256"]:
            raise ValueError("Preprocessing release, training rows or checksum mismatch")
        prep = CBCPreprocessor.load(prep_source)
    else:
        prep = CBCPreprocessor().fit(dataset.rows("train")[schema.FEATURES])
    Xtr, ytr = dataset.xy("train", prep)
    Xv, yv = dataset.xy("val", prep)
    ann = models.build_ann(10, 4)
    history = models.train_ann(ann, Xtr, ytr, Xv, yv, epochs=epochs, patience=patience, seed=seed, verbose=verbose)
    ann_raw = np.asarray(ann(Xv, training=False))
    ann_temp = models.TemperatureScaler().fit(ann_raw, yv)
    hybrid = models.HybridModel(ann, schema.CLASSES, version=f"v2-four-class-seed{seed}")
    hybrid.fit_meta(Xtr, ytr, Xv, yv, n_estimators=trees, seed=seed)
    metrics = {"ann_uncalibrated": evaluate(yv, ann_raw),
               "ann": evaluate(yv, ann_temp.transform(ann_raw)),
               "hybrid": evaluate(yv, hybrid.predict_proba(Xv))}
    baseline_models = {
        "logistic_regression": LogisticRegression(max_iter=2000, random_state=seed),
        "random_forest": RandomForestClassifier(n_estimators=300, min_samples_leaf=2, random_state=seed, n_jobs=2),
    }
    for name, estimator in baseline_models.items():
        estimator.fit(Xtr, ytr)
        if list(estimator.classes_) != list(range(4)):
            raise ValueError("Baseline class order mismatch")
        metrics[name] = evaluate(yv, estimator.predict_proba(Xv))
        joblib.dump(estimator, output / f"{name}.joblib")
    settings = {"seed": seed, "epochs_max": epochs, "patience": patience, "min_delta": .0001,
                "batch_size": 32, "ann_lr": .001, "dropout": .3, "l2": .0001,
                "xgb_trees_max": trees, "xgb_depth": 4, "xgb_lr": .05, "xgb_early_stopping": 20,
                "actual_epochs": len(history.history["loss"]), "xgb_best_iteration": int(hybrid.xgb.best_iteration),
                "test_used": False}
    run_info = {"data_sha256": dataset.sha256, "raw_data_sha256": dataset.raw_sha256,
                "provenance_sha256": dataset.provenance_sha256, "training": settings,
                "fit_row_ids": dataset.rows("train").row_id.tolist(), "origin": "centralized",
                "validation_rows": len(yv), "selection": "ANN minimum validation loss; local XGB validation early stopping"}
    save_bundle(output / "model", prep, hybrid, run_info=run_info, ann_temperature=ann_temp.T, preprocessor_source=prep_source)
    write_json(output / "validation_metrics.json", {"split": "val", "data_sha256": dataset.sha256, "metrics": metrics})
    write_json(output / "history.json", history.history)
    write_json(output / "settings.json", settings)
    write_json(output / "baselines_manifest.json", {"data_sha256": dataset.sha256, "sha256": {f"{n}.joblib": sha256(output / f"{n}.joblib") for n in baseline_models}})
    print(f"Central training complete: {output}; validation only, test untouched.")
    return output / "model"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("command", choices=["audit", "prepare", "train"])
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--prepared", type=Path)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--patience", type=int, default=10)
    ap.add_argument("--trees", type=int, default=300)
    args = ap.parse_args()
    d = Dataset(args.csv, args.provenance)
    if args.command == "audit":
        import json
        print(json.dumps(d.audit(), indent=2))
    else:
        if args.out is None:
            ap.error("--out is required and must not exist")
        if args.command == "prepare":
            prepare(d, args.out)
        else:
            train(d, args.out, seed=args.seed, epochs=args.epochs, patience=args.patience, trees=args.trees, prepared=args.prepared)


if __name__ == "__main__":
    main()
