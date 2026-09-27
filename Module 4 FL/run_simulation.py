"""Memory-bounded sequential Flower simulation; same client/strategy as gRPC.

Runs an entire federated experiment (partition -> per-round local training ->
FedAvg aggregation -> global validation) in a single process by calling each
LabClient and FedHealthStrategy directly, round after round, instead of
spinning up a real gRPC server/clients. Uses the exact same client and
strategy code as the real server.py deployment, so simulation results
transfer to the real deployment.
"""
import argparse
from pathlib import Path
import numpy as np
from flwr.common import Code, Status, FitRes, EvaluateRes, ndarrays_to_parameters, parameters_to_ndarrays  # flwr: Flower federated-learning framework's data types
from fedhealth_ml import schema
from fedhealth_ml.artifacts import load_bundle
from fedhealth_ml.data import Dataset, sha256
from fedhealth_ml.runtime import seed_all, write_json
from fedhealth_ml.training import DEFAULT_CSV, DEFAULT_PROVENANCE
from aggregation import weights_sha256
from client import LabClient
from partition import partition_dataframe
from strategy import FedHealthStrategy
from validation import ValidationTracker
from fl_artifacts import finish_run


def run(dataset, model_dir, output, *, rounds=20, labs=3, mode="iid", alpha=.5,
        seed=42, local_epochs=1, lr=.0001, audit=True):
    """Simulate one full federated run: load and verify the round-zero
    centralized ANN, partition the training rows into `labs` shards, then for
    `rounds` rounds have every lab fit locally, aggregate their updates with
    FedAvg (FedHealthStrategy), and evaluate the new global weights on the
    held-out validation split (ValidationTracker). Finishes by saving the
    tracker's selected round through finish_run(). Returns the saved model path."""
    if rounds < 1:
        raise ValueError("At least one federated round is required")
    model_dir, output = Path(model_dir), Path(output)
    prep, hybrid, meta = load_bundle(model_dir, data_sha256=dataset.sha256)
    if meta["origin"] != "centralized" or meta["training"]["seed"] != seed:
        raise ValueError("Use the same seed's centralized Module 3 ANN as round zero")
    if meta["fit_row_ids"] != dataset.rows("train").row_id.tolist():
        raise ValueError("Module 3 training split mismatch")
    output.mkdir(parents=True, exist_ok=False)
    seed_all(seed)
    shards = partition_dataframe(dataset.rows("train"), labs, mode, seed, alpha, dataset.provenance)
    prep_hash = sha256(model_dir / "preprocessor.joblib")
    allowed = [f"lab-{i:02d}" for i in range(labs)]
    counts = {lab: len(shard) for lab, shard in zip(allowed, shards)}
    clients = [LabClient(lab, frame, prep, units=schema.UNITS, architecture=hybrid.ann.to_json(),
               preprocessor_sha256=prep_hash, seed=seed, local_epochs=local_epochs, lr=lr) for lab, frame in zip(allowed, shards)]
    Xv, yv = dataset.xy("val", prep)
    tracker = ValidationTracker(hybrid.ann, Xv, yv, n_classes=4)
    weights = hybrid.ann.get_weights()
    initial_hash = weights_sha256(weights)
    strategy = FedHealthStrategy(reference_weights=weights, allowed_lab_ids=allowed,
        preprocessor_sha256=prep_hash, expected_train_rows=counts, expected_eval_rows=counts,
        initial_parameters=ndarrays_to_parameters(weights), min_fit_clients=labs,
        training_config={"seed": seed, "local_epochs": local_epochs, "batch_size": 32, "lr": lr},
        min_evaluate_clients=labs, min_available_clients=labs, accept_failures=False,
        audit_dir=output / "audit_weights" if audit else None)
    tracker.evaluate(0, weights, {})  # round zero: validate the untouched centralized ANN as the baseline
    diagnostics = []
    ok = Status(code=Code.OK, message="")
    for round_number in range(1, rounds + 1):
        results = []
        config = strategy.fit_config(round_number)
        for client in clients:
            # Every lab trains locally on the same global weights, wrapped as a Flower FitRes like a real client would return.
            updated, count, metrics = client.fit(weights, config)
            results.append((None, FitRes(status=ok, parameters=ndarrays_to_parameters(updated), num_examples=count, metrics=metrics)))
        params, _ = strategy.aggregate_fit(round_number, results, [])  # FedAvg across all labs' updates
        weights = parameters_to_ndarrays(params)
        tracker.evaluate(round_number, weights, {})  # global held-out validation of the newly aggregated weights
        evaluations = []
        for client in clients:
            loss, count, metrics = client.evaluate(weights, {})
            evaluations.append((None, EvaluateRes(status=ok, loss=loss, num_examples=count, metrics=metrics)))
        loss, metrics = strategy.aggregate_evaluate(round_number, evaluations, [])
        diagnostics.append({"round": round_number, "split": "local training diagnostics, not held-out", "loss": loss, **metrics})
    if tracker.history[0]["weights_sha256"] != initial_hash:
        raise RuntimeError("Round zero differs from saved Module 3 weights")
    settings = {"seed": seed, "mode": mode, "alpha": alpha if mode == "non_iid" else None,
                "labs": labs, "rounds": rounds, "local_epochs": local_epochs, "batch_size": 32,
                "lr": lr, "optimizer": "fresh Adam per lab per round", "train_rows": counts,
                "all_labs_each_round": True, "runtime": "sequential Flower callbacks", "test_used": False}
    write_json(output / "training_diagnostics.json", diagnostics)
    return finish_run(output, tracker, strategy, prep, meta, model_dir, Xv, yv, settings,
                      hybrid_train=dataset.xy("train", prep))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--rounds", type=int, default=20)
    ap.add_argument("--labs", type=int, default=3)
    ap.add_argument("--mode", choices=["iid", "non_iid", "source"], default="iid")
    ap.add_argument("--alpha", type=float, default=.5)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--local-epochs", type=int, default=1)
    args = ap.parse_args()
    run(Dataset(args.csv, args.provenance), args.model, args.out, rounds=args.rounds,
        labs=args.labs, mode=args.mode, alpha=args.alpha, seed=args.seed, local_epochs=args.local_epochs)


if __name__ == "__main__":
    main()
