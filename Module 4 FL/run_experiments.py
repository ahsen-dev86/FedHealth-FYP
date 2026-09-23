"""Run warm/cold FedAvg, local-only and centralized ANN comparisons.

Only the shared validation split is read. Full 20-round runs belong in Colab.
"""
import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

import task
from experiment_data import load_arrays, load_split_manifest, package_versions
from fedhealth_ml import models, schema
from validation import ValidationTracker
from reproducibility import seed_all


SCORES = ("accuracy", "balanced_accuracy", "macro_f1", "weighted_f1",
          "log_loss", "sick_called_healthy")


def _local_arrays(split_dir, split, prep):
    for i in range(split["labs"]):
        name = f"lab_{i:02d}"
        path = split_dir / split["files"][name]["path"]
        yield name, task.load_partition_data(
            path, prep, dict(schema.MODEL_A_UNITS),
            seed=split["split_seed"])


def _train_comparator(initial_model_path, Xtr, ytr, Xval, yval, *,
                      epochs, seed, max_macro_f1_drop,
                      max_extra_sick_healthy):
    import tensorflow as tf

    seed_all(seed)
    model = task.load_initial_model(initial_model_path)
    tracker = ValidationTracker(task.get_model(), Xval, yval,
                                n_classes=task.N_CLASSES,
                                max_macro_f1_drop=max_macro_f1_drop,
                                max_extra_sick_healthy=max_extra_sick_healthy)
    tracker.evaluate(0, task.get_weights(model), {})
    weights = models.class_weights(ytr, task.N_CLASSES)
    for epoch in range(1, epochs + 1):
        model.fit(Xtr, ytr, epochs=1, batch_size=32,
                  class_weight=weights, verbose=0)
        tracker.evaluate(epoch, task.get_weights(model), {})
    metrics, selected_round = tracker.best_metrics, tracker.best_round
    del model, tracker
    tf.keras.backend.clear_session()
    return metrics, selected_round


def _row(method, seed, best_metrics, best_round, *, lab=None):
    confusion = np.asarray(best_metrics["confusion_matrix"])
    supports = confusion.sum(axis=1)
    counts = {schema.MODEL_A_CLASSES[i]: f"{int(confusion[i, i])}/{int(supports[i])}"
              for i in range(len(supports))}
    return {"method": method, "seed": int(seed), "lab": lab or "",
            "selected_round": int(best_round),
            **{name: float(best_metrics[name]) for name in SCORES},
            "per_class_recall_counts": json.dumps(counts, sort_keys=True)}


def summarize(rows):
    """Mean and sample standard deviation across independent seeds."""
    summary = {}
    for method in sorted({row["method"] for row in rows}):
        candidates = [row for row in rows if row["method"] == method]
        seeds = sorted({row["seed"] for row in candidates})
        per_seed = []
        for seed in seeds:
            selected = [row for row in candidates if row["seed"] == seed]
            per_seed.append({score: float(np.mean([r[score] for r in selected]))
                             for score in SCORES})
        summary[method] = {
            "seeds": seeds,
            "scores": {score: {
                "mean": float(np.mean([row[score] for row in per_seed])),
                "std": float(np.std([row[score] for row in per_seed], ddof=1))
                if len(per_seed) > 1 else 0.0,
            } for score in SCORES},
        }
    return summary


