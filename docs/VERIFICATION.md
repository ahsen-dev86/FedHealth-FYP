# Verification evidence

Branch: `feat/four-class-ml-federation`. Checks use the new 3,200-row release.
This report distinguishes execution evidence from work still requiring a runtime.

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
comparison is retained. The complete three-seed federation matrix is running;
its measured summary will be added when finished. Local artifacts and logs are
under `run-results/verification/` and are excluded from Git.

## Docker boundary

No Docker executable/engine was available. Dockerfiles and the standalone
federation compose paths were reviewed; no Docker build or container run is
claimed. The historical full-stack assembly templates remain separate work.

## External acceptance gates

- User-run Colab notebooks, frozen three-seed/20-round matrix and final test.
- Fresh source-exclusion sensitivity analysis; report weaknesses honestly.
- Docker build/run requires an available Docker engine. Static path checks are
  not a Docker execution result.
- Module 5 four-class encryption equivalence and full Module 9 deployment are
  separate work and are not claimed by Module 3/4 tests.

No medical accuracy, clinical stability or improvement over round 0 is guaranteed.
