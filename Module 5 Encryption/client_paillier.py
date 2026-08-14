# fl/client/client_paillier.py
# ---------------------------------------------------------------------------
# Module 6.3.2 (encrypted) — the Lab Tier client that keeps the server blind.
#
# Uses Flower's low-level Client interface (not NumPyClient) so we can move raw
# ciphertext bytes instead of plaintext ndarrays. Each round:
#   1. receive E(global) + N from the server,
#   2. DECRYPT with the lab's private key, divide by N -> plaintext global model,
#   3. train locally on the lab's shard,
#   4. ENCRYPT the update with the public key and send ciphertext back.
# Plaintext weights exist ONLY inside the lab, briefly, in step 2-3.
# ---------------------------------------------------------------------------
import os
import sys

import numpy as np
import flwr as fl
from flwr.common import (GetParametersRes, FitRes, EvaluateRes,
                         Status, Code)

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from common import task, crypto  # noqa: E402

_ML = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ml"))
if _ML not in sys.path:
    sys.path.insert(0, _ML)
from fedhealth_ml import paillier_utils as pu  # noqa: E402
from client.lims_wrapper import MockLIMS  # noqa: E402


class PaillierClient(fl.client.Client):
    def __init__(self, lab_id, shard_csv, preprocessor,
                 public_key, private_key, local_epochs=2, batch_size=32):
        self.lab_id = lab_id
        self.pub = public_key
        self.priv = private_key            # PRIVATE key lives here, in the lab
        self.local_epochs = local_epochs
        self.batch_size = batch_size

        print(f"[{lab_id}] LIMS summary:", MockLIMS(shard_csv, lab_id).summary())
        self.Xtr, self.ytr, self.Xte, self.yte = task.load_partition_data(
            shard_csv, preprocessor)
        from fedhealth_ml import models
        self.model = task.get_model()
        self.class_weight = models.class_weights(self.ytr, task.N_CLASSES)

    # Decrypt E(Σ nᵢwᵢ) and divide by N -> plaintext global weights (lab-side).
    def _global_weights(self, parameters, config):
        enc = crypto.parameters_to_encrypted(self.pub, parameters)
        summed = pu.decrypt_weights(self.priv, enc)
        n = int(config.get("total_examples", 1)) or 1
        return [layer / n for layer in summed]

    def get_parameters(self, ins):
        enc = pu.encrypt_weights(self.pub, task.get_weights(self.model))
        return GetParametersRes(status=Status(Code.OK, ""),
                                parameters=crypto.encrypted_to_parameters(enc))

    def fit(self, ins):
        # 1-2. decrypt global model
        task.set_weights(self.model, self._global_weights(ins.parameters, ins.config))
        # 3. train locally (raw data never leaves this process)
        epochs = int(ins.config.get("local_epochs", self.local_epochs))
        self.model.fit(self.Xtr, self.ytr, epochs=epochs, batch_size=self.batch_size,
                       class_weight=self.class_weight, verbose=0)
        # 4. encrypt the update; only ciphertext leaves the lab
        enc = pu.encrypt_weights(self.pub, task.get_weights(self.model))
        return FitRes(status=Status(Code.OK, ""),
                      parameters=crypto.encrypted_to_parameters(enc),
                      num_examples=len(self.Xtr),
                      metrics={"lab_id": self.lab_id})

    def evaluate(self, ins):
        task.set_weights(self.model, self._global_weights(ins.parameters, ins.config))
        loss, _ = self.model.evaluate(self.Xte, self.yte, verbose=0)
        y_pred = np.argmax(self.model.predict(self.Xte, verbose=0), axis=1)
        metrics = task.local_metrics(self.yte, y_pred)
        metrics["lab_id"] = self.lab_id
        return EvaluateRes(status=Status(Code.OK, ""), loss=float(loss),
                           num_examples=len(self.Xte), metrics=metrics)
