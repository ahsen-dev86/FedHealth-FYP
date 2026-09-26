"""Module 5: Paillier-encrypted ANN FedAvg over the Module 4 lab clients.

Labs decrypt the previous aggregate, train exactly as in Module 4, encrypt their
update with the public key and send ciphertext. The aggregator holds only the
public key: it computes E(sum n_i * w_i) homomorphically and never divides or
decrypts. Labs divide by N after decrypting.

Simulation boundary: the key authority also decrypts each aggregate so the same
global validation used by plaintext runs can select a round. That party is a
separate role and is not the aggregator. All labs share one keypair (no threshold
Paillier), and a blind aggregator cannot detect a poisoned but well-formed update.
"""
import argparse
import json
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fedhealth_ml import schema
from fedhealth_ml.artifacts import load_bundle
from fedhealth_ml.data import Dataset, sha256
from fedhealth_ml.runtime import seed_all, write_json
from fedhealth_ml.training import DEFAULT_CSV, DEFAULT_PROVENANCE
from aggregation import aggregate_updates, weights_sha256
from client import LabClient
from partition import partition_dataframe
from validation import ValidationTracker
from fl_artifacts import finish_run
import paillier_utils as pu


class BlindAggregator:
    """Validates ciphertext updates and sums them without any private key."""

    def __init__(self, public_key, *, allowed_lab_ids, expected_train_rows,
                 preprocessor_sha256, shapes, training_config):
        self.public_key = public_key
        self.allowed_lab_ids = tuple(allowed_lab_ids)
        self.expected_train_rows = dict(expected_train_rows)
        self.preprocessor_sha256 = preprocessor_sha256
        self.shapes = [list(s) for s in shapes]
        self.n_weights = int(sum(int(np.prod(s)) if s else 1 for s in self.shapes))
        self.training_config = dict(training_config)
        self.round_trace = []
        self.total_examples = 1  # round 1 receives E(w0), which is not a sum

    def fit_config(self, server_round):
        return {**self.training_config, "server_round": int(server_round),
                "preprocessor_sha256": self.preprocessor_sha256}

    def aggregate(self, server_round, updates):
        """updates: [(lab_id, wire_bytes, num_examples, metrics)] -> (wire_bytes, total, trace)."""
        if server_round != len(self.round_trace) + 1:
            raise ValueError("Aggregation rounds must be sequential")
        if len(updates) != len(self.allowed_lab_ids):
            raise ValueError("Every configured lab must provide one update")
        seen, received, models = set(), set(), []
        for lab_id, wire, count, metrics in updates:
            if lab_id not in self.allowed_lab_ids or lab_id in seen:
                raise ValueError(f"Unknown or duplicate lab: {lab_id}")
            seen.add(lab_id)
            if isinstance(count, (bool, np.bool_)) or not isinstance(count, (int, np.integer)) or count < 1:
                raise ValueError(f"Invalid example count from {lab_id}")
            if metrics.get("train_rows") != count or count != self.expected_train_rows[lab_id]:
                raise ValueError(f"Unexpected training row count from {lab_id}")
            if metrics.get("preprocessor_sha256") != self.preprocessor_sha256:
                raise ValueError(f"Wrong shared preprocessor at {lab_id}")
            if any(metrics.get(k) != v for k, v in self.training_config.items()):
                raise ValueError("Lab training settings differ from the server protocol")
            encrypted = pu.deserialize_encrypted(self.public_key, wire)
            if encrypted["shapes"] != self.shapes or len(encrypted["enc"]) != self.n_weights:
                raise ValueError(f"Wrong ciphertext layout from {lab_id}")
            received.add(metrics.get("received_sha256"))
            models.append((encrypted, int(count)))
        if len(received) != 1 or None in received:
            raise ValueError("Labs trained from different global weights")
        total = int(sum(count for _, count in models))
        aggregate = pu.homomorphic_weighted_sum(models)  # public-key operations only
        trace = {"total_examples": total,
                 "received_sha256": next(iter(received)),
                 "train_rows": {lab: int(self.expected_train_rows[lab]) for lab in sorted(seen)},
                 "aggregated_ciphertext_sha256": pu.ciphertext_sha256(aggregate),
                 "aggregator_saw_plaintext": False}
        self.round_trace.append({"round": int(server_round), **trace})
        self.total_examples = total
        print(f"[aggregator] round {server_round}: summed {len(models)} encrypted updates "
              f"(N={total}); no decryption performed")
        return pu.serialize_encrypted(aggregate), total, trace


