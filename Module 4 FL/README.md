# FedHealth Module 4 — Federated Learning

Module 4 is the plaintext Flower/FedAvg baseline for the trained Module 3 Model A ANN.
Each lab keeps its CBC rows locally and sends ANN parameters plus example counts to the server.
The server loads Module 3's `ann.keras` as the round-zero global model. The shared Module 3
preprocessor gives every lab the same 14-feature order and scaling.
Module 4 does not exchange or train the XGBoost head. Module 5 adds Paillier encryption.

## Actual files

- `prepare_training_split.py`: excludes Module 3 validation/test rows.
- `partition.py`: creates IID or non-IID lab shards.
- `task.py`: shared model, preprocessing and metrics.
- `lims_wrapper.py`: mock local LIMS reader and unit normalization.
- `client.py`: Flower lab client.
- `strategy.py`: explicit example-weighted FedAvg.
- `server.py`: standalone server with optional TLS.
- `run_simulation.py`: in-process Flower/Ray simulation.
- `fl_artifacts.py`: saves and reload-checks the final ANN.
- `gen_certs.sh`: creates demo TLS files.
- `Dockerfile` and `Dockerfile.client`: server and client images.

There are no Module 4 notebooks or notebook generator.

## Correct execution order

Run commands from the repository root. Module 3's `preprocessor.joblib` and `ann.keras`
are required.
Every model output path must be new because Module 4 refuses to overwrite evidence.

1. Install: `python -m pip install -r "Module 4 FL/requirements.txt"`
2. Prepare only Module 3 training rows:
   `python "Module 4 FL/prepare_training_split.py" --csv anemia_diagnosed_cbc_data_v4.csv --out module4_training.csv`
3. Run a simulation:
   `python "Module 4 FL/run_simulation.py" --csv module4_training.csv --labs 3 --rounds 2 --mode non_iid --local-epochs 1 --shard-dir module4_shards --preprocessor /path/preprocessor.joblib --initial-model /path/ann.keras --output-dir /new/path/federated_ann`

The seed-42 split has 896 training, 128 validation and 257 test rows.
The simulation uses Ray clients on one computer; it is not a multi-machine deployment.

## Separate processes and TLS

Create shards with `partition.py`, then run `bash "Module 4 FL/gen_certs.sh"`.
Start `server.py` with `--labs`, `--rounds`, `--local-epochs`, `--preprocessor`,
`--initial-model`,
`--output-dir`, `--ca-cert`, `--server-cert`, and `--server-key`.
Start one `client.py` per lab with its own `--lab-id`, `--shard`, shared
`--preprocessor`, server address and `--ca-cert`.

The server controls local epochs, waits for every configured lab, and rejects
failed or duplicate updates. TLS is server-authenticated, not client-certificate mTLS.

## Docker

Build from the repository root:

- `docker build -f "Module 4 FL/Dockerfile" -t fedhealth-fl-server .`
- `docker build -f "Module 4 FL/Dockerfile.client" -t fedhealth-fl-client .`

The server image expects `/artifacts/preprocessor.joblib`, `/artifacts/ann.keras`,
and writable `/output`.
The client expects the preprocessor and a shard such as `/data/lab_00.csv`.
Docker Compose wiring is handled separately in Module 9.

## Privacy boundary

Raw CBC rows stay inside each client process. Module 4 sends plaintext ANN parameters,
example counts, lab IDs and metrics, so its server is not blind.
Module 5 is the encrypted variant. The shared preprocessor contains summary
statistics and feature order, not raw patient rows.

## Tested compatibility

Validated with Python 3.13, Flower 1.24.0, Ray 2.51.1 and TensorFlow 2.20.0.
Flower's classic APIs are deprecated, so versions must be revalidated before upgrade.
Testing covered three clients, two non-IID rounds, FedAvg, normalization, TLS,
checkpoint save/reload, checksums and the 257-row held-out test.
This is software validation, not clinical validation or a final performance claim.
