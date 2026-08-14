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
import os
import sys

import numpy as np
import pandas as pd

# Make the shared fedhealth_ml package importable (repo layout: ../../ml).
_ML = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ml"))
if _ML not in sys.path:
    sys.path.insert(0, _ML)
from fedhealth_ml import schema  # noqa: E402


def partition_dataframe(df, num_labs, mode="iid", label_col="Diagnosis",
                        alpha=0.5, seed=42):
    """Return a list of `num_labs` DataFrames (the per-lab shards)."""
    rng = np.random.default_rng(seed)
    df = df.reset_index(drop=True)

    if mode == "iid":
        # Stratified round-robin: shuffle within each class, deal to labs in turn.
        shards = [[] for _ in range(num_labs)]
        for _, grp in df.groupby(label_col):
            idx = grp.sample(frac=1.0, random_state=seed).index.to_numpy()
            for j, i in enumerate(idx):
                shards[j % num_labs].append(i)
        return [df.loc[s].reset_index(drop=True) for s in shards]

    if mode == "non_iid":
        # Dirichlet class-skew: each lab draws a different class proportion.
        shards = [[] for _ in range(num_labs)]
        for _, grp in df.groupby(label_col):
            idx = grp.sample(frac=1.0, random_state=seed).index.to_numpy()
            proportions = rng.dirichlet([alpha] * num_labs)
            cuts = (np.cumsum(proportions) * len(idx)).astype(int)[:-1]
            for j, chunk in enumerate(np.split(idx, cuts)):
                shards[j].extend(chunk.tolist())
        return [df.loc[s].sample(frac=1.0, random_state=seed).reset_index(drop=True)
                for s in shards]

    raise ValueError(f"unknown mode: {mode}")


def write_shards(csv_path, out_dir, num_labs, mode="iid", label_col="Diagnosis", seed=42):
    """Partition a CSV and write lab_00.csv .. lab_NN.csv into out_dir."""
    os.makedirs(out_dir, exist_ok=True)
    df = pd.read_csv(csv_path)
    shards = partition_dataframe(df, num_labs, mode=mode, label_col=label_col, seed=seed)
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
    args = ap.parse_args()
    print(f"Partitioning {args.csv} into {args.labs} {args.mode} labs:")
    write_shards(args.csv, args.out, args.labs, mode=args.mode, label_col=args.label_col)