class EncryptedLab:
    """Wraps a Module 4 LabClient: decrypt global, train locally, encrypt update."""

    def __init__(self, client, public_key, private_key):
        self.client, self.pub, self.priv = client, public_key, private_key

    def fit(self, wire_global, total_examples, config):
        layers = pu.decrypt_weights(self.priv, pu.deserialize_encrypted(self.pub, wire_global),
                                    divisor=total_examples)
        if not all(np.isfinite(layer).all() for layer in layers):
            raise ValueError("Decrypted global weights are not finite")
        config = {**config, "input_sha256": weights_sha256(layers)}
        returned, count, metrics = self.client.fit(layers, config)
        # The blind aggregator gets a consensus hash of the received global model,
        # not a fingerprint of this lab's individual plaintext update.
        metrics = {k: v for k, v in metrics.items() if k != "returned_sha256"}
        wire = pu.serialize_encrypted(pu.encrypt_weights(self.pub, returned))
        return wire, count, metrics


def run(dataset, model_dir, output, *, rounds=20, labs=3, mode="iid", alpha=.5,
        seed=42, local_epochs=1, lr=.0001, bits=2048, key_dir=None, save_decrypted=False):
    """Encrypted counterpart of Module 4 run_simulation.run (same split, labs, selection).

    save_decrypted writes the decrypted aggregate each round for equivalence checks;
    it is test evidence produced by the key authority, never by the aggregator.
    """
    if rounds < 1:
        raise ValueError("At least one federated round is required")
    model_dir, output = Path(model_dir), Path(output)
    prep, hybrid, meta = load_bundle(model_dir, data_sha256=dataset.sha256)
    if meta["origin"] != "centralized" or meta["training"]["seed"] != seed:
        raise ValueError("Use the same seed's centralized Module 3 ANN as round zero")
    if meta["fit_row_ids"] != dataset.rows("train").row_id.tolist():
        raise ValueError("Module 3 training split mismatch")
    output.mkdir(parents=True, exist_ok=False)
    seed_all(seed)
    if key_dir:
        key_dir = Path(key_dir)
        pub, priv = pu.load_public_key(key_dir / "public.json"), pu.load_private_key(key_dir / "private.json")
    else:
        pub, priv = pu.generate_keypair(n_length=bits)
    if pub.n.bit_length() < 1024:
        print("WARNING: modulus below 1024 bits is for unit tests only")
    pu.save_public_key(pub, output / "public_key.json")  # the private key is never written here

    shards = partition_dataframe(dataset.rows("train"), labs, mode, seed, alpha, dataset.provenance)
    prep_hash = sha256(model_dir / "preprocessor.joblib")
    allowed = [f"lab-{i:02d}" for i in range(labs)]
    counts = {lab: len(shard) for lab, shard in zip(allowed, shards)}
    clients = [EncryptedLab(LabClient(lab, frame, prep, units=schema.UNITS, architecture=hybrid.ann.to_json(),
                                      preprocessor_sha256=prep_hash, seed=seed, local_epochs=local_epochs, lr=lr),
                            pub, priv) for lab, frame in zip(allowed, shards)]
    Xv, yv = dataset.xy("val", prep)
    tracker = ValidationTracker(hybrid.ann, Xv, yv, n_classes=4)
    weights = hybrid.ann.get_weights()
    initial_hash = weights_sha256(weights)
    training_config = {"seed": seed, "local_epochs": local_epochs, "batch_size": 32, "lr": lr}
    aggregator = BlindAggregator(pub, allowed_lab_ids=allowed, expected_train_rows=counts,
                                 preprocessor_sha256=prep_hash, shapes=[w.shape for w in weights],
                                 training_config=training_config)
    tracker.evaluate(0, weights, {})
    wire = pu.serialize_encrypted(pu.encrypt_weights(pub, weights))  # key authority seeds round 1
    total = aggregator.total_examples
    decrypted_dir = output / "decrypted_for_equivalence_check"
    if save_decrypted:
        decrypted_dir.mkdir()
    for round_number in range(1, rounds + 1):
        config = aggregator.fit_config(round_number)
        updates = []
        for lab, client in zip(allowed, clients):
            update_wire, count, metrics = client.fit(wire, total, config)
            updates.append((lab, update_wire, count, metrics))
        wire, total, _ = aggregator.aggregate(round_number, updates)
        weights = pu.decrypt_weights(priv, pu.deserialize_encrypted(pub, wire), divisor=total)
        tracker.evaluate(round_number, weights, {})
        if save_decrypted:
            np.savez_compressed(decrypted_dir / f"round_{round_number:03d}.npz",
                                **{f"aggregated_{i}": layer for i, layer in enumerate(weights)})
    if tracker.history[0]["weights_sha256"] != initial_hash:
        raise RuntimeError("Round zero differs from saved Module 3 weights")
    settings = {"seed": seed, "mode": mode, "alpha": alpha if mode == "non_iid" else None,
                "labs": labs, "rounds": rounds, "local_epochs": local_epochs, "batch_size": 32,
                "lr": lr, "optimizer": "fresh Adam per lab per round", "train_rows": counts,
                "all_labs_each_round": True, "runtime": "sequential simulation, serialized ciphertext",
                "test_used": False,
                "encryption": {"scheme": "Paillier (additively homomorphic)", "modulus_bits": pub.n.bit_length(),
                               "weights_per_update": aggregator.n_weights, "aggregator_holds_private_key": False,
                               "key_custody": "all labs share one keypair; no threshold Paillier",
                               "transport": "in-process serialized bytes; no network TLS in this simulation"}}
    return finish_run(output, tracker, aggregator, prep, meta, model_dir, Xv, yv, settings,
                      hybrid_train=dataset.xy("train", prep))