def run_experiments(split_dir, output_dir, *,
                    seeds=(42, 52, 62), rounds=20, local_epochs=1,
                    reference_epochs=100, reference_patience=10,
                    max_macro_f1_drop=0.05, max_extra_sick_healthy=0):
    split_dir = Path(split_dir).resolve()
    output_dir = Path(output_dir).resolve()
    if output_dir.exists():
        raise FileExistsError(f"Refusing to overwrite: {output_dir}")
    if len(set(seeds)) != len(seeds) or 42 not in seeds:
        raise ValueError("Provide distinct seeds including predeclared seed 42")
    split = load_split_manifest(split_dir)
    output_dir.mkdir(parents=True, exist_ok=False)
    rows = []
    for seed in seeds:
        reference_dir = output_dir / f"reference_seed{seed}"
        subprocess.run([
            sys.executable, str(Path(__file__).with_name("train_reference.py")),
            "--split-dir", str(split_dir), "--out", str(reference_dir),
            "--seed", str(seed), "--epochs", str(reference_epochs),
            "--patience", str(reference_patience),
        ], check=True)
        prep = task.load_or_fit_preprocessor(None, reference_dir / "preprocessor.joblib")
        Xval, yval = load_arrays(
            split_dir / split["files"]["validation"]["path"], prep)
        local_data = list(_local_arrays(split_dir, split, prep))
        all_X = np.concatenate([data[0] for _, data in local_data])
        all_y = np.concatenate([data[1] for _, data in local_data])
        for init in ("warm", "cold"):
            method = f"{init}_fedavg"
            model_dir = output_dir / f"{method}_seed{seed}"
            subprocess.run([
                sys.executable, str(Path(__file__).with_name("run_simulation.py")),
                "--split-dir", str(split_dir),
                "--reference-dir", str(reference_dir),
                "--output-dir", str(model_dir),
                "--init", init, "--rounds", str(rounds),
                "--local-epochs", str(local_epochs), "--seed", str(seed),
                "--max-macro-f1-drop", str(max_macro_f1_drop),
                "--max-extra-sick-healthy", str(max_extra_sick_healthy),
            ], check=True)
            info = json.loads((model_dir / "manifest.json").read_text(
                encoding="utf-8"))["run_info"]
            rows.append(_row(method, seed, info["selected_validation_metrics"],
                             info["selected_round"]))
        for index, (name, data) in enumerate(local_data):
            Xtr, ytr, _, _ = data
            metrics, chosen = _train_comparator(
                reference_dir / "ann.keras", Xtr, ytr, Xval, yval,
                epochs=rounds * local_epochs, seed=seed + index,
                max_macro_f1_drop=max_macro_f1_drop,
                max_extra_sick_healthy=max_extra_sick_healthy)
            rows.append(_row("local_only_warm", seed, metrics, chosen, lab=name))
        metrics, chosen = _train_comparator(
            reference_dir / "ann.keras", all_X, all_y, Xval, yval,
            epochs=rounds * local_epochs, seed=seed,
            max_macro_f1_drop=max_macro_f1_drop,
            max_extra_sick_healthy=max_extra_sick_healthy)
        rows.append(_row("centralized_warm", seed, metrics, chosen))
    with (output_dir / "results.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    report = {
        "purpose": "module4_validation_only_comparison",
        "integration_candidate": "warm_fedavg_seed42",
        "integration_seed_predeclared": 42,
        "settings": {"seeds": list(seeds), "rounds": rounds,
                     "local_epochs": local_epochs,
                     "reference_epochs": reference_epochs,
                     "reference_patience": reference_patience,
                     "split_seed": split["split_seed"],
                     "dirichlet_alpha": split["dirichlet_alpha"],
                     "max_macro_f1_drop": max_macro_f1_drop,
                     "max_extra_sick_healthy": max_extra_sick_healthy},
        "comparison_note": "Centralized is a comparator, not a guaranteed upper bound. "
                           "Local-only rows are separate models per lab.",
        "summary": summarize(rows), "versions": package_versions(),
    }
    (output_dir / "results.json").write_text(json.dumps(report, indent=2),
                                              encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--seeds", type=int, nargs="+", default=[42, 52, 62])
    parser.add_argument("--rounds", type=int, default=20)
    parser.add_argument("--local-epochs", type=int, default=1)
    parser.add_argument("--reference-epochs", type=int, default=100)
    parser.add_argument("--reference-patience", type=int, default=10)
    parser.add_argument("--max-macro-f1-drop", type=float, default=0.05)
    parser.add_argument("--max-extra-sick-healthy", type=int, default=0)
    args = parser.parse_args()
    result = run_experiments(
        args.split_dir, args.output_dir,
        seeds=args.seeds, rounds=args.rounds, local_epochs=args.local_epochs,
        reference_epochs=args.reference_epochs,
        reference_patience=args.reference_patience,
        max_macro_f1_drop=args.max_macro_f1_drop,
        max_extra_sick_healthy=args.max_extra_sick_healthy)
    print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    main()
