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
import hashlib
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import task  # noqa: E402
from lims_wrapper import MockLIMS  # noqa: E402
from aggregation import weights_sha256  # noqa: E402
from reproducibility import seed_all  # noqa: E402


class LabClient:
    """Flower NumPyClient for one lab node."""

    def __init__(self, lab_id, shard_csv, preprocessor, *, units,
                 local_epochs=2, batch_size=32, seed=42, split_seed=42,
                 preprocessor_sha256=None, strict_report=False):
        self.lab_id = lab_id
        self.local_epochs = local_epochs
        self.batch_size = batch_size
        self.seed = int(seed)
        self.preprocessor_sha256 = preprocessor_sha256 or "unspecified"

        # Pull data through the (mock) LIMS, then normalize + split locally.
        lims = MockLIMS(shard_csv, lab_id=lab_id)
        print(f"[{lab_id}] LIMS summary:", lims.summary())
        X, y = lims.normalize(lims.fetch_records(), units,
                              strict_report=strict_report)
        self.Xtr, self.ytr, self.Xte, self.yte = task.split_partition_data(
            X, y, preprocessor, seed=split_seed)

        # Build the (architecturally identical) ANN and cache class weights.
        from fedhealth_ml import models
        self.class_weight = models.class_weights(self.ytr, task.N_CLASSES)

    # --- Flower NumPyClient interface ---------------------------------------
    def get_parameters(self, config):
        return task.get_weights(task.get_model())

    def fit(self, parameters, config):
        """Train locally starting from the global weights."""
        server_round = int(config.get("server_round", 0))
        lab_index = int(self.lab_id[4:])
        base_seed = int(config.get("seed", self.seed - lab_index))
        seed_all(base_seed + lab_index + 1009 * server_round)
        model = task.get_model()  # fresh optimizer state in every round
        task.set_weights(model, parameters)
        epochs = int(config.get("local_epochs", self.local_epochs))
        if epochs < 1:
            raise ValueError("local_epochs must be positive")
        model.fit(self.Xtr, self.ytr, epochs=epochs,
                  batch_size=self.batch_size, class_weight=self.class_weight,
                  verbose=0)
        # (weights, num_examples, metrics). num_examples weights the FedAvg mean.
        count = len(self.Xtr)
        returned = task.get_weights(model)
        return returned, count, {
            "lab_id": self.lab_id, "train_rows": count,
            "preprocessor_sha256": self.preprocessor_sha256,
            "received_sha256": weights_sha256(parameters),
            "returned_sha256": weights_sha256(returned),
        }

    def evaluate(self, parameters, config):
        """Evaluate the GLOBAL model on this lab's local holdout."""
        model = task.get_model()
        task.set_weights(model, parameters)
        loss, _ = model.evaluate(self.Xte, self.yte, verbose=0)
        y_pred = np.argmax(model.predict(self.Xte, verbose=0), axis=1)
        metrics = task.local_metrics(self.yte, y_pred)
        metrics["lab_id"] = self.lab_id
        metrics["preprocessor_sha256"] = self.preprocessor_sha256
        return float(loss), len(self.Xte), metrics


def make_client(lab_id, shard_csv, preprocessor, *, units, local_epochs=2,
                seed=42, split_seed=42, preprocessor_sha256=None,
                strict_report=False):
    """Factory used by the simulation runner (returns a Flower Client)."""
    return _as_flower_client(LabClient(
        lab_id, shard_csv, preprocessor, units=units,
        local_epochs=local_epochs, seed=seed, split_seed=split_seed,
        preprocessor_sha256=preprocessor_sha256,
        strict_report=strict_report))


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
    ap.add_argument("--preprocessor",
                    default=os.environ.get("PREPROCESSOR", "./certs/../preprocessor.joblib"))
    ap.add_argument("--local-epochs", type=int, default=int(os.environ.get("LOCAL_EPOCHS", "2")))
    ap.add_argument("--ca-cert", default=os.environ.get("FL_CA_CERT"))  # enable TLS if set
    ap.add_argument("--seed", type=int, default=int(os.environ.get("FL_SEED", "42")))
    ap.add_argument("--split-seed", type=int,
                    default=int(os.environ.get("FL_SPLIT_SEED", "42")))
    units_group = ap.add_mutually_exclusive_group()
    units_group.add_argument("--units-json", default=os.environ.get("FL_UNITS_JSON"))
    units_group.add_argument("--canonical-units", action="store_true",
                             default=os.environ.get("FL_CANONICAL_UNITS") == "1")
    ap.add_argument("--insecure-dev", action="store_true")
    args = ap.parse_args()

    if bool(args.units_json) == bool(args.canonical_units):
        ap.error("Declare --units-json or --canonical-units (exactly one)")

    if not os.path.isfile(args.preprocessor):
        ap.error(
            "Provide the existing shared Module 3 preprocessor; "
            "automatic fitting is disabled for FL clients"
        )

    import flwr as fl

    from fedhealth_ml import schema
    if args.units_json:
        with open(args.units_json, encoding="utf-8") as handle:
            units = json.load(handle)
    else:
        units = dict(schema.MODEL_A_UNITS)
    prep = task.load_or_fit_preprocessor(None, args.preprocessor)
    if not args.lab_id.startswith("lab-") or not args.lab_id[4:].isdigit():
        ap.error("--lab-id must look like lab-00")
    training_seed = args.seed + int(args.lab_id[4:])
    with open(args.preprocessor, "rb") as handle:
        prep_hash = hashlib.sha256(handle.read()).hexdigest()
    client = _as_flower_client(
        LabClient(args.lab_id, args.shard, prep, units=units,
                  local_epochs=args.local_epochs, seed=training_seed,
                  split_seed=args.split_seed,
                  preprocessor_sha256=prep_hash,
                  strict_report=bool(args.units_json)))

    # TLS (server-authenticated). See scripts/gen_certs.sh + README for the
    # mTLS note. If no CA cert is provided we connect insecurely (local dev).
    root_cert = None
    if args.ca_cert:
        if not os.path.isfile(args.ca_cert):
            ap.error(f"CA certificate is missing: {args.ca_cert}")
        with open(args.ca_cert, "rb") as f:
            root_cert = f.read()
    elif not args.insecure_dev:
        ap.error("Provide --ca-cert, or explicitly use --insecure-dev")

    print(f"[{args.lab_id}] connecting to {args.server} "
          f"({'TLS' if root_cert else 'insecure'})")
    fl.client.start_client(server_address=args.server, client=client,
                           root_certificates=root_cert)