def plaintext_reference(dataset, model_dir, *, rounds=20, labs=3, mode="iid", alpha=.5,
                        seed=42, local_epochs=1, lr=.0001):
    """Plaintext FedAvg with the same labs, split and Module 4 aggregation function.

    Returns per-round aggregated weights and global validation metrics for comparison
    with the encrypted run. No files are written."""
    model_dir = Path(model_dir)
    prep, hybrid, _ = load_bundle(model_dir, data_sha256=dataset.sha256)
    shards = partition_dataframe(dataset.rows("train"), labs, mode, seed, alpha, dataset.provenance)
    prep_hash = sha256(model_dir / "preprocessor.joblib")
    allowed = [f"lab-{i:02d}" for i in range(labs)]
    counts = {lab: len(shard) for lab, shard in zip(allowed, shards)}
    clients = [LabClient(lab, frame, prep, units=schema.UNITS, architecture=hybrid.ann.to_json(),
                         preprocessor_sha256=prep_hash, seed=seed, local_epochs=local_epochs, lr=lr)
               for lab, frame in zip(allowed, shards)]
    Xv, yv = dataset.xy("val", prep)
    tracker = ValidationTracker(hybrid.ann, Xv, yv, n_classes=4)
    weights = hybrid.ann.get_weights()
    tracker.evaluate(0, weights, {})
    training_config = {"seed": seed, "local_epochs": local_epochs, "batch_size": 32, "lr": lr}
    per_round = []
    for round_number in range(1, rounds + 1):
        config = {**training_config, "server_round": round_number, "preprocessor_sha256": prep_hash,
                  "input_sha256": weights_sha256(weights)}
        updates = []
        for client in clients:
            layers, count, metrics = client.fit(weights, config)
            updates.append((metrics["lab_id"], layers, count, metrics))
        weights, _ = aggregate_updates(updates, weights, allowed, expected_input_sha256=config["input_sha256"],
                                       preprocessor_sha256=prep_hash, expected_train_rows=counts)
        tracker.evaluate(round_number, weights, {})
        per_round.append([np.array(layer, copy=True) for layer in weights])
    return {"weights": per_round, "validation": tracker.history}


def compare_with_reference(reference, encrypted_dir):
    """Per-round weight and validation differences between plaintext and encrypted runs."""
    encrypted_dir = Path(encrypted_dir)
    enc_val = json.loads((encrypted_dir / "round_history.json").read_text())["validation"]
    rows = []
    for enc_file in sorted((encrypted_dir / "decrypted_for_equivalence_check").glob("round_*.npz")):
        number = int(enc_file.stem.split("_")[1])
        enc = np.load(enc_file)
        diff = max(float(np.abs(reference["weights"][number - 1][i] - enc[f"aggregated_{i}"]).max())
                   for i in range(len(reference["weights"][number - 1])))
        p, e = reference["validation"][number], enc_val[number]
        rows.append({"round": number, "max_abs_weight_difference": diff,
                     "plain_log_loss": p["log_loss"], "encrypted_log_loss": e["log_loss"],
                     "plain_macro_f1": p["macro_f1"], "encrypted_macro_f1": e["macro_f1"]})
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--rounds", type=int, default=20)
    ap.add_argument("--labs", type=int, default=3)
    ap.add_argument("--mode", choices=["iid", "non_iid", "source"], default="iid")
    ap.add_argument("--alpha", type=float, default=.5)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--local-epochs", type=int, default=1)
    ap.add_argument("--bits", type=int, default=2048)
    ap.add_argument("--key-dir", type=Path, help="directory with public.json and private.json (else a fresh keypair)")
    ap.add_argument("--save-decrypted", action="store_true")
    ap.add_argument("--compare-plaintext", action="store_true",
                    help="also run plaintext FedAvg and write equivalence_report.json (implies --save-decrypted)")
    args = ap.parse_args()
    dataset = Dataset(args.csv, args.provenance)
    if args.compare_plaintext:
        args.save_decrypted = True
    run(dataset, args.model, args.out, rounds=args.rounds, labs=args.labs,
        mode=args.mode, alpha=args.alpha, seed=args.seed, local_epochs=args.local_epochs,
        bits=args.bits, key_dir=args.key_dir, save_decrypted=args.save_decrypted)
    if args.compare_plaintext:
        reference = plaintext_reference(dataset, args.model, rounds=args.rounds, labs=args.labs, mode=args.mode,
                                        alpha=args.alpha, seed=args.seed, local_epochs=args.local_epochs)
        report = compare_with_reference(reference, args.out)
        write_json(args.out / "equivalence_report.json", report)
        print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
