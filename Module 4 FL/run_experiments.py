"""Predeclared validation-only experiment matrix. Never choose the best seed.

Runs the full seed x partition-scenario grid (fixed up front in
`configurations`) so results are reported for every combination, not
cherry-picked. For each seed it trains (or reuses) one centralized model, then
runs every federated partition scenario against it, and finally assembles the
frozen final_evaluation_plan.json consumed once by final_evaluate.py.
"""
import argparse
import json
from pathlib import Path
from fedhealth_ml.data import Dataset, sha256
from fedhealth_ml.training import DEFAULT_CSV, DEFAULT_PROVENANCE, train
from fedhealth_ml.runtime import write_json
from run_simulation import run


def suite(dataset, root, *, seeds=(42, 52, 62), rounds=20, epochs=100):
    """Run the predeclared experiment matrix: for each seed, train/reuse a
    centralized model, then run every (iid / non_iid alpha=.5 / non_iid
    alpha=.1 / source) federated scenario against it, collecting validation
    metrics into validation_comparison.json and a hash-locked model list into
    final_evaluation_plan.json. Refuses to run twice into the same `root`."""
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    plan_file = root / "experiment_plan.json"
    if plan_file.exists():
        raise FileExistsError("Experiment matrix already started; use a new output root")
    # Each tuple: (experiment name, partition mode, Dirichlet alpha, number of labs).
    configurations = [("iid", "iid", .5, 3), ("non_iid_05", "non_iid", .5, 3),
                      ("non_iid_01", "non_iid", .1, 3), ("source", "source", .5, 5)]
    write_json(plan_file, {"data_sha256": dataset.sha256, "seeds": list(seeds), "rounds": rounds,
                          "epochs_max": epochs, "configurations": configurations, "integration_seed": 42})
    models, table = [], []
    for seed in seeds:
        central = root / f"seed{seed}" / "centralized"
        if central.exists():
            # Notebook 03 may already have produced seed 42. Verify, do not overwrite.
            from fedhealth_ml.artifacts import inspect_bundle
            meta, _ = inspect_bundle(central / "model", data_sha256=dataset.sha256)
            if meta["origin"] != "centralized" or meta["training"]["seed"] != seed or meta["training"]["epochs_max"] != epochs:
                raise ValueError("Existing centralized run uses a different protocol")
        else:
            train(dataset, central, seed=seed, epochs=epochs)
        entries = [("centralized", central / "model")]
        for name, mode, alpha, labs in configurations:
            result = run(dataset, central / "model", root / f"seed{seed}" / name,
                         seed=seed, mode=mode, alpha=alpha, labs=labs, rounds=rounds)
            entries.append((name, result))
        for name, path in entries:
            metric = json.loads((path.parent / "validation_metrics.json").read_text())
            table.append({"seed": seed, "experiment": name, "split": "val", "metrics": metric["metrics"]})
            models.append({"name": f"seed{seed}_{name}", "path": str(path.resolve()),
                           "manifest_sha256": sha256(path / "manifest.json"),
                           "baselines_manifest_sha256": sha256(path.parent / "baselines_manifest.json") if name == "centralized" else None})
    write_json(root / "validation_comparison.json", table)
    write_json(root / "final_evaluation_plan.json", {"data_sha256": dataset.sha256, "models": models,
               "policy": "Fixed models across all seeds/scenarios; final test once; no selection from test"})
    return table


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--seeds", type=int, nargs="+", default=[42, 52, 62])
    ap.add_argument("--rounds", type=int, default=20)
    ap.add_argument("--epochs", type=int, default=100)
    args = ap.parse_args()
    suite(Dataset(DEFAULT_CSV, DEFAULT_PROVENANCE), args.out, seeds=args.seeds, rounds=args.rounds, epochs=args.epochs)
