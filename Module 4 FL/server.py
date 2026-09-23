"""Standalone Flower coordinator with the same selection rules as simulation."""
import argparse
import json
import os
from pathlib import Path

import task
from aggregation import weights_sha256
from experiment_data import load_arrays, package_versions, sha256_file
from fl_artifacts import save_ann_checkpoint
from validation import ValidationTracker
from reproducibility import seed_all


def fit_config(server_round, local_epochs=1, seed=42):
    return {"server_round": int(server_round),
            "local_epochs": int(local_epochs), "seed": int(seed)}


def load_certificates(ca_path, server_path, key_path, *, insecure_dev=False):
    provided = [ca_path, server_path, key_path]
    if insecure_dev:
        if any(provided):
            raise ValueError("Do not mix --insecure-dev with TLS certificate paths")
        return None
    if not all(provided):
        raise ValueError("All three TLS certificates are required; otherwise use --insecure-dev")
    paths = [Path(path) for path in provided]
    if not all(path.is_file() for path in paths):
        raise FileNotFoundError("A configured TLS certificate or key is missing")
    return tuple(path.read_bytes() for path in paths)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--address", default=os.environ.get("FL_BIND", "0.0.0.0:8080"))
    parser.add_argument("--rounds", type=int, default=int(os.environ.get("FL_ROUNDS", "20")))
    parser.add_argument("--labs", type=int, default=int(os.environ.get("FL_LABS", "3")))
    parser.add_argument("--local-epochs", type=int,
                        default=int(os.environ.get("LOCAL_EPOCHS", "1")))
    parser.add_argument("--seed", type=int, default=int(os.environ.get("FL_SEED", "42")))
    parser.add_argument("--init", choices=["warm", "cold"], default="warm")
    parser.add_argument("--reference-dir", required=True)
    parser.add_argument("--split-manifest", required=True,
                        help="split_manifest.json; raw lab files stay with labs")
    parser.add_argument("--validation-csv", required=True)
    parser.add_argument("--max-macro-f1-drop", type=float, default=0.05)
    parser.add_argument("--max-extra-sick-healthy", type=int, default=0)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--ca-cert", default=os.environ.get("FL_CA_CERT"))
    parser.add_argument("--server-cert", default=os.environ.get("FL_SERVER_CERT"))
    parser.add_argument("--server-key", default=os.environ.get("FL_SERVER_KEY"))
    parser.add_argument("--insecure-dev", action="store_true")
    args = parser.parse_args()
    if args.labs < 2 or args.rounds < 1 or args.local_epochs < 1:
        parser.error("Use at least 2 labs and positive rounds/local epochs")
    output_dir = Path(args.output_dir).resolve()
    if output_dir.exists():
        parser.error(f"Refusing to overwrite: {output_dir}")
    certificates = load_certificates(args.ca_cert, args.server_cert,
                                     args.server_key,
                                     insecure_dev=args.insecure_dev)

    import flwr as fl
    from strategy import FedHealthStrategy

    split = json.loads(Path(args.split_manifest).read_text(encoding="utf-8"))
    if split.get("purpose") != "module4_duplicate_aware_split" or (
        args.labs != split["labs"]
    ):
        raise ValueError("Lab count does not match the split manifest")
    if sha256_file(args.validation_csv) != split["files"]["validation"]["sha256"]:
        raise ValueError("Validation CSV checksum mismatch")
    reference_dir = Path(args.reference_dir)
    ref = json.loads((reference_dir / "manifest.json").read_text(encoding="utf-8"))
    if ref["reference_sha256"] != split["files"]["reference"]["sha256"]:
        raise ValueError("Reference model does not belong to the split")
    prep_path = reference_dir / "preprocessor.joblib"
    prep_hash = sha256_file(prep_path)
    if prep_hash != ref["sha256"]["preprocessor.joblib"]:
        raise ValueError("Preprocessor checksum mismatch")
    prep = task.load_or_fit_preprocessor(None, prep_path)
    Xval, yval = load_arrays(args.validation_csv, prep)
    seed_all(args.seed)
    if args.init == "warm":
        ann_path = reference_dir / "ann.keras"
        if sha256_file(ann_path) != ref["sha256"]["ann.keras"]:
            raise ValueError("Reference ANN checksum mismatch")
        initial = task.load_initial_model(ann_path)
    else:
        initial = task.get_model()
    initial_weights = task.get_weights(initial)
    tracker = ValidationTracker(task.get_model(), Xval, yval,
                                n_classes=task.N_CLASSES,
                                max_macro_f1_drop=args.max_macro_f1_drop,
                                max_extra_sick_healthy=args.max_extra_sick_healthy)
    tracker.evaluate(0, initial_weights, {})
    lab_ids = [f"lab-{i:02d}" for i in range(args.labs)]
    expected_rows = {f"lab-{i:02d}": split["files"][f"lab_{i:02d}"][
        "local_train_rows"] for i in range(args.labs)}
    expected_holdout_rows = {f"lab-{i:02d}": split["files"][f"lab_{i:02d}"][
        "local_holdout_rows"] for i in range(args.labs)}
    strategy = FedHealthStrategy(
        reference_weights=initial_weights,
        allowed_lab_ids=lab_ids, preprocessor_sha256=prep_hash,
        expected_train_rows=expected_rows,
        expected_eval_rows=expected_holdout_rows,
        fraction_fit=1.0, fraction_evaluate=1.0,
        min_fit_clients=args.labs, min_evaluate_clients=args.labs,
        min_available_clients=args.labs,
        initial_parameters=task.ndarrays_to_parameters(initial_weights),
        on_fit_config_fn=lambda r: fit_config(r, args.local_epochs, args.seed),
        evaluate_fn=tracker.evaluate, accept_failures=False,
    )
    history = fl.server.start_server(
        server_address=args.address,
        config=fl.server.ServerConfig(num_rounds=args.rounds),
        strategy=strategy, certificates=certificates,
    )
    expected_rounds = list(range(1, args.rounds + 1))
    if [r["round"] for r in strategy.round_trace] != expected_rounds or (
        [r["round"] for r in tracker.history] != [0] + expected_rounds
    ) or [r for r, _ in history.losses_distributed] != expected_rounds:
        raise RuntimeError("Standalone run did not complete all rounds")
    selected = task.get_model()
    task.set_weights(selected, tracker.best_weights)
    if weights_sha256(task.get_weights(selected)) != tracker.best_sha256:
        raise RuntimeError("Selected weights changed before saving")
    info = {
        "purpose": "module4_ann_federation_standalone",
        "initialization": args.init, "trained_rounds": args.rounds,
        "selected_round": tracker.best_round,
        "selected_weights_sha256": tracker.best_sha256,
        "selected_validation_metrics": tracker.best_metrics,
        "round_validation": tracker.history,
        "round_weight_trace": strategy.round_trace,
        "settings": {"labs": args.labs, "rounds": args.rounds,
                     "local_epochs": args.local_epochs, "seed": args.seed,
                     "split_seed": split["split_seed"],
                     "dirichlet_alpha": split["dirichlet_alpha"],
                     "max_macro_f1_drop": args.max_macro_f1_drop,
                     "max_extra_sick_healthy": args.max_extra_sick_healthy,
                     "transport": "tls" if certificates else "insecure_dev"},
        "split_manifest_sha256": sha256_file(args.split_manifest),
        "preprocessor_sha256": prep_hash,
        "versions": package_versions(),
    }
    saved = save_ann_checkpoint(selected, prep, output_dir, run_info=info,
                                expected_weight_sha256=tracker.best_sha256)
    print("Saved selected ANN:", saved)


if __name__ == "__main__":
    main()
