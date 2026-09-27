# fl/run_simulation_paillier.py
# ---------------------------------------------------------------------------
# Archived (pre-four-class): part of the earlier Model A federated-learning
# pipeline, kept under archive/pre_four_class for history.
#
# One-command ENCRYPTED federation demo: same as run_simulation.py, but every
# weight exchange is Paillier-encrypted and the server aggregates over ciphertext
# without ever decrypting. This is the artifact that demonstrates BOTH privacy
# guarantees at once (raw data stays in the lab; server never sees plaintext
# weights).
#
#   python fl/run_simulation_paillier.py --csv anemia_diagnosed_cbc_data_v4.csv \
#       --labs 3 --rounds 3 --bits 1024
#
# Tip: start small (3 labs, 3 rounds, 1024-bit) — Paillier is CPU-heavy
# (~thousands of encryptions per lab per round for this ANN).
# ---------------------------------------------------------------------------
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import task, partition, crypto  # noqa: E402

_ML = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "ml"))
if _ML not in sys.path:
    sys.path.insert(0, _ML)
from fedhealth_ml import paillier_utils as pu  # noqa: E402


def main():
    """CLI entry point: generate keys, partition data, and run the encrypted Flower simulation end to end."""
    ap = argparse.ArgumentParser(description="FedHealth encrypted federated simulation")
    ap.add_argument("--csv", default="anemia_diagnosed_cbc_data_v4.csv")
    ap.add_argument("--labs", type=int, default=3)
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--mode", choices=["iid", "non_iid"], default="iid")
    ap.add_argument("--local-epochs", type=int, default=2)
    ap.add_argument("--bits", type=int, default=1024, help="Paillier key size (demo: 1024)")
    ap.add_argument("--shard-dir", default="./fl/client/data")
    ap.add_argument("--preprocessor", default="./fl/preprocessor.joblib")
    args = ap.parse_args()

    import flwr as fl  # flwr (Flower): federated-learning framework driving the simulation below
    from server.strategy_paillier import PaillierStrategy, weighted_metric_average
    from client.client_paillier import PaillierClient

    # 1. Keypair. In the real system keygen.py writes these; labs hold the private
    #    key and the server only the public one. In this single-process demo both
    #    live here, but the SERVER STRATEGY is only ever given the public key.
    print(f"Generating {args.bits}-bit Paillier keypair...")
    pub, priv = pu.generate_keypair(n_length=args.bits)

    # 2. Partition + shared preprocessor.
    shard_paths = partition.write_shards(args.csv, args.shard_dir, args.labs, mode=args.mode)
    prep = task.load_or_fit_preprocessor(args.csv, args.preprocessor)

    # 3. Initial global model, encrypted (public-key op) for round 1.
    initial_weights = task.get_weights(task.get_model())
    print(f"Encrypting initial model ({pu.count_weights(initial_weights)} weights)...")
    initial_params = crypto.build_initial_encrypted_parameters(pub, initial_weights)

    # 4. Clients hold the PRIVATE key; the strategy holds only the PUBLIC key.
    def client_fn(context):
        cid = getattr(context, "node_config", {}).get("partition-id") \
            if hasattr(context, "node_config") else None
        if cid is None:
            cid = int(getattr(context, "cid", 0)) if hasattr(context, "cid") else 0
        cid = int(cid)
        return PaillierClient(f"lab-{cid:02d}", shard_paths[cid], prep,
                              public_key=pub, private_key=priv,
                              local_epochs=args.local_epochs)

    strategy = PaillierStrategy(
        public_key=pub,                       # <-- server gets public key ONLY
        initial_parameters=initial_params,
        fraction_fit=1.0, fraction_evaluate=1.0,
        min_fit_clients=args.labs, min_evaluate_clients=args.labs,
        min_available_clients=args.labs,
        evaluate_metrics_aggregation_fn=weighted_metric_average,
        accept_failures=False,
    )

    hist = fl.simulation.start_simulation(
        client_fn=client_fn, num_clients=args.labs,
        config=fl.server.ServerConfig(num_rounds=args.rounds),
        strategy=strategy, client_resources={"num_cpus": 1, "num_gpus": 0},
    )

    print("\n=== Encrypted federated training complete (server never decrypted) ===")
    for rnd, val in hist.metrics_distributed.get("macro_f1", []):
        print(f"  round {rnd}: global macro-F1 (weighted over labs) = {val:.3f}")


if __name__ == "__main__":
    main()
