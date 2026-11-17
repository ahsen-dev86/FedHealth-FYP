"""Live federated-learning demonstration that streams every step as it happens.

Runs a real federated experiment with the Module 4 code (LabClient local
training, FedHealthStrategy FedAvg with its integrity checks, ValidationTracker
on the held-out validation split) and, optionally, Paillier-encrypted
aggregation with the Module 5 helpers. Each step is written to stdout as one
JSON line prefixed with "@@FL ", which the Node backend relays to the Model
Health "Federated training (live)" tab.

What is real and what is simulated:
  * real: the data split (training rows only), local training, FedAvg, the
    encryption, and the validation metrics;
  * simulated: the labs are objects in one process rather than separate
    machines, and "sending" an update is an in-memory hand-off whose size is
    the size it would have on the wire.

Starting points:
  * scratch:  a freshly initialised network, so the rounds visibly learn;
  * deployed: the verified centralized network (round zero of the evaluated
    experiments), which federated rounds only fine-tune.
The result is a demonstration and is isolated from the real model:
  * this script writes no files and touches no database; its only output is
    the event stream on stdout;
  * it only reads the model bundle, and it proves that by fingerprinting
    (SHA-256) every file in the bundle before and after the run. A changed
    file stops the run with an error ("model_files_unchanged" is reported in
    the final event);
  * nothing is registered, activated or deployed, and the inference service
    that answers doctors never sees this process.

    python "Module 4 FL/live_federation.py" --model <centralized bundle> \
        --mode source --start scratch --rounds 10 [--encrypted]
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "Module 5 Encryption"))

from flwr.common import Code, Status, FitRes, ndarrays_to_parameters, parameters_to_ndarrays  # noqa: E402
from fedhealth_ml import schema, models  # noqa: E402
from fedhealth_ml.artifacts import load_bundle  # noqa: E402
from fedhealth_ml.data import Dataset, sha256  # noqa: E402
from fedhealth_ml.runtime import seed_all  # noqa: E402
from fedhealth_ml.training import DEFAULT_CSV, DEFAULT_PROVENANCE  # noqa: E402
from aggregation import weights_sha256  # noqa: E402
from client import LabClient  # noqa: E402
from partition import partition_dataframe  # noqa: E402
from strategy import FedHealthStrategy  # noqa: E402
from validation import ValidationTracker, evaluate_probabilities  # noqa: E402

# Readable names for the five data sources in the training split.
SOURCE_NAMES = {
    "kaggle_anemia": "Kaggle anaemia dataset",
    "letslive": "LetsLive dataset",
    "leukoalert": "LeukoAlert dataset",
    "mendeley_thal": "Mendeley thalassaemia dataset",
    "plenoi": "Plenoi dataset",
}


def emit(kind, **payload):
    """One event per line; flushed so the backend sees it immediately."""
    print("@@FL " + json.dumps({"type": kind, "t": round(time.time(), 3), **payload}, default=float), flush=True)


def fingerprint(model_dir):
    """SHA-256 of every file in the model bundle, keyed by file name."""
    return {f.name: sha256(f) for f in sorted(Path(model_dir).iterdir()) if f.is_file()}


def class_counts(frame):
    return {c: int((frame.label == c).sum()) for c in schema.CLASSES}


def summarize(metrics):
    """The validation numbers shown on the dashboard."""
    recall = metrics.get("per_class_recall") or []
    if not isinstance(recall, dict):
        recall = dict(zip(schema.CLASSES, recall))
    return {
        "accuracy": float(metrics["accuracy"]),
        "macro_f1": float(metrics["macro_f1"]),
        "log_loss": float(metrics["log_loss"]),
        "sick_called_healthy": int(metrics["sick_called_healthy"]),
        "per_class_recall": {c: float(recall[c]) for c in schema.CLASSES if c in recall},
    }


def run(dataset, model_dir, *, rounds, labs, mode, start, encrypted, bits, seed, local_epochs, lr):
    t0 = time.time()
    before = fingerprint(model_dir)
    prep, hybrid, meta = load_bundle(model_dir, data_sha256=dataset.sha256)
    train = dataset.rows("train")
    if meta["fit_row_ids"] != train.row_id.tolist():
        raise ValueError("The model bundle was not fitted on this training split")
    seed_all(seed)

    # The global network the labs start from.
    if start == "scratch":
        ann = models.build_ann(len(schema.FEATURES), len(schema.CLASSES))
    else:
        ann = hybrid.ann
    architecture = ann.to_json()
    weights = [np.asarray(w) for w in ann.get_weights()]
    n_params = int(sum(w.size for w in weights))

    shards = partition_dataframe(train, labs, mode, seed, .5, dataset.provenance)
    lab_ids = [f"lab-{i:02d}" for i in range(labs)]
    prov = dataset.provenance.set_index("row_id")
    lab_info = []
    for lab, shard in zip(lab_ids, shards):
        sources = sorted(prov.loc[shard.row_id].source.unique())
        name = SOURCE_NAMES.get(sources[0], sources[0]) if mode == "source" and len(sources) == 1 else f"{len(sources)} sources (even split)"
        lab_info.append({"id": lab, "name": f"Lab {int(lab[4:]) + 1}", "data": name, "rows": int(len(shard)),
                         "class_counts": class_counts(shard)})
    counts = {lab: len(shard) for lab, shard in zip(lab_ids, shards)}
    prep_hash = sha256(Path(model_dir) / "preprocessor.joblib")
    clients = [LabClient(lab, shard, prep, units=schema.UNITS, architecture=architecture,
                         preprocessor_sha256=prep_hash, seed=seed, local_epochs=local_epochs, lr=lr)
               for lab, shard in zip(lab_ids, shards)]
    training_config = {"seed": seed, "local_epochs": local_epochs, "batch_size": 32, "lr": lr}
    strategy = FedHealthStrategy(reference_weights=weights, allowed_lab_ids=lab_ids, preprocessor_sha256=prep_hash,
                                 expected_train_rows=counts, expected_eval_rows=counts,
                                 initial_parameters=ndarrays_to_parameters(weights), min_fit_clients=labs,
                                 training_config=training_config, min_evaluate_clients=labs,
                                 min_available_clients=labs, accept_failures=False)
    Xv, yv = dataset.xy("val", prep)
    tracker_model = models.build_ann(len(schema.FEATURES), len(schema.CLASSES)) if start == "scratch" else hybrid.ann
    # The tracker's safety rule compares each round with round zero. That protects a
    # fine-tuned deployed model; from a random start round zero is no benchmark, so
    # the best round there is simply the one with the lowest validation loss.
    allowances = {} if start == "deployed" else {"max_macro_f1_drop": 1.0, "max_extra_sick_healthy": 10 ** 6}
    tracker = ValidationTracker(tracker_model, Xv, yv, n_classes=len(schema.CLASSES), **allowances)

    # Reference: the same network trained centrally on all training rows in one place.
    central = summarize(evaluate_probabilities(yv, np.asarray(hybrid.ann(Xv, training=False)), len(schema.CLASSES)))

    pub = priv = pu = None
    if encrypted:
        import paillier_utils as pu  # noqa: F811
        k0 = time.time()
        pub, priv = pu.generate_keypair(n_length=bits)
        emit("keys", bits=pub.n.bit_length(), seconds=round(time.time() - k0, 2))

    plain_bytes = int(sum(w.astype(np.float32).nbytes for w in weights))
    emit("setup", rounds=rounds, mode=mode, start=start, encrypted=bool(encrypted), bits=bits if encrypted else None,
         labs=lab_info, parameters=n_params, update_bytes_plain=plain_bytes, local_epochs=local_epochs, lr=lr,
         train_rows=int(len(train)), validation_rows=int(len(yv)), central_reference=central)

    tracker.evaluate(0, weights, {})
    emit("validation", round=0, **summarize(tracker.history[0]))

    ok = Status(code=Code.OK, message="")
    for rnd in range(1, rounds + 1):
        r0 = time.time()
        emit("round_start", round=rnd)
        config = strategy.fit_config(rnd)
        results, encrypted_updates = [], []
        for lab, client in zip(lab_ids, clients):
            emit("lab_receive", round=rnd, lab=lab)
            f0 = time.time()
            updated, count, metrics = client.fit(weights, config)
            loss, _, _ = client.evaluate(updated, {})  # the lab's own training loss after this round
            train_seconds = time.time() - f0
            size = int(sum(np.asarray(w, dtype=np.float32).nbytes for w in updated))
            enc_seconds = None
            if encrypted:
                e0 = time.time()
                wire = pu.serialize_encrypted(pu.encrypt_weights(pub, updated))
                enc_seconds = round(time.time() - e0, 2)
                size = len(wire)
                encrypted_updates.append((pu.deserialize_encrypted(pub, wire), int(count)))
            results.append((None, FitRes(status=ok, parameters=ndarrays_to_parameters(updated),
                                         num_examples=count, metrics=metrics)))
            emit("lab_update", round=rnd, lab=lab, rows=int(count), local_loss=float(loss),
                 train_seconds=round(train_seconds, 2), encrypt_seconds=enc_seconds, update_bytes=size,
                 patient_rows_sent=0)

        a0 = time.time()
        params, _ = strategy.aggregate_fit(rnd, results, [])  # integrity checks + FedAvg
        averaged = parameters_to_ndarrays(params)
        detail = {}
        if encrypted:
            # The aggregator adds ciphertexts with the public key only; the key
            # authority decrypts the sum. It must equal the plaintext FedAvg.
            total = int(sum(n for _, n in encrypted_updates))
            summed = pu.homomorphic_weighted_sum(encrypted_updates)
            decrypted = pu.decrypt_weights(priv, summed, divisor=total)
            diff = float(max(np.max(np.abs(a - b)) for a, b in zip(decrypted, averaged)))
            if diff > 1e-5:
                raise RuntimeError(f"Encrypted aggregate differs from FedAvg by {diff}")
            averaged = [np.asarray(d, dtype=np.float32) for d in decrypted]
            detail = {"aggregator_saw_plaintext": False, "max_difference_from_plain_fedavg": diff}
        weights = averaged
        emit("aggregate", round=rnd, labs=len(results), total_examples=int(sum(counts.values())),
             seconds=round(time.time() - a0, 2), encrypted=bool(encrypted), **detail)

        tracker.evaluate(rnd, weights, {})
        emit("validation", round=rnd, round_seconds=round(time.time() - r0, 2), **summarize(tracker.history[-1]))

    best = tracker.best_round
    after = fingerprint(model_dir)
    if after != before:
        changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
        raise RuntimeError(f"The deployed model files changed during the demo: {changed}")
    emit("done", rounds=rounds, best_round=best, model_files_unchanged=True,
         model_files_checked=len(after),
         best=summarize(tracker.best_metrics) if tracker.best_metrics else None,
         final=summarize(tracker.history[-1]), central_reference=central, seconds=round(time.time() - t0, 1),
         deployed=False)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    ap.add_argument("--model", type=Path, required=True, help="verified centralized bundle (preprocessor + round-zero ANN)")
    ap.add_argument("--rounds", type=int, default=10)
    ap.add_argument("--labs", type=int, default=5)
    ap.add_argument("--mode", choices=["iid", "non_iid", "source"], default="source")
    ap.add_argument("--start", choices=["scratch", "deployed"], default="scratch")
    ap.add_argument("--encrypted", action="store_true")
    ap.add_argument("--bits", type=int, default=2048)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--local-epochs", type=int, default=None)
    ap.add_argument("--lr", type=float, default=None)
    args = ap.parse_args()
    if not 1 <= args.rounds <= 50:
        ap.error("--rounds must be between 1 and 50")
    # From scratch the labs need a normal learning rate to make visible progress;
    # fine-tuning keeps the small rate of the evaluated experiments.
    local_epochs = args.local_epochs or (3 if args.start == "scratch" else 1)
    lr = args.lr or (3e-3 if args.start == "scratch" else 1e-4)
    try:
        run(Dataset(args.csv, args.provenance), args.model, rounds=args.rounds, labs=args.labs, mode=args.mode,
            start=args.start, encrypted=args.encrypted, bits=args.bits, seed=args.seed,
            local_epochs=local_epochs, lr=lr)
    except Exception as exc:  # report the failure to the dashboard, then exit non-zero
        emit("error", message=f"{type(exc).__name__}: {exc}")
        raise


if __name__ == "__main__":
    main()
