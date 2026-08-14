# fl/server/strategy_paillier.py
# ---------------------------------------------------------------------------
# Module 6.4 (encrypted) — the BLIND aggregator.
#
# Same FedAvg math as strategy.py, but the server now operates purely on
# ciphertext with the PUBLIC key:
#   * aggregate_fit computes E(Σ nᵢ·wᵢ) via homomorphic add + scalar-mul.
#     It NEVER decrypts and NEVER divides.
#   * The /N step is deferred to the labs (they hold the private key). The
#     server passes N to the labs via each round's fit/evaluate config.
#
# Round 1: initial_parameters is E(w₀) and we set total_examples=1, so the labs
# decrypt to exactly w₀. Round r>1: the labs receive E(Σ nᵢ·wᵢ) and N, decrypt,
# and divide -> the true FedAvg global model.
# ---------------------------------------------------------------------------
import os
import sys

import flwr as fl

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from common import crypto  # noqa: E402

_ML = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ml"))
if _ML not in sys.path:
    sys.path.insert(0, _ML)
from fedhealth_ml import paillier_utils as pu  # noqa: E402


def weighted_metric_average(metrics):
    if not metrics:
        return {}
    total = sum(n for n, _ in metrics)
    keys = [k for k in metrics[0][1].keys() if k != "lab_id"]
    return {k: float(sum(n * m[k] for n, m in metrics) / total) for k in keys}


class PaillierStrategy(fl.server.strategy.FedAvg):
    """FedAvg over Paillier ciphertext. The server holds only the public key."""

    def __init__(self, public_key, **kwargs):
        super().__init__(**kwargs)
        self.public_key = public_key
        # Round-1 params are E(w0) (a single encryption, not a sum) -> divide by 1.
        self._last_total = 1

    # --- push N to labs so THEY can do the /N after decryption ---------------
    def configure_fit(self, server_round, parameters, client_manager):
        instructions = super().configure_fit(server_round, parameters, client_manager)
        for _, fit_ins in instructions:
            fit_ins.config["total_examples"] = self._last_total
            fit_ins.config["server_round"] = server_round
        return instructions

    def configure_evaluate(self, server_round, parameters, client_manager):
        instructions = super().configure_evaluate(server_round, parameters, client_manager)
        for _, eval_ins in instructions:
            eval_ins.config["total_examples"] = self._last_total
        return instructions

    # --- homomorphic aggregation (no decryption anywhere here) ---------------
    def aggregate_fit(self, server_round, results, failures):
        if not results:
            return None, {}
        if failures and not self.accept_failures:
            return None, {}

        models_and_weights, total = [], 0
        for _, fit_res in results:
            enc = crypto.parameters_to_encrypted(self.public_key, fit_res.parameters)
            models_and_weights.append((enc, fit_res.num_examples))
            total += fit_res.num_examples

        # E(Σ nᵢ·wᵢ) using public key only. The server cannot read any wᵢ.
        aggregated = pu.homomorphic_weighted_sum(models_and_weights)
        self._last_total = total  # labs divide by this next round

        print(f"[server] round {server_round}: homomorphically aggregated "
              f"{len(results)} labs over ciphertext (N={total}). Server stayed blind.")
        return crypto.encrypted_to_parameters(aggregated), {"total_examples": total}
