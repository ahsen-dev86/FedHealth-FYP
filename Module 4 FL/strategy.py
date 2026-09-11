# fl/server/strategy.py
# ---------------------------------------------------------------------------
# Module 6.4.2 — Federated Averaging (FedAvg), written out explicitly.
#
# We subclass Flower's FedAvg but override aggregate_fit so the weighted-average
# step is VISIBLE and, crucially, so Module 5 can drop Paillier in cleanly:
# right now the server averages PLAINTEXT weights; in Module 5 the two marked
# "PAILLIER HOOK" points become (1) homomorphic summation over ciphertext and
# (2) a scale — the server still never divides/decrypts, keeping it blind.
#
# NOTE: in this module the server DOES see plaintext weights (no encryption yet).
# The "server never sees plaintext weights" guarantee is delivered by Module 5.
# This module builds the FL scaffolding it plugs into.
# ---------------------------------------------------------------------------
from functools import reduce

import numpy as np
import flwr as fl
from flwr.common import parameters_to_ndarrays, ndarrays_to_parameters


def weighted_metric_average(metrics):
    """Aggregate client eval metrics weighted by each client's #examples."""
    if not metrics:
        return {}
    total = sum(n for n, _ in metrics)
    keys = [k for k in metrics[0][1].keys() if k != "lab_id"]
    return {k: float(sum(n * m[k] for n, m in metrics) / total) for k in keys}


class FedHealthStrategy(fl.server.strategy.FedAvg):
    """FedAvg with an explicit, auditable aggregation step."""

    def aggregate_fit(self, server_round, results, failures):
        if not results:
            return None, {}
        if failures and not self.accept_failures:
            return None, {}

        lab_ids = [res.metrics.get("lab_id") for _, res in results]
        if not all(isinstance(name, str) and name for name in lab_ids):
            raise ValueError("Every update must identify its lab.")
        if len(set(lab_ids)) != len(lab_ids):
            raise ValueError("Duplicate lab identities in one training round.")

        # Each result -> (list_of_layer_ndarrays, num_examples).
        client_updates = [
            (parameters_to_ndarrays(fit_res.parameters), fit_res.num_examples)
            for _, fit_res in results
        ]
        total_examples = sum(n for _, n in client_updates)

        # ---- FedAvg: example-weighted mean of each layer --------------------
        # PAILLIER HOOK (Module 5, part 1): today each `layers[i] * n` is a
        # plaintext scaled tensor and we sum them here. Under Paillier these are
        # ciphertexts and the same summation is a HOMOMORPHIC add — the server
        # computes the encrypted weighted sum without ever seeing the values.
        num_layers = len(client_updates[0][0])
        scaled_sums = []
        for i in range(num_layers):
            layer_sum = reduce(
                np.add, [layers[i] * n for layers, n in client_updates])
            scaled_sums.append(layer_sum)

        # PAILLIER HOOK (Module 5, part 2): the division by total_examples is the
        # only step needing plaintext. In Module 5 the encrypted sum is returned
        # to the labs, who hold the private key and do this scale after
        # decryption — so the blind server never performs it. Here (plaintext)
        # we do it directly.
        aggregated = [s / total_examples for s in scaled_sums]

        parameters = ndarrays_to_parameters(aggregated)
        self.last_aggregated_parameters = parameters
        self.last_aggregated_round = server_round
        metrics = {"round": server_round, "clients": len(results),
                   "total_examples": total_examples}
        metrics["lab_ids"] = ",".join(sorted(lab_ids))
        print(f"[server] round {server_round}: aggregated {len(results)} labs "
              f"({total_examples} examples)")
        return parameters, metrics
