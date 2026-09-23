"""Create one duplicate-aware, reusable experiment split from canonical CBC data."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold, GroupShuffleSplit

from fedhealth_ml import preprocess as pp, schema
from partition import feature_group_ids, partition_dataframe


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _choose_fold(df, groups, fraction, seed, min_per_class=1):
    """Choose a stratified group fold with sufficient class coverage."""
    folds = round(1 / fraction)
    labels = df["Diagnosis"].map(schema.ANEMIA_LABEL_MAP).to_numpy()
    if pd.isna(labels).any():
        raise ValueError("Unknown Diagnosis label")
    splitter = StratifiedGroupKFold(n_splits=folds, shuffle=True,
                                    random_state=seed)
    overall = pd.Series(labels).value_counts(normalize=True)
    candidates = []
    for train, held in splitter.split(df, labels, groups):
        held_counts = pd.Series(labels[held]).value_counts()
        if any(held_counts.get(label, 0) < min_per_class
               for label in overall.index):
            continue
        held_mix = pd.Series(labels[held]).value_counts(normalize=True)
        class_difference = sum(abs(held_mix.get(c, 0) - p)
                               for c, p in overall.items())
        score = abs(len(held) / len(df) - fraction) + class_difference * 0.1
        candidates.append((score, train, held))
    if not candidates:
        raise ValueError(f"No grouped fold has at least {min_per_class} "
                         "rows of every class; use fewer reference folds, "
                         "obtain more data, or lower the declared minimum")
    _, train, held = min(candidates, key=lambda item: item[0])
    return df.iloc[train].reset_index(drop=True), df.iloc[held].reset_index(drop=True)


def _write_csv(df, path):
    df.to_csv(path, index=False, float_format="%.17g")
    return {"path": path.name, "rows": int(len(df)), "sha256": file_sha256(path),
            "classes": {str(k): int(v) for k, v in
                        df["Diagnosis"].value_counts().items()}}


def make_splits(csv_path, output_dir, *, labs=3, alpha=0.5, seed=42,
                reference_folds=3, min_reference_per_class=3):
    """Hold out 20% test, 10% validation, then 1/N of training as reference.

    The default N=3 gives the starting ANN about 300 rows on the supplied
    1,281-row CSV; the old N=5 left only one rarest-class reference row.
    """
    csv_path, output_dir = Path(csv_path).resolve(), Path(output_dir).resolve()
    if output_dir.exists():
        raise FileExistsError(f"Refusing to overwrite: {output_dir}")
    if labs < 2 or alpha <= 0 or reference_folds < 2 or min_reference_per_class < 1:
        raise ValueError("labs and reference_folds must be >= 2; alpha and "
                         "min_reference_per_class must be positive")
    raw = pd.read_csv(csv_path)
    if not set(schema.MODEL_A_FEATURES + ["Diagnosis"]).issubset(raw.columns):
        raise ValueError("CSV does not have the Model A feature and label columns")
    # The Module 3 loader is the canonical-data cleaning and label check.
    cleaned, labels = pp.load_anemia(csv_path)
    if len(cleaned) != len(raw) or labels.isna().any():
        raise ValueError("Canonical data failed Module 3 cleaning")
    test_groups = feature_group_ids(raw)
    group_audit = pd.DataFrame({"group": test_groups,
                                "label": raw["Diagnosis"]}).groupby("group").agg(
        rows=("label", "size"), labels=("label", "nunique"))
    remainder, test = _choose_fold(raw, test_groups, 0.20, seed)
    remain_groups = feature_group_ids(remainder)
    train, validation = _choose_fold(remainder, remain_groups, 0.125, seed + 1)
    train_groups = feature_group_ids(train)
    labs_source, reference = _choose_fold(
        train, train_groups, 1.0 / reference_folds, seed + 2,
        min_per_class=min_reference_per_class)
    expected_classes = set(raw["Diagnosis"])
    for name, frame, minimum in (("reference", reference, min_reference_per_class),
                                  ("labs combined", labs_source, 1),
                                  ("validation", validation, 1),
                                  ("locked test", test, 1)):
        counts = frame["Diagnosis"].value_counts()
        short = {label: int(counts.get(label, 0)) for label in expected_classes
                 if counts.get(label, 0) < minimum}
        if short:
            raise ValueError(f"{name} lacks class coverage (minimum {minimum} "
                             f"rows per class): {dict(sorted(short.items()))}")
    lab_shards = partition_dataframe(labs_source, labs, mode="non_iid",
                                      alpha=alpha, seed=seed)

    named = {"reference": reference, "validation": validation,
             "locked_test": test}
    named.update({f"lab_{i:02d}": shard for i, shard in enumerate(lab_shards)})
    group_sets = {name: set(feature_group_ids(frame)) for name, frame in named.items()}
    for name, group_set in group_sets.items():
        for other, other_set in group_sets.items():
            if name < other and group_set & other_set:
                raise RuntimeError(f"Duplicate CBC features cross {name} and {other}")
    if sum(len(frame) for frame in named.values()) != len(raw):
        raise RuntimeError("Split lost or duplicated source rows")
    for name, frame in named.items():
        if frame.empty:
            raise ValueError(f"{name} is empty")
    output_dir.mkdir(parents=True, exist_ok=False)
    files = {name: _write_csv(frame, output_dir / f"{name}.csv")
             for name, frame in named.items()}
    disk_groups = {name: set(feature_group_ids(pd.read_csv(output_dir / info["path"])))
                   for name, info in files.items()}
    for name, group_set in disk_groups.items():
        for other, other_set in disk_groups.items():
            if name < other and group_set & other_set:
                raise RuntimeError(f"Saved splits have duplicate overlap: {name}, {other}")
    for i in range(labs):
        shard = pd.read_csv(output_dir / f"lab_{i:02d}.csv")
        group_ids = feature_group_ids(shard)
        train_idx, held_idx = next(GroupShuffleSplit(
            n_splits=1, test_size=0.2, random_state=seed
        ).split(shard, shard["Diagnosis"], group_ids))
        files[f"lab_{i:02d}"]["local_train_rows"] = int(len(train_idx))
        files[f"lab_{i:02d}"]["local_holdout_rows"] = int(len(held_idx))
    manifest = {
        "purpose": "module4_duplicate_aware_split",
        "source_sha256": file_sha256(csv_path),
        "split_seed": int(seed), "labs": int(labs), "mode": "non_iid",
        "dirichlet_alpha": float(alpha),
        "target_fractions": {"test_total": 0.20, "validation_total": 0.10,
                             "reference_of_remaining_training":
                             1.0 / reference_folds},
        "reference_folds": int(reference_folds),
        "min_reference_per_class": int(min_reference_per_class),
        "actual_rows": {name: int(len(frame)) for name, frame in named.items()},
        "source_audit": {
            "rows": int(len(raw)),
            "class_counts": {str(k): int(v) for k, v in
                             raw["Diagnosis"].value_counts().items()},
            "duplicate_feature_groups": int((group_audit["rows"] > 1).sum()),
            "rows_in_duplicate_feature_groups": int(group_audit.loc[
                group_audit["rows"] > 1, "rows"].sum()),
            "conflicting_label_groups": int((group_audit["labels"] > 1).sum()),
            "rows_with_missing_after_cleaning": int(cleaned.isna().any(axis=1).sum()),
            "patient_ids_available": False,
        },
        "evaluation_limit": "Rare classes have very small validation/test "
                            "support; report per-class counts and avoid "
                            "treating one split as a precise clinical estimate.",
        "grouping": "SHA-256 of Module 3 cleaned Model A feature vector; labels ignored",
        "files": files,
    }
    (output_dir / "split_manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--labs", type=int, default=3)
    parser.add_argument("--alpha", type=float, default=0.5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--reference-folds", type=int, default=3,
                        help="reserve roughly 1/N of training for the starting ANN")
    parser.add_argument("--min-reference-per-class", type=int, default=3)
    args = parser.parse_args()
    result = make_splits(args.csv, args.out, labs=args.labs,
                         alpha=args.alpha, seed=args.seed,
                         reference_folds=args.reference_folds,
                         min_reference_per_class=args.min_reference_per_class)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
