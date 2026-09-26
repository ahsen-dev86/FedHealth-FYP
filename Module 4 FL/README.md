# Module 4 — validated four-class ANN federation

This module fine-tunes the exact verified Module 3 ANN. It uses plaintext FedAvg.
Only the ANN is federated; the Colab XGBoost head is a centralized reference refit.
Module 5 Paillier and full Module 9 integration are separate work.

## Manual simulation

Use Module 3 notebook `04_federated.ipynb`, or from the repository root:

```sh
python "Module 4 FL/run_simulation.py" --model artifacts/seed42/centralized/model --out artifacts/smoke --rounds 2
python "Module 4 FL/run_experiments.py" --out artifacts --seeds 42 52 62 --rounds 20
```

The suite reuses a verified seed-42 centralized run and trains fresh references
for seeds 52 and 62. Each seed runs IID, Dirichlet alpha 0.5, Dirichlet alpha 0.1
(three labs each), and source partitions (five labs), always 20 rounds and one
local epoch. Every lab participates; optimizer Adam 0.0001 is fresh per round,
batch size 32, no local class reweighting, no local resplitting or synthetic data.
All 2,240 training rows are assigned once. Exact duplicate feature groups stay
at one lab; a cross-split duplicate fails the data audit.

Simulation executes Flower NumPyClient/strategy callbacks sequentially to bound
memory, without Ray. The gRPC path uses those same implementations. This public-
data simulation is not proof of patient privacy. The reference ANN and preprocessor
already used all training rows; these experiments measure federated fine-tuning.

## Strict checks

The aggregator requires exactly the configured labs and counts; rejects unknown,
duplicate or missing labs, non-finite values, wrong shapes/types, mismatched
starting weights and preprocessor hashes; and averages by actual row counts.
Local training diagnostics aggregate confusion counts before metrics. They are
explicitly not held-out scores. Central validation selects rounds, with test locked.
Round histories and optional returned/aggregated tensors allow independent FedAvg
arithmetic checks. Artifact reload verifies selected weights and predictions.

Every round, including round 0, is considered. Select lowest validation log loss
with macro-F1 no more than 0.05 below round 0 and no additional nonhealthy-to-
healthy errors. Ties retain the earlier round. All rounds execute. Round-zero
selection is recorded explicitly and must not be presented as a federated gain.
These rules are experiment safeguards, not a clinical safety guarantee.

## Separate client/server processes

First export benchmark shards and a validation-only server file:

```sh
python "Module 4 FL/prepare_labs.py" --model artifacts/seed42/centralized/model --out artifacts/labs
python tools/verify_transport.py --model artifacts/seed42/centralized/model --out artifacts/tls_smoke
```

The verification tool launches a real server and three clients for two rounds,
with temporary CA/server certificates. Its result and process logs are retained.
It verifies server-authenticated TLS, not mTLS. Lab IDs and hashes are consistency
checks, not authentication against an adversarial participant. Missing TLS files
fail; plaintext requires explicit `--insecure-dev` at both ends.

Standalone commands accept `--model`, `--plan`/`--validation` (server), `--shard`
and `--canonical-units` or `--units-json` (client). Use `--help` for all arguments.
The server does not read client training CSVs. It saves an ANN-only bundle because
it has no lab data for a local XGBoost head. Such a bundle cannot be served as a
hybrid until a head is trained locally against that exact ANN.

## Docker

`compose.yml` is a standalone three-lab development configuration using the actual
repository paths. Set FEDHEALTH_MODEL_DIR, FEDHEALTH_LABS_DIR and FEDHEALTH_OUTPUT_DIR
to absolute paths, then run `docker compose -f "Module 4 FL/compose.yml" up --build`.
It explicitly uses insecure transport on its development network. Mount only each
lab's own CSV; the coordinator receives only the plan and validation CSV. For TLS,
provide certificates and replace the insecure flag with the documented TLS options.
Check `docs/VERIFICATION.md` before claiming a Docker build was executed.

## Final reporting

Review validation first, freeze all configurations, then:

```sh
python -m fedhealth_ml.final_evaluate --plan artifacts/final_evaluation_plan.json --out artifacts/final_test
python -m fedhealth_ml.source_holdout --out artifacts/source_holdout
```

The final phase evaluates every fixed model once, with explicit per-class recall,
subtype/source analysis, ECE and confusion counts. The source analysis is a fresh
training sensitivity run; existing donor imputation still limits independence.
Keep all seeds and negative findings. Use seed 42 for integration by prior policy,
not whichever seed happens to score highest. Do not delete old fix branches until
this branch is verified, reviewed and merged.
