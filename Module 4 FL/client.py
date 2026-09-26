"""Lab-local training with a fresh optimizer at each round."""
import argparse
import json
from pathlib import Path
import re
import numpy as np
from aggregation import weights_sha256
import task
from fedhealth_ml import schema, models
from fedhealth_ml.artifacts import load_bundle
from fedhealth_ml.data import sha256
from fedhealth_ml.runtime import seed_all


class LabClient:
    def __init__(self, lab_id, frame, preprocessor, *, units, architecture,
                 preprocessor_sha256, seed=42, local_epochs=1, batch_size=32, lr=.0001):
        if not re.fullmatch(r"lab-[0-9]+", lab_id):
            raise ValueError("Lab ID must have form lab-00")
        if local_epochs < 1 or batch_size < 1 or not np.isfinite(lr) or lr <= 0:
            raise ValueError("Invalid local training settings")
        self.lab_id, self.seed = lab_id, seed
        self.architecture, self.preprocessor_sha256 = architecture, preprocessor_sha256
        self.local_epochs, self.batch_size, self.lr = local_epochs, batch_size, lr
        raw, self.y = task.prepare_partition_records(frame, units=units)
        self.X = preprocessor.transform(raw)

    def get_parameters(self, config):
        raise RuntimeError("Server must supply the verified Module 3 ANN")

    def fit(self, parameters, config):
        import tensorflow as tf
        round_number = int(config["server_round"])
        if round_number < 1 or config["preprocessor_sha256"] != self.preprocessor_sha256:
            raise ValueError("Invalid round/shared preprocessor")
        if config["input_sha256"] != weights_sha256(parameters):
            raise ValueError("Incoming global weights do not match the round")
        settings = {"seed": self.seed, "local_epochs": self.local_epochs, "batch_size": self.batch_size, "lr": self.lr}
        if any(config.get(key) != value for key, value in settings.items()):
            raise ValueError("Client settings differ from the server protocol")
        tf.keras.backend.clear_session()
        seed_all(self.seed + int(self.lab_id[4:]) + 1009 * round_number)
        model = task.get_model(lr=self.lr, architecture=self.architecture)
        model.set_weights(parameters)
        ds = models.array_dataset(self.X, self.y, self.batch_size, shuffle=True, seed=self.seed + round_number)
        model.fit(ds, epochs=self.local_epochs, verbose=0, shuffle=False)
        returned = model.get_weights()
        if not all(np.isfinite(x).all() for x in returned):
            raise ValueError("Local training produced non-finite weights")
        return returned, len(self.X), {
            **settings,
            "lab_id": self.lab_id, "train_rows": len(self.X),
            "preprocessor_sha256": self.preprocessor_sha256,
            "received_sha256": weights_sha256(parameters),
            "returned_sha256": weights_sha256(returned),
        }

    def evaluate(self, parameters, config):
        # Training diagnostics only. Global held-out validation selects rounds.
        model = task.get_model(architecture=self.architecture)
        model.set_weights(parameters)
        p = np.asarray(model(self.X, training=False))
        from fedhealth_ml.metrics import evaluate
        m = evaluate(self.y, p)
        return m["log_loss"], len(self.X), {"lab_id": self.lab_id,
            "preprocessor_sha256": self.preprocessor_sha256,
            "confusion_matrix": json.dumps(m["confusion_matrix"])}


def as_flower_client(client):
    import flwr as fl
    class Adapter(fl.client.NumPyClient):
        def get_parameters(self, config): return client.get_parameters(config)
        def fit(self, parameters, config): return client.fit(parameters, config)
        def evaluate(self, parameters, config): return client.evaluate(parameters, config)
    return Adapter().to_client()


def main():
    import pandas as pd
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--server", default="127.0.0.1:8080")
    ap.add_argument("--lab-id", required=True)
    ap.add_argument("--shard", type=Path, required=True)
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("--local-epochs", type=int, default=1)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--lr", type=float, default=.0001)
    units = ap.add_mutually_exclusive_group(required=True)
    units.add_argument("--canonical-units", action="store_true")
    units.add_argument("--units-json", type=Path)
    transport = ap.add_mutually_exclusive_group(required=True)
    transport.add_argument("--ca-cert", type=Path)
    transport.add_argument("--insecure-dev", action="store_true")
    args = ap.parse_args()
    root_cert = args.ca_cert.read_bytes() if args.ca_cert else None
    prep, hybrid, meta = load_bundle(args.model)
    declared = schema.UNITS if args.canonical_units else json.loads(args.units_json.read_text())
    client = LabClient(args.lab_id, pd.read_csv(args.shard), prep, units=declared,
        architecture=hybrid.ann.to_json(), preprocessor_sha256=sha256(args.model / "preprocessor.joblib"),
        seed=args.seed, local_epochs=args.local_epochs, lr=args.lr)
    import flwr as fl
    fl.client.start_client(server_address=args.server, client=as_flower_client(client), root_certificates=root_cert, insecure=args.insecure_dev)


if __name__ == "__main__":
    main()
