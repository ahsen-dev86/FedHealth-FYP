# Tests for the Paillier homomorphic-encryption layer used to aggregate FL model
# updates without the aggregator ever seeing a lab's plaintext weights. Covers
# correctness (encrypted sum == plaintext FedAvg), that no private key material is
# held/leaked by the aggregator, ciphertext randomization, and rejection of malformed
# or inconsistent lab updates.
import json
import numpy as np
import pytest

import paillier_utils as pu
from encrypted_federation import (BlindAggregator, compare_with_reference, plaintext_reference,
                                  run as run_encrypted)

PREP = "p" * 64
CONFIG = {"seed": 42, "local_epochs": 1, "batch_size": 32, "lr": .0001}
SHAPES = [(3, 2), (2,)]  # small fake "model" shape, just enough to exercise 2 weight layers


@pytest.fixture(scope="module")
def keys():
    return pu.generate_keypair(n_length=512)  # unit-test size only


# Random weight layers matching SHAPES, for a given numpy Generator (so tests are reproducible).
def _weights(rng):
    return [rng.normal(size=s).astype("float32") for s in SHAPES]


# Builds one lab's simulated encrypted update (ciphertext + row count + metadata) in the
# same wire shape BlindAggregator.aggregate() expects to receive from a real lab client.
def _update(pub, lab, weights, count, **override):
    metrics = {**CONFIG, "lab_id": lab, "train_rows": count, "preprocessor_sha256": PREP,
               "received_sha256": "g" * 64}
    metrics.update(override.pop("metrics", {}))
    wire = pu.serialize_encrypted(pu.encrypt_weights(pub, weights))
    return lab, wire, override.get("sent_count", count), metrics


# Builds a BlindAggregator configured to accept updates only from the given labs/row counts
# and matching the shared PREP/SHAPES/CONFIG fixtures above.
def _aggregator(pub, labs=("lab-00", "lab-01"), rows=None):
    rows = rows or {"lab-00": 10, "lab-01": 30}
    return BlindAggregator(pub, allowed_lab_ids=labs, expected_train_rows=rows,
                           preprocessor_sha256=PREP, shapes=SHAPES, training_config=CONFIG)


# Core correctness check: summing two labs' updates under encryption then decrypting must
# equal the same weighted average (FedAvg) computed directly on the plaintext weights.
def test_homomorphic_sum_reproduces_plaintext_fedavg(keys):
    pub, priv = keys
    rng = np.random.default_rng(1)
    a, b = _weights(rng), _weights(rng)
    aggregator = _aggregator(pub)
    wire, total, trace = aggregator.aggregate(1, [_update(pub, "lab-00", a, 10), _update(pub, "lab-01", b, 30)])
    result = pu.decrypt_weights(priv, pu.deserialize_encrypted(pub, wire), divisor=total)
    for got, x, y in zip(result, a, b):
        expected = (x.astype("float64") * 10 + y.astype("float64") * 30) / 40
        assert np.abs(got - expected).max() < 1e-6
    assert total == 40 and trace["aggregator_saw_plaintext"] is False


# The whole point of homomorphic aggregation is that the aggregator never holds the
# private key; this inspects the live object's attributes to make sure neither the key
# material nor a PaillierPrivateKey instance is stored anywhere on it.
def test_aggregator_object_holds_no_private_key(keys):
    pub, priv = keys
    aggregator = _aggregator(pub)
    held = json.dumps({k: str(v) for k, v in vars(aggregator).items()})
    assert str(priv.p) not in held and str(priv.q) not in held
    assert not any(isinstance(v, pu.paillier.PaillierPrivateKey) for v in vars(aggregator).values())
    assert set(pu.public_key_to_dict(pub)) == {"n"}


# Paillier encryption is probabilistic: encrypting the same plaintext twice must produce
# different ciphertexts (so an observer can't tell two labs sent equal weights), but both
# must still decrypt back to the original value.
def test_ciphertext_is_randomized_and_not_plaintext(keys):
    pub, priv = keys
    w = [np.ones(s, dtype="float32") for s in SHAPES]
    first, second = pu.encrypt_weights(pub, w), pu.encrypt_weights(pub, w)
    assert first["enc"][0].ciphertext() != second["enc"][0].ciphertext()
    assert pu.decrypt_weights(priv, first)[0].tolist() == w[0].tolist()


# Each parametrized `case` corrupts one aspect of a lab's update (unknown/duplicate lab id,
# wrong row count, mismatched preprocessor/training settings, tampered received-weights
# hash, wrong weight shape, a missing lab, or a wrong count type) — the aggregator must
# reject all of them rather than silently aggregating bad or malicious input.
@pytest.mark.parametrize("case", ["unknown", "duplicate", "rows", "preprocessor", "settings",
                                  "received", "layout", "missing", "count_type"])
def test_blind_aggregator_rejects_bad_updates(keys, case):
    pub, _ = keys
    rng = np.random.default_rng(2)
    a, b = _weights(rng), _weights(rng)
    good0, good1 = _update(pub, "lab-00", a, 10), _update(pub, "lab-01", b, 30)
    bad = {
        "unknown": [good0, _update(pub, "lab-99", b, 30)],
        "duplicate": [good0, _update(pub, "lab-00", b, 10)],
        "rows": [good0, _update(pub, "lab-01", b, 31)],
        "preprocessor": [good0, _update(pub, "lab-01", b, 30, metrics={"preprocessor_sha256": "x"})],
        "settings": [good0, _update(pub, "lab-01", b, 30, metrics={"lr": .1})],
        "received": [good0, _update(pub, "lab-01", b, 30, metrics={"received_sha256": "h" * 64})],
        "layout": [good0, _update(pub, "lab-01", [np.ones((2, 2), dtype="float32"), np.ones(2, dtype="float32")], 30)],
        "missing": [good0],
        "count_type": [good0, _update(pub, "lab-01", b, 30, sent_count=30.0)],
    }[case]
    with pytest.raises(ValueError):
        _aggregator(pub).aggregate(1, bad)


# Aggregation rounds must be processed in order starting at round 1; skipping ahead to
# round 2 without round 1 having happened must be rejected.
def test_rounds_must_be_sequential(keys):
    pub, _ = keys
    with pytest.raises(ValueError, match="sequential"):
        _aggregator(pub).aggregate(2, [])


# End-to-end check with real data/model and a realistic key size (1024 bits): running the
# full encrypted-FL loop must match a plaintext FedAvg reference run round-for-round (near-
# identical weights and loss), while the on-disk artifacts prove no private key or
# decrypted weights were ever persisted by the aggregator side.
@pytest.mark.integration
def test_encrypted_training_matches_plaintext_fedavg(dataset, central_model, tmp_path):
    reference = plaintext_reference(dataset, central_model, rounds=2)
    encrypted = tmp_path / "encrypted"
    run_encrypted(dataset, central_model, encrypted, rounds=2, bits=1024, save_decrypted=True)
    rows = compare_with_reference(reference, encrypted)
    assert [r["round"] for r in rows] == [1, 2]
    for row in rows:
        assert row["max_abs_weight_difference"] < 1e-4
        assert abs(row["plain_log_loss"] - row["encrypted_log_loss"]) < 1e-4
    trace = json.loads((encrypted / "round_history.json").read_text())["aggregation"]
    assert len(trace) == 2 and not any(t["aggregator_saw_plaintext"] for t in trace)
    settings = json.loads((encrypted / "settings.json").read_text())
    assert settings["encryption"]["aggregator_holds_private_key"] is False
    assert not any("private" in p.name for p in encrypted.rglob("*"))
    assert (encrypted / "public_key.json").exists()
