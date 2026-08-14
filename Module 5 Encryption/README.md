# FedHealth — Federated Learning Module (Module 4)

The Lab Tier (Flower clients), the Server Tier (blind aggregator), and FedAvg.
Federates the **Model A ANN** from Module 3; the XGBoost head stays local per
lab (trees aren't weight-averageable). Consumes the Module 3 preprocessor so
every lab produces identical feature vectors.

## Layout
```
fl/
├── common/
│   ├── partition.py   # split one dataset into N lab shards (iid / non_iid)
│   └── task.py        # shared model build, preprocessor, partition loading, metrics
├── client/
│   ├── lims_wrapper.py  # mock LIMS connector + normalization (6.3.1)
│   ├── client.py        # Flower NumPyClient: local training engine (6.3.2)
│   └── Dockerfile
├── server/
│   ├── strategy.py    # FedHealthStrategy: explicit FedAvg with Paillier hooks (6.4.2)
│   ├── server.py      # Flower server, optional TLS (6.4)
│   └── Dockerfile
├── run_simulation.py  # one-command in-process federation (no Docker)
├── scripts/gen_certs.sh
└── requirements.txt
```

## Run it — simulation (easiest, no Docker)
```bash
pip install -r fl/requirements.txt
python fl/run_simulation.py \
  --csv anemia_diagnosed_cbc_data_v4.csv --labs 4 --rounds 5 --mode non_iid
```
This partitions the data into 4 labs, trains them in-process, and prints the
global model's weighted macro-F1 per round.

## Run it — real client/server processes (what Docker Compose uses in Module 9)
```bash
# 1. Partition into shard files
python fl/common/partition.py --csv anemia_diagnosed_cbc_data_v4.csv \
  --out fl/client/data --labs 4 --mode non_iid
# 2. (optional) TLS certs
bash fl/scripts/gen_certs.sh
# 3. Start the server
FL_LABS=4 FL_ROUNDS=5 python fl/server/server.py
# 4. Start each lab (new terminal each), e.g. lab 0:
LAB_ID=lab-00 SHARD_CSV=fl/client/data/lab_00.csv python fl/client/client.py
```

## Privacy model — where this module stands
- **Raw data never leaves the lab.** The mock LIMS reads the shard, normalizes,
  trains locally; only ANN weights + an example count are returned. ✔ (holds now)
- **Server never sees plaintext weights.** ✘ **not yet** — this module does
  plaintext FedAvg. Module 5 (Paillier) makes the server blind; `strategy.py`
  already marks the two "PAILLIER HOOK" points where encrypted aggregation slots
  in. This is expected: Module 4 builds the FL scaffolding, Module 5 adds the
  crypto.

## Module 5 — Paillier encryption (the server becomes blind)
The encrypted variant lives alongside the plaintext baseline so you can demo both:

```bash
pip install phe            # already in fl/requirements.txt
# one-command encrypted federation (server never decrypts):
python fl/run_simulation_paillier.py --csv anemia_diagnosed_cbc_data_v4.csv \
    --labs 3 --rounds 3 --bits 1024
```
For the real client/server split, generate keys first — the **private key goes to
labs only, never the server**:
```bash
python fl/keygen.py --out fl/keys --bits 2048    # writes public.json + private.json
```

How it stays blind: labs encrypt weight updates with the **public** key; the
server computes `E(Σ nᵢ·wᵢ)` with homomorphic add + scalar-multiply (public-key
ops) and **never decrypts or divides**; the labs (holding the **private** key)
decrypt and divide by `N`. Verified: this reproduces plaintext FedAvg to ~1e-7.

Files: `ml/fedhealth_ml/paillier_utils.py` (crypto core), `fl/common/crypto.py`
(Parameters bridge), `fl/server/strategy_paillier.py` (blind aggregator),
`fl/client/client_paillier.py` (decrypt→train→encrypt), `fl/keygen.py`.

## Decisions / simplifications (for defense)
- **Shared preprocessor as an agreed normalization standard.** All labs use one
  preprocessor (from Module 3) so feature vectors are comparable — it holds only
  summary statistics, not patient data, so raw data still never leaves. Fully
  federated normalization is a future enhancement.
- **Paillier key custody & threshold.** Labs share one keypair; the server holds
  only the public key. A production system would use *threshold* Paillier so no
  single lab holds the full private key either — documented next step, out of FYP
  scope.
- **Key size 1024 for the demo, 2048+ for security.** Paillier encrypts every
  weight (~3.3k per round for this ANN), so 2048-bit is slow; the size is a CLI
  flag with the trade-off noted.
- **TLS, not full mTLS.** Flower's classic API gives server-authenticated TLS
  (clients verify the server via the CA). True mutual TLS (server verifying each
  lab's client certificate) isn't exposed simply there; labs instead present an
  `fl_client_id`. Client-cert mTLS is a deployment hardening step — flagged
  because the scope says "mTLS".
- **Flower pinned to `>=1.8,<1.13`** for the stable classic API used here.
- **Only the ANN federates; XGBoost is local** (per the Module 3 architecture).
