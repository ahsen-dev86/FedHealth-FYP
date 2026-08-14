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

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from common import task  # noqa: E402
from server.strategy import FedHealthStrategy, weighted_metric_average  # noqa: E402


def fit_config(server_round):
    """Per-round instructions pushed to clients (e.g. local epoch schedule)."""
    return {"server_round": server_round, "local_epochs": 2}


def build_strategy(num_labs, initial_weights):
    return FedHealthStrategy(
        fraction_fit=1.0,
        fraction_evaluate=1.0,
        min_fit_clients=num_labs,
        min_evaluate_clients=num_labs,
        min_available_clients=num_labs,
        initial_parameters=task.ndarrays_to_parameters(initial_weights),
        on_fit_config_fn=fit_config,
        evaluate_metrics_aggregation_fn=weighted_metric_average,
        accept_failures=False,
    )


def main():
    ap = argparse.ArgumentParser(description="FedHealth FL server (Server Tier)")
    ap.add_argument("--address", default=os.environ.get("FL_BIND", "0.0.0.0:8080"))
    ap.add_argument("--rounds", type=int, default=int(os.environ.get("FL_ROUNDS", "5")))
    ap.add_argument("--labs", type=int, default=int(os.environ.get("FL_LABS", "4")))
    ap.add_argument("--reference-csv",
                    default=os.environ.get("REFERENCE_CSV", "../anemia_diagnosed_cbc_data_v4.csv"))
    ap.add_argument("--preprocessor",
                    default=os.environ.get("PREPROCESSOR", "./preprocessor.joblib"))
    # TLS: pass all three to enable a secure uplink (see scripts/gen_certs.sh).
    ap.add_argument("--ca-cert", default=os.environ.get("FL_CA_CERT"))
    ap.add_argument("--server-cert", default=os.environ.get("FL_SERVER_CERT"))
    ap.add_argument("--server-key", default=os.environ.get("FL_SERVER_KEY"))
    args = ap.parse_args()

    import flwr as fl

    # Initialize the global model from a fresh ANN so architecture is fixed and
    # identical to every client. (We also ensure the shared preprocessor exists.)
    task.load_or_fit_preprocessor(args.reference_csv, args.preprocessor)
    initial_weights = task.get_weights(task.get_model())
    strategy = build_strategy(args.labs, initial_weights)

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
    fl.server.start_server(
        server_address=args.address,
        config=fl.server.ServerConfig(num_rounds=args.rounds),
        strategy=strategy,
        certificates=certificates,
    )


if __name__ == "__main__":
    main()
