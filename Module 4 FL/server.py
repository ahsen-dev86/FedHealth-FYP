# fl/server/server.py
# ---------------------------------------------------------------------------
# Module 6.4 — Server Tier (the coordinator). Starts a Flower server that runs
# `num_rounds` of FedHealthStrategy over the connected lab clients. Optionally
# terminates TLS (server-authenticated) for the secure uplink.
#
# Runs as its own process for Docker Compose (Module 9). For a one-command local
# run without Docker, use fl/run_simulation.py instead.
# ---------------------------------------------------------------------------
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import task  # noqa: E402
from strategy import FedHealthStrategy, weighted_metric_average  # noqa: E402


def fit_config(server_round, local_epochs=2):
    """Per-round instructions pushed to every participating client."""
    return {
        "server_round": server_round,
        "local_epochs": int(local_epochs),
    }


def build_strategy(num_labs, initial_weights, local_epochs=2):
    return FedHealthStrategy(
        fraction_fit=1.0,
        fraction_evaluate=1.0,
        min_fit_clients=num_labs,
        min_evaluate_clients=num_labs,
        min_available_clients=num_labs,
        initial_parameters=task.ndarrays_to_parameters(initial_weights),
        on_fit_config_fn=lambda server_round: fit_config(
            server_round, local_epochs
        ),
        evaluate_metrics_aggregation_fn=weighted_metric_average,
        accept_failures=False,
    )


def main():
    ap = argparse.ArgumentParser(description="FedHealth FL server (Server Tier)")
    ap.add_argument("--address", default=os.environ.get("FL_BIND", "0.0.0.0:8080"))
    ap.add_argument("--rounds", type=int, default=int(os.environ.get("FL_ROUNDS", "5")))
    ap.add_argument("--labs", type=int, default=int(os.environ.get("FL_LABS", "4")))
    ap.add_argument(
        "--local-epochs", type=int,
        default=int(os.environ.get("LOCAL_EPOCHS", "2")))
    ap.add_argument("--reference-csv",
                    default=os.environ.get("REFERENCE_CSV", "../anemia_diagnosed_cbc_data_v4.csv"))
    ap.add_argument("--preprocessor",
                    default=os.environ.get("PREPROCESSOR", "./preprocessor.joblib"))
    # TLS: pass all three to enable a secure uplink (see scripts/gen_certs.sh).
    ap.add_argument("--ca-cert", default=os.environ.get("FL_CA_CERT"))
    ap.add_argument("--server-cert", default=os.environ.get("FL_SERVER_CERT"))
    ap.add_argument("--server-key", default=os.environ.get("FL_SERVER_KEY"))
    ap.add_argument(
        "--output-dir", required=True,
        help="new directory for the final ANN, preprocessor and run metadata")
    args = ap.parse_args()

    from pathlib import Path
    output_dir = Path(args.output_dir).expanduser().resolve()
    if output_dir.exists():
        ap.error("--output-dir must not already exist")
    if args.labs < 2 or args.rounds < 1 or args.local_epochs < 1:
        ap.error("Use at least 2 labs, 1 round and 1 local epoch")
    if not os.path.isfile(args.preprocessor):
        ap.error(
            "Provide the existing shared Module 3 preprocessor; "
            "automatic fitting is disabled for the FL server"
        )

    import flwr as fl

    # Initialize the global model from a fresh ANN so architecture is fixed and
    # identical to every client. (We also ensure the shared preprocessor exists.)
    prep = task.load_or_fit_preprocessor(
        args.reference_csv, args.preprocessor)
    initial_weights = task.get_weights(task.get_model())
    strategy = build_strategy(
        args.labs, initial_weights, args.local_epochs
    )

    certificates = None
    if args.ca_cert and args.server_cert and args.server_key:
        certificates = (
            open(args.ca_cert, "rb").read(),
            open(args.server_cert, "rb").read(),
            open(args.server_key, "rb").read(),
        )
        print("[server] TLS enabled (server-authenticated)")

    print(f"[server] starting on {args.address} for {args.rounds} rounds, "
          f"{args.labs} labs")
    history = fl.server.start_server(
        server_address=args.address,
        config=fl.server.ServerConfig(num_rounds=args.rounds),
        strategy=strategy,
        certificates=certificates,
    )

    expected_rounds = list(range(1, args.rounds + 1))
    expected_ids = ",".join(f"lab-{i:02d}" for i in range(args.labs))

    for key, expected_value in (
        ("clients", args.labs),
        ("lab_ids", expected_ids),
    ):
        expected_history = [
            (round_number, expected_value)
            for round_number in expected_rounds
        ]
        if history.metrics_distributed_fit.get(key) != expected_history:
            raise RuntimeError(
                f"Incomplete or inconsistent training history: {key}"
            )

    if [
        round_number for round_number, _ in history.losses_distributed
    ] != expected_rounds:
        raise RuntimeError("Evaluation did not complete for every round")

    if getattr(strategy, "last_aggregated_round", None) != args.rounds:
        raise RuntimeError("Final aggregated parameters are missing")

    from fl_artifacts import save_ann_checkpoint

    final_model = task.get_model()
    task.set_weights(
        final_model,
        task.parameters_to_ndarrays(
            strategy.last_aggregated_parameters
        ),
    )

    checkpoint = save_ann_checkpoint(
        final_model,
        prep,
        output_dir,
        run_info={
            "purpose": "standalone_client_server_training",
            "trained": True,
            "initialization": "fresh_ann",
            "labs": args.labs,
            "rounds": args.rounds,
            "local_epochs": args.local_epochs,
            "history": {
                "losses_distributed": history.losses_distributed,
                "metrics_distributed": history.metrics_distributed,
                "metrics_distributed_fit": (
                    history.metrics_distributed_fit
                ),
            },
        },
    )
    print(
        "[server] saved and reload-verified checkpoint:",
        checkpoint,
    )


if __name__ == "__main__":
    main()
