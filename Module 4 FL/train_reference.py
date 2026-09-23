"""Train a warm-start ANN only on the separate reference slice."""
import argparse
import json
from pathlib import Path

import numpy as np

from experiment_data import (load_arrays, load_split_manifest,
                             package_versions, sha256_file)
from fedhealth_ml import models, preprocess as pp, schema
from validation import evaluate_probabilities
from reproducibility import seed_all


def train_reference(split_dir, output_dir, *, seed=42, epochs=100, patience=10):
    import tensorflow as tf

    split_dir, output_dir = Path(split_dir).resolve(), Path(output_dir).resolve()
    if output_dir.exists():
        raise FileExistsError(f"Refusing to overwrite: {output_dir}")
    if epochs < 1 or patience < 1:
        raise ValueError("epochs and patience must be positive")
    split = load_split_manifest(split_dir)
    reference_path = split_dir / split["files"]["reference"]["path"]
    validation_path = split_dir / split["files"]["validation"]["path"]
    reference_raw, _ = pp.load_anemia(reference_path)
    preprocessor = pp.CBCPreprocessor(schema.MODEL_A_FEATURES).fit(reference_raw)
    Xtr, ytr = load_arrays(reference_path, preprocessor)
    Xval, yval = load_arrays(validation_path, preprocessor)
    seed_all(seed)
    model = models.build_ann(len(schema.MODEL_A_FEATURES),
                             len(schema.MODEL_A_CLASSES))
    history = models.train_ann(
        model, Xtr, ytr, Xval, yval,
        class_weight=models.class_weights(ytr, len(schema.MODEL_A_CLASSES)),
        epochs=epochs, patience=patience, verbose=0)
    metrics = evaluate_probabilities(yval, model.predict(Xval, verbose=0),
                                     len(schema.MODEL_A_CLASSES))
    output_dir.mkdir(parents=True, exist_ok=False)
    ann_path = output_dir / "ann.keras"
    prep_path = output_dir / "preprocessor.joblib"
    model.save(ann_path)
    preprocessor.save(prep_path)
    restored = tf.keras.models.load_model(ann_path, compile=False)
    for before, after in zip(model.get_weights(), restored.get_weights()):
        np.testing.assert_array_equal(before, after)
    np.testing.assert_allclose(model.predict(Xval[:8], verbose=0),
                               restored.predict(Xval[:8], verbose=0), atol=1e-7)
    manifest = {
        "purpose": "module4_reference_warm_start",
        "seed": int(seed), "epochs_limit": int(epochs), "patience": int(patience),
        "epochs_run": len(history.history["loss"]),
        "preprocessor_fit": "reference_only",
        "reference_sha256": split["files"]["reference"]["sha256"],
        "validation_sha256": split["files"]["validation"]["sha256"],
        "validation_metrics": metrics,
        "sha256": {path.name: sha256_file(path) for path in (ann_path, prep_path)},
        "versions": package_versions(),
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2),
                                                encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split-dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--patience", type=int, default=10)
    args = parser.parse_args()
    print(json.dumps(train_reference(args.split_dir, args.out, seed=args.seed,
                                     epochs=args.epochs, patience=args.patience),
                     indent=2))


if __name__ == "__main__":
    main()
