"""Recreate Module 3's original training split for saved-ANN fine-tuning.

This is an overlap-aware engineering experiment, not a new independent test.
The saved Module 3 ANN already trained on these rows and used its validation set.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit

from experiment_data import sha256_file
from fedhealth_ml import preprocess as pp, schema
from partition import feature_group_ids, partition_dataframe


def _verify_arrays(csv_path, preprocessor, arrays_path):
    X, y = pp.load_anemia(csv_path)
    split = pp.stratified_split(X, y, test_size=0.2, val_size=0.1, seed=42)
    with np.load(arrays_path, allow_pickle=False) as arrays:
        for name, suffix in (("train", "tr"), ("val", "val"), ("test", "te")):
            features = split[f"X_{name}"]
            labels = pp.encode_labels(split[f"y_{name}"], schema.MODEL_A_CLASSES)
            np.testing.assert_allclose(preprocessor.transform(features),
                                       arrays[f"X{suffix}"], rtol=1e-5, atol=1e-6,
                                       err_msg=f"Module 3 {name} features do not match")
            np.testing.assert_array_equal(labels, arrays[f"y{suffix}"],
                                          err_msg=f"Module 3 {name} labels do not match")
    return split


def make_module3_split(csv_path, module3_dir, output_dir, *, labs=3,
                       alpha=0.5, partition_seed=42):
    csv_path = Path(csv_path).resolve()
    module3_dir = Path(module3_dir).resolve()
    output_dir = Path(output_dir).resolve()
    if output_dir.exists():
        raise FileExistsError(f"Refusing to overwrite: {output_dir}")
    if labs < 2 or alpha <= 0:
        raise ValueError("labs must be >= 2 and alpha must be positive")
    artifacts = {name: module3_dir / name for name in
                 ("ann.keras", "preprocessor.joblib", "arrays.npz", "meta.json")}
    for path in artifacts.values():
        if not path.is_file() or not path.stat().st_size:
            raise FileNotFoundError(f"Missing Module 3 artifact: {path}")
    meta = json.loads(artifacts["meta.json"].read_text(encoding="utf-8"))
    if meta.get("classes") != list(schema.MODEL_A_CLASSES):
        raise ValueError("Module 3 class order differs from Model A")
    prep = pp.CBCPreprocessor.load(artifacts["preprocessor.joblib"])
    if list(prep.features) != list(schema.MODEL_A_FEATURES):
        raise ValueError("Module 3 preprocessor feature order differs from Model A")
    split = _verify_arrays(csv_path, prep, artifacts["arrays.npz"])
    raw = pd.read_csv(csv_path)
    train = raw.iloc[split["X_train"].index].reset_index(drop=True)
    validation = raw.iloc[split["X_val"].index].reset_index(drop=True)
    test = raw.iloc[split["X_test"].index].reset_index(drop=True)
    shards = partition_dataframe(train, labs, mode="non_iid", alpha=alpha,
                                 seed=partition_seed)
    named = {"validation": validation}
    named.update({f"lab_{i:02d}": shard for i, shard in enumerate(shards)})
    overlap = {name: len(set(feature_group_ids(a)) & set(feature_group_ids(b)))
               for name, a, b in (("train_validation", train, validation),
                                  ("train_test", train, test),
                                  ("validation_test", validation, test))}
    output_dir.mkdir(parents=True, exist_ok=False)
    files = {}
    for name, frame in named.items():
        path = output_dir / f"{name}.csv"
        frame.to_csv(path, index=False, float_format="%.17g")
        files[name] = {"path": path.name, "rows": len(frame),
                       "sha256": sha256_file(path)}
    for i, shard in enumerate(shards):
        groups = feature_group_ids(shard)
        train_idx, hold_idx = next(GroupShuffleSplit(
            n_splits=1, test_size=0.2, random_state=42
        ).split(shard, shard["Diagnosis"], groups))
        info = files[f"lab_{i:02d}"]
        info["local_train_rows"] = len(train_idx)
        info["local_holdout_rows"] = len(hold_idx)
    manifest = {
        "purpose": "module4_saved_module3_ann_finetune_split",
        "source_sha256": sha256_file(csv_path),
        "module3_artifacts_sha256": {name: sha256_file(path)
                                     for name, path in artifacts.items()},
        "module3_split_seed": 42,
        "split_seed": 42,
        "partition_seed": partition_seed,
        "labs": labs, "mode": "non_iid", "dirichlet_alpha": alpha,
        "files": files,
        "module3_rows": {"train": len(train), "validation": len(validation),
                         "test": len(test)},
        "duplicate_groups_across_module3_splits": overlap,
        "evaluation_warning": "Module 3 already trained on the train rows and used "
                              "validation for model selection. This is a fine-tuning "
                              "and federation-flow experiment, not an independent "
                              "estimate of generalization. The historical test is "
                              "intentionally not exported by this command.",
    }
    (output_dir / "split_manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True)
    parser.add_argument("--module3-dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--labs", type=int, default=3)
    parser.add_argument("--alpha", type=float, default=0.5)
    parser.add_argument("--partition-seed", type=int, default=42)
    args = parser.parse_args()
    print(json.dumps(make_module3_split(
        args.csv, args.module3_dir, args.out, labs=args.labs,
        alpha=args.alpha, partition_seed=args.partition_seed), indent=2))


if __name__ == "__main__":
    main()
