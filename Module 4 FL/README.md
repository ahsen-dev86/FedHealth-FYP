# Module 4: federated ANN experiment

Module 4 federates **only Model A's ANN**. Each lab trains on its own CBC shard;
the server calculates example-weighted FedAvg from the returned ANN weights.
XGBoost is a local head to train later on the selected ANN's embeddings. This
module neither trains nor aggregates XGBoost. Module 4's server sees plaintext
weights. TLS protects transport; it does **not** make the server blind. Module 5
is the separate encryption work.

Run these commands from the repository root in a Python environment with
`Module 4 FL/requirements.txt` installed. Every output path must be new.
These commands use the canonical CSV shipped with the project. A changed dataset
requires a new split and new model results.

## 1. Make one locked, duplicate-aware split

```bash
python "Module 4 FL/make_splits.py" \
  --csv anemia_diagnosed_cbc_data_v4.csv \
  --out /new/path/module4_split --labs 3 --alpha 0.5 --seed 42
```

Rows with the same cleaned 14-feature CBC vector stay together even if labels
conflict. Without patient IDs, this prevents identical-row leakage but cannot
prove that two different rows did not come from the same patient. The tool
reserves about 20% for test and 10% for validation. Of the
remaining training rows, about 20% become the reference slice and 80% become
three non-IID lab shards. Exact counts can differ because groups cannot be
split. `split_manifest.json` records the class counts, Dirichlet alpha, seed and
SHA-256 of every file. **Keep this split fixed for all experiment seeds.**
This is a simulation made from one central CSV; it is not evidence that several
real laboratories kept their source data private.

The locked test CSV is an ordinary file, not an access-control mechanism. The
training code never opens it. `final_evaluate.py` is the only supplied command
that reads it, and requires `--final-test`.

## 2. Train the separate starting ANN

```bash
python "Module 4 FL/train_reference.py" \
  --split-dir /new/path/module4_split \
  --out /new/path/reference_seed42 --seed 42
```

Only `reference.csv` fits the shared imputer/scaler and trains this ANN.
Validation is used for early stopping; the labs and locked test are not used.
The output contains `ann.keras`, `preprocessor.joblib` and `manifest.json`.

## 3. Disposable flow check: 3 labs, 2 rounds

```bash
python "Module 4 FL/smoke_federation.py" \
  --split-dir /new/path/module4_split \
  --reference-dir /new/path/reference_seed42 \
  --output-dir /new/path/smoke_model \
  --audit-dir /new/path/smoke_weights --seed 42
```

This checks that each lab received the expected global weights, records each
lab's returned weights and reported training-row count, independently
recalculates FedAvg from the saved arrays, and verifies that the saved ANN
matches the **selected validation round** after reload. The selected round may
be 0, 1 or 2, so the saved ANN is not necessarily the last round's weights.
This smoke run is engineering evidence, not a performance result. The audit
directory contains plaintext model weights; keep it local.

## 4. Full experiment in Colab

```bash
python "Module 4 FL/run_experiments.py" \
  --split-dir /new/path/module4_split \
  --output-dir /new/path/module4_experiments \
  --seeds 42 52 62 --rounds 20 --local-epochs 1
```

For each seed, this trains a new reference ANN from the **same reference rows**,
then runs warm-start FedAvg, cold-start FedAvg, three separate warm-start
local-only models, and one centralized warm-start comparator. Centralized is a
comparator, not a guaranteed upper bound. The full run uses validation only.
It writes `results.csv`, `results.json`, seed-specific reference artifacts and
federated ANN checkpoints. Scores are reported as mean and sample standard
deviation across seeds. Each local-only lab has its own result row.

All 20 rounds run. Among rounds meeting the **predeclared** safety rules, the
lowest validation log loss wins. By default a round may lose at most 0.05
macro-F1 against round 0 and may add **zero** sick-called-Healthy errors.
Set `--max-macro-f1-drop` and `--max-extra-sick-healthy` before running if your
team adopts different limits. If no later round qualifies, round 0 remains the
selected artifact and must be described as **not improved by federation**.

Seed 42's warm-start run is predeclared as the integration candidate. Do not
choose another seed because it happened to score better on validation.

## 5. One final locked-test evaluation

Only after settings and the integration candidate are frozen:

```bash
python "Module 4 FL/final_evaluate.py" \
  --split-dir /new/path/module4_split \
  --model-dir /new/path/module4_experiments/warm_fedavg_seed42 \
  --final-test
```

The command checks input and artifact hashes, evaluates the predeclared model,
and creates `final_test_metrics.json`. It refuses to overwrite that result.
The per-disease recall counts and sick-called-Healthy count are included.
This is a process guard, not a technical guarantee against someone manually
opening `locked_test.csv` or copying the experiment directory.

## Separate client/server processes

`server.py` and `client.py` use the same fresh-per-round client and validated
FedAvg strategy. The server needs the split manifest and validation CSV, but
does not need raw lab shards. Each lab needs its own shard and the **same**
`preprocessor.joblib` file. The server validates reported lab IDs and row
counts against the manifest; this does not prove a lab's claim is genuine.

The server requires a CA certificate, server certificate and key. Each client
requires a CA certificate. A missing configured file stops startup. For a
local-only plaintext connection, both sides must explicitly use
`--insecure-dev`. TLS here is server-authenticated, not client-certificate
mTLS. Module 9 Docker wiring must be updated before using these changed
standalone arguments in Compose.

Simulated shards come from the canonical CSV: start each client with
`--canonical-units`. A real lab report instead needs `--units-json units.json`,
with a declared unit for every Model A feature. The connector converts by
those rules and rejects impossible values. For example, HCT declared as
`fraction` converts 0.38 to 38%; HGB declared as `g/L` converts 124 to 12.4
g/dL. Start with `MODEL_A_UNITS` in `Module 3 ML/schema.py` and change only
the fields that use different units at that lab. Canonical training CSVs use
Module 3 cleaning: impossible values become
missing and are filled by the reference-fitted preprocessor. Neither path
guesses a unit from the measured value.

The Module 4 Dockerfiles reflect these new paths and fail if their mounted
certificates are absent. Docker builds and the Module 9 Compose integration
have not been exercised in this branch.

## Checks and limits

```bash
python -m unittest discover -s "Module 4 FL/tests" -v
python -m compileall -q "Module 3 ML" "Module 4 FL"
```

Unit checks cover duplicate separation on the real CSV, explicit units,
two-round three-lab FedAvg arithmetic, malformed updates, pooled metrics,
validation safety selection and TLS fail-closed behavior. A full Flower / Ray /
TensorFlow run requires the Colab environment; a local syntax or unit-test pass
alone does not establish that all 20 rounds trained or that performance is good.
The 20-round results and final test metrics should be reviewed before any
integration. Per-lab XGBoost, Module 5 encryption and Module 9 Docker changes
remain separate work.
