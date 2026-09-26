# Verification evidence

Branch: `feat/four-class-ml-federation`. Checks use the new 3,200-row release.
This report distinguishes execution evidence from work still requiring a runtime.
The user-run Colab Module 3 audit, preprocessing and centralized validation are
recorded separately in [COLAB_MODULE3_RUN_2026-09-26.md](COLAB_MODULE3_RUN_2026-09-26.md).
Those scores differ from the local seed-42 run below and must not be combined.

## Executed checks

- **33 pytest tests passed**, including real TensorFlow/XGBoost training,
  verified artifact reload, actual three-lab/two-round Flower aggregation,
  deterministic fresh optimizers, API scoring and invalid requests, plus the
  final-evaluation lock exercised on a validation-only fixture. No real test
  predictions were made by these checks.
- Separate Flower server and three client processes completed two rounds over
  **server-authenticated TLS**. The protocol check selected round 0 and reloaded
  the saved checkpoint. This verifies TLS, not mTLS.
- Dependency consistency: `uv pip check` passed for all 85 installed packages.
  Requirements dry-run found no changes. Python 3.12.14, TensorFlow 2.20.0,
  Keras 3.15.1, XGBoost 3.1.1, Flower 1.24.0, scikit-learn 1.7.2.
- All four notebooks passed nbformat validation and code-cell syntax compilation.
- Changed JavaScript passed syntax checks; the registry version/class-order
  behavior test passed without a database.
- `git diff --check` passed. Dataset/provenance audit is in `dataset_audit.json`.
- Latest two handoff pastes have identical SHA-256 hashes. Both supplied Word
  documents were reconciled in `FOUR_CLASS_SCOPE_RECONCILIATION.md`.

Keras emitted a NumPy array-copy deprecation warning during persistence. It did
not cause a failed check or a reload/prediction mismatch.

## Seed 42 Module 3 validation

The full protocol stopped at 59 epochs (maximum 100, patience 10). These are
**validation**, not test, scores; no tuning was performed from the test split.

| Model | Accuracy | Macro-F1 | Leukemia recall |
|---|---:|---:|---:|
| ANN | 0.8646 | 0.8647 | 0.8417 |
| ANN-XGBoost hybrid | 0.8563 | 0.8560 | 0.8083 |
| Logistic regression | 0.8000 | 0.7996 | 0.7417 |
| Random forest | 0.8729 | 0.8728 | 0.8333 |

The hybrid works, but did not improve on the ANN in this run. This negative
comparison is retained. The remaining three-seed federation matrix was stopped at the user's request.
Completed validation runs are recorded in `local_validation_completed.json`;
incomplete runs are not counted as results. Local artifacts and logs are
under `run-results/verification/` and are excluded from Git.

## Docker boundary

No Docker executable/engine was available. Dockerfiles and the standalone
federation compose paths were reviewed; no Docker build or container run is
claimed. The historical full-stack assembly templates remain separate work.

## External acceptance gates

- User-run Colab Module 4, frozen three-seed/20-round matrix and final test.
- Fresh source-exclusion sensitivity analysis; report weaknesses honestly.
- Docker build/run requires an available Docker engine. Static path checks are
  not a Docker execution result.
- Module 5 four-class encryption equivalence and full Module 9 deployment are
  separate work and are not claimed by Module 3/4 tests.

No medical accuracy, clinical stability or improvement over round 0 is guaranteed.

## Final boundary requested by the user

Further training was stopped. No additional model runs will be started here.
The automated heavy workflow is now manual-only. Its initial GitHub runs failed
at dependency installation, before training; they are not a Linux/Docker pass.
Requirements includes were simplified to paths without spaces. The final code
and notebook checks remain separate from user-run Colab acceptance.

## Module 5 encrypted aggregation (added after the Colab runs)

- New `Module 5 Encryption/encrypted_federation.py` runs the Module 4 lab clients with
  Paillier-encrypted ANN updates and a public-key-only `BlindAggregator`. Legacy nine-class
  Module 5 code is archived in `archive/pre_four_class/module5_encryption/`.
- `tests/test_encryption.py`: 14 tests pass (homomorphic sum equals plaintext FedAvg, the
  aggregator holds no private key, ciphertext randomization, nine rejection cases, and a real
  2-round encrypted-vs-plaintext federation at 1024-bit keys with weights within 1e-4).
- Equivalence run at **2048-bit keys**, 3 labs, 3 rounds, on a quick throwaway centralized model
  (5 epochs, 20 trees, so accuracy is not meaningful): maximum absolute difference between
  decrypted-encrypted and plaintext aggregated weights was **0.0** in every round, and validation
  log loss and macro-F1 were identical. Runtime 626 s for 3 rounds (about 70 s per lab-round with
  gmpy2). The plaintext reference uses Module 4's `aggregate_updates` and `LabClient`
  (the Flower wrapper was not installed in this environment, so that path was not the comparator).
- Full local suite: 47 passed, 1 failed. The failure is
  `test_three_labs_two_rounds_real_fedavg`, which imports `flwr`; `flwr` is not installed in this
  Python environment (requirements-test.txt pins it). Not caused by these changes.
- Limits: one shared keypair plus a key-authority role that decrypts each aggregate for validation;
  no threshold Paillier; in-process serialized transport (no TLS exercised for the encrypted path);
  a blind aggregator cannot detect a poisoned but well-formed update; no privacy proof is claimed.
- Not run: a 20-round encrypted run on the real Colab seed-42 model.

## Unit normalization fix

Report-style unit strings `/mm3`, `mil/mm3` (and `x10^3/uL`, `x10^6/uL`, `gm/dL`) were rejected.
They are now accepted with explicit conversion; units are still never inferred from magnitude, and
unsupported units such as mmol/L are rejected. Covered by `test_report_style_unit_strings_are_accepted`.
