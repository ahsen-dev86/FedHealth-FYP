# Module 5 — Paillier-encrypted ANN federation (four-class)

Encrypted counterpart of Module 4. Labs decrypt the previous aggregate, train
with the unchanged Module 4 `LabClient`, encrypt the update with the **public**
key and send ciphertext. The aggregator holds only the public key: it computes
`E(sum n_i * w_i)` with ciphertext addition and ciphertext-times-integer, and
never decrypts or divides. Labs divide by `N` after decrypting.

Only the ANN weights (2,916 per update) are encrypted. XGBoost stays local /
central-reference exactly as in Module 4.

## Files

- `paillier_utils.py` — keygen, (de)serialization, encrypt/decrypt, homomorphic weighted sum.
- `encrypted_federation.py` — `BlindAggregator`, `EncryptedLab`, `run(...)`, plaintext reference and comparison.
- `keygen.py` — writes `public.json` (aggregator + labs) and `private.json` (key holders only; git-ignored).
- Legacy nine-class client/strategy/simulation are in `archive/pre_four_class/module5_encryption/`.

## Run

```sh
pip install -r "Module 5 Encryption/requirements.txt"      # phe (+ optional gmpy2, ~6x faster)
python "Module 5 Encryption/encrypted_federation.py" --model <centralized model dir> \
    --out <new output dir> --rounds 20 --bits 2048 --compare-plaintext
```

`--model` is the Module 3 centralized bundle (e.g. `four_class_v1/seed42/centralized/model`),
`--out` must not exist. The run selects a round by global validation exactly as
Module 4 does; the test split is never used. `--compare-plaintext` also runs plaintext
FedAvg with the same labs/split and writes `equivalence_report.json`.

## What the aggregator checks (without seeing plaintext)

Lab ID allow-list and duplicates, row counts, shared-preprocessor hash, training
settings, ciphertext layout/size, and that all labs report the **same** received-global
hash. It cannot check that weights are finite or plausible, so **it cannot detect a
poisoned but well-formed update** (plaintext Module 4 can). Labs check finiteness after
decrypting.

## Cost

Per lab per round, 2,916 encryptions plus 2,916 decryptions, plus the aggregator's
serialization/randomization of the sum. Measured here with gmpy2: about 10 s (1024-bit)
or 49 s (2048-bit) per lab-round. Without gmpy2 it is roughly 6x slower.

## Honest limits

- All labs share **one** keypair, and the simulation adds a key-authority role that
  decrypts each aggregate for validation. Threshold Paillier (no single key holder) is not implemented.
- Transport is in-process serialized bytes. No network TLS/mTLS is exercised here;
  the Module 4 TLS check covers the plaintext transport only.
- Encryption protects the aggregator's view, not against a curious lab, and provides no
  differential privacy: the decrypted global model still reveals information about the training data.
- Weights are Paillier fixed-point encoded. In the recorded 2048-bit run the decrypted
  aggregates were identical to plaintext FedAvg after the float32 cast; the tests only
  require agreement within 1e-4, so exact equality is an observation, not a guarantee.
- No performance or privacy improvement is claimed; this module shows the aggregator can be blind.
