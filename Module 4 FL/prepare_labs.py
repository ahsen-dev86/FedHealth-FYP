"""Offline benchmark setup: export lab-only training shards and server validation."""
import argparse
from pathlib import Path
from fedhealth_ml.data import Dataset, sha256
from fedhealth_ml.training import DEFAULT_CSV, DEFAULT_PROVENANCE
from fedhealth_ml.artifacts import inspect_bundle
from fedhealth_ml.runtime import write_json
from partition import partition_dataframe


def prepare(dataset, model, output, *, labs=3, mode="iid", alpha=.5, seed=42):
    output, model = Path(output), Path(model)
    meta, _ = inspect_bundle(model, data_sha256=dataset.sha256)
    if meta["origin"] != "centralized" or meta["training"]["seed"] != seed:
        raise ValueError("Seed/model mismatch")
    shards = partition_dataframe(dataset.rows("train"), labs, mode, seed, alpha, dataset.provenance)
    output.mkdir(parents=True, exist_ok=False)
    counts, hashes = {}, {}
    for i, frame in enumerate(shards):
        lab = f"lab-{i:02d}"
        frame.to_csv(output / f"{lab}.csv", index=False)
        counts[lab] = len(frame)
        hashes[lab] = sha256(output / f"{lab}.csv")
    dataset.rows("val").to_csv(output / "validation.csv", index=False)
    write_json(output / "plan.json", {"data_sha256": dataset.sha256,
        "preprocessor_sha256": sha256(model / "preprocessor.joblib"),
        "model_manifest_sha256": sha256(model / "manifest.json"),
        "validation_sha256": sha256(output / "validation.csv"),
        "train_rows": counts, "shard_sha256": hashes,
        "seed": seed, "mode": mode, "alpha": alpha, "labs": labs})
    return output


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--labs", type=int, default=3)
    ap.add_argument("--mode", choices=["iid", "non_iid", "source"], default="iid")
    ap.add_argument("--alpha", type=float, default=.5)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    prepare(Dataset(DEFAULT_CSV, DEFAULT_PROVENANCE), args.model, args.out,
            labs=args.labs, mode=args.mode, alpha=args.alpha, seed=args.seed)
