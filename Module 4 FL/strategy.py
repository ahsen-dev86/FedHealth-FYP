"""Explicit, validated plaintext FedAvg for the Module 4 ANN.

Module 5's encrypted aggregation is a separate path. This strategy sees the
plaintext ANN updates and must never be described as a blind server.
"""
import flwr as fl
import numpy as np
from pathlib import Path
from flwr.common import ndarrays_to_parameters, parameters_to_ndarrays

from aggregation import (aggregate_updates, pooled_confusion_metrics,
                         weights_sha256)
from fedhealth_ml import schema


class FedHealthStrategy(fl.server.strategy.FedAvg):
    """Reject invalid updates and retain an auditable weight fingerprint trace."""

    def __init__(self, *, reference_weights, allowed_lab_ids,
                 preprocessor_sha256, expected_train_rows=None,
                 expected_eval_rows=None,
                 audit_dir=None, training_config=None, **kwargs):
        self.reference_weights = reference_weights
        self.allowed_lab_ids = tuple(allowed_lab_ids)
        self.preprocessor_sha256 = preprocessor_sha256
        self.expected_train_rows = expected_train_rows
        self.expected_eval_rows = expected_eval_rows
        self.current_weight_sha256 = weights_sha256(reference_weights)
        self.round_trace = []
        self.training_config = training_config or {"seed": 42, "local_epochs": 1, "batch_size": 32, "lr": .0001}
        self.audit_dir = Path(audit_dir) if audit_dir else None
        if self.audit_dir:
            self.audit_dir.mkdir(parents=True, exist_ok=False)
        self.last_aggregated_parameters = None
        self.last_aggregated_round = None
        kwargs["evaluate_metrics_aggregation_fn"] = self.aggregate_evaluate_counts
        kwargs["on_fit_config_fn"] = self.fit_config
        super().__init__(**kwargs)

    def fit_config(self, server_round):
        return {**self.training_config, "server_round": int(server_round),
                "input_sha256": self.current_weight_sha256,
                "preprocessor_sha256": self.preprocessor_sha256}

    def aggregate_fit(self, server_round, results, failures):
        if server_round != len(self.round_trace) + 1:
            raise ValueError("Aggregation rounds must be sequential")
        if failures:
            raise RuntimeError(f"Training round {server_round} has client failures")
        updates = []
        for _, fit_res in results:
            if fit_res.status.code != fl.common.Code.OK:
                raise RuntimeError("Client returned unsuccessful training status")
            metrics = fit_res.metrics
            if any(metrics.get(key) != value for key, value in self.training_config.items()):
                raise ValueError("Lab training settings differ from the server protocol")
            updates.append((metrics.get("lab_id"),
                            parameters_to_ndarrays(fit_res.parameters),
                            fit_res.num_examples, metrics))
        averaged, trace = aggregate_updates(
            updates, self.reference_weights, self.allowed_lab_ids,
            expected_input_sha256=self.current_weight_sha256,
            preprocessor_sha256=self.preprocessor_sha256,
            expected_train_rows=self.expected_train_rows,
        )
        if self.audit_dir:
            payload = {f"received_{i}": np.asarray(layer)
                       for i, layer in enumerate(self.reference_weights)}
            for lab_id, layers, _, _ in updates:
                for i, layer in enumerate(layers):
                    payload[f"{lab_id}_returned_{i}"] = np.asarray(layer)
            for i, layer in enumerate(averaged):
                payload[f"aggregated_{i}"] = np.asarray(layer)
            filename = f"round_{server_round:03d}.npz"
            np.savez_compressed(self.audit_dir / filename, **payload)
            trace["audit_file"] = filename
        parameters = ndarrays_to_parameters(averaged)
        self.current_weight_sha256 = trace["aggregated_sha256"]
        self.reference_weights = averaged
        self.last_aggregated_parameters = parameters
        self.last_aggregated_round = server_round
        self.round_trace.append({"round": int(server_round), **trace})
        print(f"[server] round {server_round}: aggregated "
              f"{len(results)} labs ({trace['total_examples']} examples)")
        return parameters, {
            "round": int(server_round), "clients": len(results),
            "total_examples": trace["total_examples"],
            "lab_ids": ",".join(sorted(self.allowed_lab_ids)),
            "aggregated_sha256": trace["aggregated_sha256"],
        }

    def aggregate_evaluate_counts(self, results):
        return pooled_confusion_metrics(
            results, n_classes=len(schema.MODEL_A_CLASSES),
            allowed_labs=self.allowed_lab_ids,
            preprocessor_sha256=self.preprocessor_sha256,
            expected_eval_rows=self.expected_eval_rows,
        )

    def aggregate_evaluate(self, server_round, results, failures):
        if failures:
            raise RuntimeError(f"Evaluation round {server_round} has client failures")
        if not results:
            raise RuntimeError(f"Evaluation round {server_round} has no results")
        if any(res.status.code != fl.common.Code.OK or not np.isfinite(res.loss) for _, res in results):
            raise RuntimeError("Invalid client evaluation status/loss")
        return super().aggregate_evaluate(server_round, results, failures)
