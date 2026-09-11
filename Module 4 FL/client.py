# fl/client/client.py
# ---------------------------------------------------------------------------
# Module 6.3.2 — Local Federated Training Engine (Lab Tier).
#
# A Flower client that lives inside a lab. Each round it:
#   1. receives the current GLOBAL ANN weights from the server,
#   2. trains the ANN on its LOCAL shard for a few epochs (data never leaves),
#   3. returns the UPDATED weights + example count to the server.
# The server averages these (FedAvg). In Module 5 the weights are Paillier-
# encrypted before step 3 leaves the process, so the server stays blind.
#
# Runnable two ways:
#   * fl/run_simulation.py  (in-process, no Docker) — uses make_client()
#   * this file as a process (Docker Compose, Module 9) — see __main__ below
# ---------------------------------------------------------------------------
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import task  # noqa: E402
from lims_wrapper import MockLIMS  # noqa: E402


class LabClient:
    """Flower NumPyClient for one lab node."""

    def __init__(self, lab_id, shard_csv, preprocessor, local_epochs=2, batch_size=32):
        self.lab_id = lab_id
        self.local_epochs = local_epochs
        self.batch_size = batch_size

        # Pull data through the (mock) LIMS, then normalize + split locally.
        lims = MockLIMS(shard_csv, lab_id=lab_id)
        print(f"[{lab_id}] LIMS summary:", lims.summary())
        X, y = lims.normalize(lims.fetch_records())
        self.Xtr, self.ytr, self.Xte, self.yte = task.split_partition_data(
            X, y, preprocessor)

        # Build the (architecturally identical) ANN and cache class weights.
        from fedhealth_ml import models
        self.model = task.get_model()
        self.class_weight = models.class_weights(self.ytr, task.N_CLASSES)

    # --- Flower NumPyClient interface ---------------------------------------
    def get_parameters(self, config):
        return task.get_weights(self.model)

    def fit(self, parameters, config):
        """Train locally starting from the global weights."""
        task.set_weights(self.model, parameters)
        epochs = int(config.get("local_epochs", self.local_epochs))
        self.model.fit(self.Xtr, self.ytr,
                       epochs=epochs, batch_size=self.batch_size,
                       class_weight=self.class_weight, verbose=0)
        # (weights, num_examples, metrics). num_examples weights the FedAvg mean.
        return task.get_weights(self.model), len(self.Xtr), {"lab_id": self.lab_id}

    def evaluate(self, parameters, config):
        """Evaluate the GLOBAL model on this lab's local holdout."""
        task.set_weights(self.model, parameters)
        loss, acc = self.model.evaluate(self.Xte, self.yte, verbose=0)
        y_pred = np.argmax(self.model.predict(self.Xte, verbose=0), axis=1)
        metrics = task.local_metrics(self.yte, y_pred)
        metrics["lab_id"] = self.lab_id
        return float(loss), len(self.Xte), metrics


def make_client(lab_id, shard_csv, preprocessor, local_epochs=2):
    """Factory used by the simulation runner (returns a Flower Client)."""
    import flwr as fl
    return LabClient(lab_id, shard_csv, preprocessor, local_epochs).to_client() \
        if hasattr(LabClient, "to_client") else \
        _as_flower_client(LabClient(lab_id, shard_csv, preprocessor, local_epochs))


def _as_flower_client(numpy_client):
    """Wrap a plain object exposing the NumPyClient methods into a Flower Client.
    (LabClient intentionally doesn't inherit fl.client.NumPyClient so it can be
    imported/tested without Flower installed; we adapt it here.)"""
    import flwr as fl

    class _Adapter(fl.client.NumPyClient):
        def get_parameters(self, config): return numpy_client.get_parameters(config)
        def fit(self, parameters, config): return numpy_client.fit(parameters, config)
        def evaluate(self, parameters, config): return numpy_client.evaluate(parameters, config)

    return _Adapter().to_client()


# --- Standalone process (Docker Compose mode) -------------------------------
if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="FedHealth lab (Flower client)")
    ap.add_argument("--server", default=os.environ.get("FL_SERVER", "127.0.0.1:8080"))
    ap.add_argument("--lab-id", default=os.environ.get("LAB_ID", "lab-00"))
    ap.add_argument("--shard", default=os.environ.get("SHARD_CSV", "./client/data/lab_00.csv"))
    ap.add_argument("--reference-csv",
                    default=os.environ.get("REFERENCE_CSV", "../anemia_diagnosed_cbc_data_v4.csv"))
    ap.add_argument("--preprocessor",
                    default=os.environ.get("PREPROCESSOR", "./certs/../preprocessor.joblib"))
    ap.add_argument("--local-epochs", type=int, default=int(os.environ.get("LOCAL_EPOCHS", "2")))
    ap.add_argument("--ca-cert", default=os.environ.get("FL_CA_CERT"))  # enable TLS if set
    args = ap.parse_args()

    if not os.path.isfile(args.preprocessor):
        ap.error(
            "Provide the existing shared Module 3 preprocessor; "
            "automatic fitting is disabled for FL clients"
        )

    import flwr as fl

    prep = task.load_or_fit_preprocessor(args.reference_csv, args.preprocessor)
    client = _as_flower_client(
        LabClient(args.lab_id, args.shard, prep, local_epochs=args.local_epochs))

    # TLS (server-authenticated). See scripts/gen_certs.sh + README for the
    # mTLS note. If no CA cert is provided we connect insecurely (local dev).
    root_cert = None
    if args.ca_cert and os.path.exists(args.ca_cert):
        with open(args.ca_cert, "rb") as f:
            root_cert = f.read()

    print(f"[{args.lab_id}] connecting to {args.server} "
          f"({'TLS' if root_cert else 'insecure'})")
    fl.client.start_client(server_address=args.server, client=client,
                           root_certificates=root_cert)
