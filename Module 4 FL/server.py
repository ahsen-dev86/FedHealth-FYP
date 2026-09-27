"""Separate-process Flower coordinator. Receives no lab training records.

Real multi-process deployment of the Module 4 server: starts a Flower gRPC
server (optionally over TLS) that only ever exchanges ANN weights and metrics
with lab client processes (client.py) — it holds the global validation set
and the FedHealthStrategy, but never sees any lab's raw CBC rows.
"""
import argparse
import json
from pathlib import Path
import pandas as pd
import flwr as fl  # Flower: the federated-learning framework providing the gRPC server/strategy runtime
from flwr.common import ndarrays_to_parameters
from fedhealth_ml.artifacts import load_bundle
from fedhealth_ml.data import sha256, validate_frame
from fedhealth_ml.preprocess import encode_labels
from fedhealth_ml.runtime import seed_all
from strategy import FedHealthStrategy
from validation import ValidationTracker
from fl_artifacts import finish_run


def main():
    """CLI entry point: verify the model/plan/validation-file hashes agree,
    then start a real Flower server bound to `--bind`, coordinating
    `--rounds` rounds of FedAvg with the labs that connect (started
    separately via client.py), and finally save the selected round."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--bind", default="127.0.0.1:8080")
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("--plan", type=Path, required=True)
    ap.add_argument("--validation", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--rounds", type=int, default=20)
    ap.add_argument("--round-timeout", type=float, default=120.)
    ap.add_argument("--local-epochs", type=int, default=1)
    ap.add_argument("--lr", type=float, default=.0001)
    ap.add_argument("--ca-cert", type=Path)
    ap.add_argument("--server-cert", type=Path)
    ap.add_argument("--server-key", type=Path)
    ap.add_argument("--insecure-dev", action="store_true")
    args = ap.parse_args()
    if args.rounds < 1:
        ap.error("--rounds must be positive")
    # Require either all three TLS files (secure gRPC) or an explicit opt-in to
    # plaintext (--insecure-dev), never a partial or mixed configuration.
    cert_paths = [args.ca_cert, args.server_cert, args.server_key]
    if any(cert_paths) and (not all(cert_paths) or args.insecure_dev):
        ap.error("Supply all three TLS files; do not combine TLS and insecure mode")
    if not all(cert_paths) and not args.insecure_dev:
        ap.error("TLS is required unless --insecure-dev is explicit")
    certificates = tuple(p.read_bytes() for p in cert_paths) if all(cert_paths) else None
    plan = json.loads(args.plan.read_text())
    prep, hybrid, meta = load_bundle(args.model, data_sha256=plan["data_sha256"])
    if sha256(args.model / "manifest.json") != plan["model_manifest_sha256"] or sha256(args.model / "preprocessor.joblib") != plan["preprocessor_sha256"]:
        raise ValueError("Server model/preprocessor differs from partition plan")
    if sha256(args.validation) != plan["validation_sha256"]:
        raise ValueError("Server validation file differs from partition plan")
    rows = validate_frame(pd.read_csv(args.validation), require_all_splits=False)
    if set(rows.split) != {"val"} or set(rows.row_id) & set(meta["fit_row_ids"]):
        raise ValueError("Server evaluation must use only supplied validation rows")
    if meta["origin"] != "centralized" or meta["training"]["seed"] != plan["seed"]:
        raise ValueError("Round-zero model/seed mismatch")
    args.out.mkdir(parents=True, exist_ok=False)
    seed_all(plan["seed"])
    Xv, yv = prep.transform(rows), encode_labels(rows.label)
    tracker = ValidationTracker(hybrid.ann, Xv, yv, n_classes=4)
    counts = plan["train_rows"]
    labs = len(counts)
    if labs < 3 or sum(counts.values()) != len(meta["fit_row_ids"]) or any(type(v) is not int or v < 1 for v in counts.values()):
        raise ValueError("Invalid expected client row counts")
    strategy = FedHealthStrategy(reference_weights=hybrid.ann.get_weights(), allowed_lab_ids=list(counts),
        preprocessor_sha256=plan["preprocessor_sha256"], expected_train_rows=counts, expected_eval_rows=counts,
        initial_parameters=ndarrays_to_parameters(hybrid.ann.get_weights()),
        min_fit_clients=labs, min_evaluate_clients=labs, min_available_clients=labs,
        fraction_fit=1., fraction_evaluate=1., accept_failures=False, evaluate_fn=tracker.evaluate,
        training_config={"seed": plan["seed"], "local_epochs": args.local_epochs, "batch_size": 32, "lr": args.lr},
        audit_dir=args.out / "audit_weights")
    fl.server.start_server(server_address=args.bind, strategy=strategy, certificates=certificates,
        config=fl.server.ServerConfig(num_rounds=args.rounds, round_timeout=args.round_timeout))
    settings = {"seed": plan["seed"], "mode": plan["mode"], "alpha": plan["alpha"], "labs": labs,
                "rounds": args.rounds, "train_rows": counts, "runtime": "Flower gRPC",
                "local_epochs": args.local_epochs, "lr": args.lr, "batch_size": 32,
                "transport": "server-authenticated TLS" if certificates else "explicit insecure development",
                "test_used": False}
    finish_run(args.out, tracker, strategy, prep, meta, args.model, Xv, yv, settings)


if __name__ == "__main__":
    main()
