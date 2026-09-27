"""Fresh source-exclusion sensitivity runs; no reuse of an all-source ANN.

For each data source (e.g. a donor dataset), trains a brand-new preprocessor
and ANN with that source's rows entirely excluded from train/val, then checks
performance on the held-out source. This estimates how much the model relies
on any single source, without reusing a model that already saw all sources.
"""
import argparse
from pathlib import Path
import numpy as np
from . import schema, models
from .data import Dataset
from .preprocess import CBCPreprocessor, encode_labels
from .metrics import evaluate
from .artifacts import save_bundle
from .runtime import seed_all, write_json
from .training import DEFAULT_CSV, DEFAULT_PROVENANCE


def run(dataset, output, *, seed=42, epochs=100):
    """For every distinct provenance source, retrain a fresh preprocessor+ANN
    (+local XGBoost) excluding that source's rows from train/val, evaluate on
    the excluded rows, and save each result as its own bundle. A source is
    skipped ("not estimable") if excluding it would remove an entire class
    from train or val. Writes source_holdout.json with all per-source reports."""
    import tensorflow as tf
    if dataset.provenance is None:
        raise ValueError("Source holdout requires provenance")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    frame = dataset.provenance
    reports = {}
    for source in sorted(frame.source.unique()):
        train = frame.loc[(frame.source != source) & (frame.split == "train")]
        val = frame.loc[(frame.source != source) & (frame.split == "val")]
        held = frame.loc[frame.source == source]
        if set(train.label) != set(schema.CLASSES) or set(val.label) != set(schema.CLASSES):
            reports[source] = {"status": "not estimable: class missing after source exclusion"}
            continue
        tf.keras.backend.clear_session()
        seed_all(seed)
        prep = CBCPreprocessor().fit(train[schema.FEATURES])
        Xtr, ytr = prep.transform(train), encode_labels(train.label)
        Xv, yv = prep.transform(val), encode_labels(val.label)
        ann = models.build_ann(10, 4)
        history = models.train_ann(ann, Xtr, ytr, Xv, yv, epochs=epochs, seed=seed, verbose=0)
        temp = models.TemperatureScaler().fit(np.asarray(ann(Xv, training=False)), yv)
        hybrid = models.HybridModel(ann, schema.CLASSES, version=f"v2-source-holdout-{source}-seed{seed}")
        hybrid.fit_meta(Xtr, ytr, Xv, yv, seed=seed)
        save_bundle(output / source, prep, hybrid, ann_temperature=temp.T,
            run_info={"data_sha256": dataset.sha256, "provenance_sha256": dataset.provenance_sha256,
                "origin": "source_holdout", "excluded_source": source, "fit_row_ids": train.row_id.tolist(),
                "validation_row_ids": val.row_id.tolist(), "training": {"seed": seed, "epochs_max": epochs,
                "actual_epochs": len(history.history["loss"]), "patience": 10}})
        def score(rows):
            """Evaluate the held-out source's ANN and hybrid metrics on `rows`."""
            X, y = prep.transform(rows), encode_labels(rows.label)
            return {"ann": evaluate(y, temp.transform(np.asarray(ann(X, training=False))), rows=rows),
                    "hybrid": evaluate(y, hybrid.predict_proba(X), rows=rows)}
        reports[source] = {"all_excluded_source_rows": score(held),
                           "original_test_rows_only": score(held.loc[held.split == "test"]),
                           "train_rows": len(train), "validation_rows": len(val)}
        write_json(output / "source_holdout.json", {"seed": seed, "data_sha256": dataset.sha256,
                   "results": reports, "limitation": "Sensitivity only: existing borrowed values were constructed before splitting; raw-source rebuild is needed for fully independent source validation."})
    return reports


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    run(Dataset(DEFAULT_CSV, DEFAULT_PROVENANCE), args.out, seed=args.seed)
