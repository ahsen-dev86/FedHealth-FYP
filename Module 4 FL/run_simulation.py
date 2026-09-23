"""Run ANN-only federated training on a locked, duplicate-aware split."""
import argparse
import json
from pathlib import Path

import task
from aggregation import weights_sha256
from experiment_data import (load_arrays, load_split_manifest,
                             package_versions, sha256_file)
from fedhealth_ml import schema
from fl_artifacts import save_ann_checkpoint
from validation import ValidationTracker
from reproducibility import seed_all


def run_simulation(split_dir, reference_dir, output_dir, *, init="warm",
                   rounds=20, local_epochs=1, seed=42,
                   max_macro_f1_drop=0.05, max_extra_sick_healthy=0,
                   audit_dir=None):
    import flwr as fl
    from client import LabClient, _as_flower_client
    from strategy import FedHealthStrategy

    split_dir = Path(split_dir).resolve()
    reference_dir = Path(reference_dir).resolve()
    output_dir = Path(output_dir).resolve()
    if output_dir.exists():
        raise FileExistsError(f"Refusing to overwrite: {output_dir}")
    if init not in {"warm", "cold"} or rounds < 1 or local_epochs < 1:
        raise ValueError("Use warm/cold initialization and positive rounds/epochs")
    split = load_split_manifest(split_dir)
    ref = json.loads((reference_dir / "manifest.json").read_text(encoding="utf-8"))
    if ref.get("purpose") != "module4_reference_warm_start" or (
        ref["reference_sha256"] != split["files"]["reference"]["sha256"] or
        ref["validation_sha256"] != split["files"]["validation"]["sha256"]
    ):
        raise ValueError("Reference model does not belong to this split")
    prep_path = reference_dir / "preprocessor.joblib"
    if sha256_file(prep_path) != ref["sha256"]["preprocessor.joblib"]:
        raise ValueError("Reference preprocessor checksum mismatch")
    prep = task.load_or_fit_preprocessor(None, prep_path)
    prep_hash = sha256_file(prep_path)
    Xval, yval = load_arrays(split_dir / split["files"]["validation"]["path"], prep)
    seed_all(seed)
    if init == "warm":
        initial_path = reference_dir / "ann.keras"
        if sha256_file(initial_path) != ref["sha256"]["ann.keras"]:
            raise ValueError("Reference ANN checksum mismatch")
        initial_model = task.load_initial_model(initial_path)
    else:
        initial_model = task.get_model()
    initial_weights = task.get_weights(initial_model)
    tracker = ValidationTracker(task.get_model(), Xval, yval,
                                n_classes=task.N_CLASSES,
                                max_macro_f1_drop=max_macro_f1_drop,
                                max_extra_sick_healthy=max_extra_sick_healthy)
    tracker.evaluate(0, initial_weights, {})
    lab_names = [f"lab-{i:02d}" for i in range(split["labs"])]
    expected_rows = {f"lab-{i:02d}": split["files"][f"lab_{i:02d}"][
        "local_train_rows"] for i in range(split["labs"])}
    expected_holdout_rows = {f"lab-{i:02d}": split["files"][f"lab_{i:02d}"][
        "local_holdout_rows"] for i in range(split["labs"])}
    units = dict(schema.MODEL_A_UNITS)  # split source CSV is canonical

    def client_fn(context):
        config = getattr(context, "node_config", None)
        if config is None or "partition-id" not in config:
            raise ValueError("Flower did not identify the client partition")
        cid = int(config["partition-id"])
        if not 0 <= cid < len(lab_names):
            raise ValueError("Flower partition ID outside configured labs")
        shard = split_dir / split["files"][f"lab_{cid:02d}"]["path"]
        lab = LabClient(lab_names[cid], shard, prep, units=units,
                        local_epochs=local_epochs, seed=seed + cid,
                        split_seed=split["split_seed"],
                        preprocessor_sha256=prep_hash)
        return _as_flower_client(lab)

    strategy = FedHealthStrategy(
        reference_weights=initial_weights,
        allowed_lab_ids=lab_names,
        preprocessor_sha256=prep_hash,
        expected_train_rows=expected_rows,
        expected_eval_rows=expected_holdout_rows,
        audit_dir=audit_dir,
        fraction_fit=1.0, fraction_evaluate=1.0,
        min_fit_clients=len(lab_names), min_evaluate_clients=len(lab_names),
        min_available_clients=len(lab_names),
        initial_parameters=task.ndarrays_to_parameters(initial_weights),
        on_fit_config_fn=lambda r: {"server_round": int(r),
                                    "local_epochs": int(local_epochs),
                                    "seed": int(seed)},
        evaluate_fn=tracker.evaluate,
        accept_failures=False,
    )
    try:
        history = fl.simulation.start_simulation(
            client_fn=client_fn, num_clients=len(lab_names),
            config=fl.server.ServerConfig(num_rounds=rounds),
            strategy=strategy, client_resources={"num_cpus": 1, "num_gpus": 0},
        )
    finally:
        import ray
        if ray.is_initialized():
            ray.shutdown()
    expected_rounds = list(range(1, rounds + 1))
    if [item["round"] for item in strategy.round_trace] != expected_rounds:
        raise RuntimeError("Incomplete training rounds")
    if [item["round"] for item in tracker.history] != [0] + expected_rounds:
        raise RuntimeError("Incomplete central validation rounds")
    if [r for r, _ in history.losses_distributed] != expected_rounds:
        raise RuntimeError("Incomplete distributed evaluation rounds")
    if tracker.best_weights is None:
        raise RuntimeError("No eligible model was selected")
    final_model = task.get_model()
    task.set_weights(final_model, tracker.best_weights)
    if weights_sha256(task.get_weights(final_model)) != tracker.best_sha256:
        raise RuntimeError("Selected weights changed before saving")
    run_info = {
        "purpose": "module4_ann_federation", "initialization": init,
        "trained_rounds": rounds, "selected_round": tracker.best_round,
        "selected_weights_sha256": tracker.best_sha256,
        "selected_validation_metrics": tracker.best_metrics,
        "round_validation": tracker.history,
        "round_weight_trace": strategy.round_trace,
        "distributed_history": {
            "losses": history.losses_distributed,
            "metrics": history.metrics_distributed,
            "fit": history.metrics_distributed_fit,
        },
        "settings": {"labs": len(lab_names), "rounds": rounds,
                     "local_epochs": local_epochs, "seed": seed,
                     "split_seed": split["split_seed"],
                     "mode": split["mode"], "dirichlet_alpha": split["dirichlet_alpha"],
                     "max_macro_f1_drop": max_macro_f1_drop,
                     "max_extra_sick_healthy": max_extra_sick_healthy},
        "input_sha256": {name: info["sha256"] for name, info in
                         split["files"].items() if name != "locked_test"},
        "preprocessor_sha256": prep_hash,
        "reference_ann_sha256": ref["sha256"]["ann.keras"],
        "versions": package_versions(),
    }
    checkpoint = save_ann_checkpoint(final_model, prep, output_dir,
                                     run_info=run_info,
                                     expected_weight_sha256=tracker.best_sha256)
    print("Saved selected ANN:", checkpoint)
    print("Selected round:", tracker.best_round,
          "validation macro-F1:", tracker.best_metrics["macro_f1"])
    return run_info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split-dir", required=True)
    parser.add_argument("--reference-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--init", choices=["warm", "cold"], default="warm")
    parser.add_argument("--rounds", type=int, default=20)
    parser.add_argument("--local-epochs", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-macro-f1-drop", type=float, default=0.05)
    parser.add_argument("--max-extra-sick-healthy", type=int, default=0)
    parser.add_argument("--audit-dir", help="new directory for round weight arrays (smoke test)")
    args = parser.parse_args()
    run_simulation(args.split_dir, args.reference_dir, args.output_dir,
                   init=args.init, rounds=args.rounds,
                   local_epochs=args.local_epochs, seed=args.seed,
                   max_macro_f1_drop=args.max_macro_f1_drop,
                   max_extra_sick_healthy=args.max_extra_sick_healthy,
                   audit_dir=args.audit_dir)


if __name__ == "__main__":
    main()
