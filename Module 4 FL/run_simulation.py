# fl/run_simulation.py
# ---------------------------------------------------------------------------
# One-command federated run WITHOUT Docker — the easiest way to demo the whole
# federation locally or in Colab. It partitions the dataset into N labs, spins
# them up in-process with Flower's simulation engine, and runs FedAvg for R
# rounds, printing the global model's aggregated metrics each round.
#
#   python fl/run_simulation.py --csv anemia_diagnosed_cbc_data_v4.csv \
#                               --labs 4 --rounds 5 --mode non_iid
# ---------------------------------------------------------------------------
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import task           # noqa: E402
from common import partition      # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="FedHealth federated simulation")
    ap.add_argument("--csv", default="anemia_diagnosed_cbc_data_v4.csv",
                    help="source CBC dataset to partition across labs")
    ap.add_argument("--labs", type=int, default=4)
    ap.add_argument("--rounds", type=int, default=5)
    ap.add_argument("--mode", choices=["iid", "non_iid"], default="iid")
    ap.add_argument("--local-epochs", type=int, default=2)
    ap.add_argument("--shard-dir", default="./fl/client/data")
    ap.add_argument("--preprocessor", default="./fl/preprocessor.joblib")
    args = ap.parse_args()

    import flwr as fl

    # 1. Partition the central dataset into per-lab shards.
    print(f"Partitioning {args.csv} -> {args.labs} labs ({args.mode}):")
    shard_paths = partition.write_shards(
        args.csv, args.shard_dir, args.labs, mode=args.mode)

    # 2. Shared preprocessor (agreed normalization standard) for all labs.
    prep = task.load_or_fit_preprocessor(args.csv, args.preprocessor)

    # 3. client_fn: build the lab client for a given partition id.
    def client_fn(context):
        # Flower passes a Context in recent versions; fall back to a raw cid str.
        cid = getattr(context, "node_config", {}).get("partition-id") \
            if hasattr(context, "node_config") else None
        if cid is None:
            cid = int(getattr(context, "cid", 0)) if hasattr(context, "cid") else 0
        cid = int(cid)
        from client.client import LabClient, _as_flower_client
        lab = LabClient(f"lab-{cid:02d}", shard_paths[cid], prep,
                        local_epochs=args.local_epochs)
        return _as_flower_client(lab)

    # 4. Strategy: initialize the global model from a fresh ANN.
    from server.strategy import FedHealthStrategy, weighted_metric_average
    initial = task.get_weights(task.get_model())
    strategy = FedHealthStrategy(
        fraction_fit=1.0, fraction_evaluate=1.0,
        min_fit_clients=args.labs, min_evaluate_clients=args.labs,
        min_available_clients=args.labs,
        initial_parameters=task.ndarrays_to_parameters(initial),
        evaluate_metrics_aggregation_fn=weighted_metric_average,
        accept_failures=False,
    )

    # 5. Run the simulation.
    hist = fl.simulation.start_simulation(
        client_fn=client_fn,
        num_clients=args.labs,
        config=fl.server.ServerConfig(num_rounds=args.rounds),
        strategy=strategy,
        client_resources={"num_cpus": 1, "num_gpus": 0},
    )

    print("\n=== Federated training complete ===")
    for rnd, metrics in hist.metrics_distributed.get("macro_f1", []):
        print(f"  round {rnd}: global macro-F1 (weighted over labs) = {metrics:.3f}")


if __name__ == "__main__":
    main()
