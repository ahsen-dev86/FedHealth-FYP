# fl/common/partition.py
# ---------------------------------------------------------------------------
# Splits ONE central dataset into N per-lab shards so we can simulate a
# federation on a single machine (we don't have real multi-lab access — this is
# the sanctioned FYP simplification). Each shard stands in for "the data that
# already lives inside lab i" and never moves; only model weights move.
#
# Two partition modes:
#   * iid      — each lab gets a random, class-stratified slice (labs look alike)
#   * non_iid  — each lab's class mix is skewed via a Dirichlet split, so labs
#                are heterogeneous. This is the realistic, harder case for FedAvg
#                and a good thing to demonstrate at defense.
# ---------------------------------------------------------------------------
import argparse
import hashlib
import json
import os

import numpy as np
import pandas as pd

# Make the shared fedhealth_ml package importable (repo layout: ../../ml).
from fedhealth_ml import schema  # noqa: E402
from fedhealth_ml import preprocess as pp  # noqa: E402


def feature_group_ids(df):
    """Group equal canonical CBC feature vectors, regardless of their labels."""
    clean = pp.clean_ranges(df, schema.MODEL_A_FEATURES)
    keys = []
    for row in clean.itertuples(index=False, name=None):
        # Six decimals make the grouping stable across CSV save/reload. This
        # can group near-identical CBCs, which is conservative for leakage.
        values = [None if pd.isna(value) else round(float(value), 6)
                  for value in row]
        encoded = json.dumps(values, separators=(",", ":"), allow_nan=False)
        keys.append(hashlib.sha256(encoded.encode("utf-8")).hexdigest())
    return np.asarray(keys)


def partition_dataframe(df, num_labs, mode="iid", label_col="Diagnosis",
                        alpha=0.5, seed=42):
    """Return disjoint lab shards, keeping duplicate feature rows together."""
    if num_labs < 2 or alpha <= 0:
        raise ValueError("num_labs must be >= 2 and alpha must be positive")
    if label_col not in df:
        raise ValueError(f"Missing label column: {label_col}")
    rng = np.random.default_rng(seed)
    df = df.reset_index(drop=True)
    groups = feature_group_ids(df)
    group_rows = {}
    for row_index, group_id in enumerate(groups):
        group_rows.setdefault(group_id, []).append(row_index)
    by_class = {}
    for group_id, rows in group_rows.items():
        # A conflicting label is kept in the same lab; the majority label is
        # only used to allocate the group across labs.
        label = df.loc[rows, label_col].mode().iloc[0]
        by_class.setdefault(label, []).append(group_id)
    shards = [[] for _ in range(num_labs)]

    if mode == "iid":
        for label in sorted(by_class):
            for group_id in rng.permutation(by_class[label]):
                target = min(range(num_labs), key=lambda i: len(shards[i]))
                shards[target].extend(group_rows[group_id])
    elif mode == "non_iid":
        for label in sorted(by_class):
            ids = rng.permutation(by_class[label])
            proportions = rng.dirichlet([alpha] * num_labs)
            cuts = (np.cumsum(proportions) * len(ids)).astype(int)[:-1]
            for target, chunk in enumerate(np.split(ids, cuts)):
                for group_id in chunk:
                    shards[target].extend(group_rows[group_id])
    else:
        raise ValueError(f"unknown mode: {mode}")
    if any(not rows for rows in shards):
        raise ValueError("Partition produced an empty lab; choose another seed or alpha")
    return [df.loc[rng.permutation(rows)].reset_index(drop=True) for rows in shards]


def write_shards(csv_path, out_dir, num_labs, mode="iid", label_col="Diagnosis",
                 seed=42, alpha=0.5):
    """Partition a CSV and write lab_00.csv .. lab_NN.csv into out_dir."""
    if os.path.exists(out_dir):
        raise FileExistsError(f"Refusing to overwrite shard directory: {out_dir}")
    df = pd.read_csv(csv_path)
    shards = partition_dataframe(df, num_labs, mode=mode, label_col=label_col,
                                 seed=seed, alpha=alpha)
    os.makedirs(out_dir, exist_ok=False)
    paths = []
    for i, shard in enumerate(shards):
        p = os.path.join(out_dir, f"lab_{i:02d}.csv")
        shard.to_csv(p, index=False)
        paths.append(p)
        print(f"  lab_{i:02d}: {len(shard):4d} rows  "
              f"(classes: {shard[label_col].nunique()})")
    return paths


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Partition a CBC dataset into lab shards")
    ap.add_argument("--csv", default="../../ml/../anemia_diagnosed_cbc_data_v4.csv",
                    help="path to the source CSV")
    ap.add_argument("--out", default="./client/data", help="output dir for shards")
    ap.add_argument("--labs", type=int, default=4)
    ap.add_argument("--mode", choices=["iid", "non_iid"], default="iid")
    ap.add_argument("--label-col", default="Diagnosis")
    ap.add_argument("--alpha", type=float, default=0.5)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    print(f"Partitioning {args.csv} into {args.labs} {args.mode} labs:")
    write_shards(args.csv, args.out, args.labs, mode=args.mode,
                 label_col=args.label_col, seed=args.seed, alpha=args.alpha)
