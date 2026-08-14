# FedHealth

**A Privacy-Preserving Federated Framework for Epidemiological Intelligence and Disease Prediction**

Final Year Project · Air University Islamabad

| | |
|---|---|
| **Team** | Muhammad Ahsan (231586) · Muhammad Usman Iqbal (231580) · Muhammad Annas (231631) |
| **Supervisor** | Sir Sagheer Ahmed |
| **Co-supervisor** | Ms Nazish Yousaf |

---

## Overview

### The problem

Pakistan carries one of the highest global burdens of several blood-related disorders, yet these are frequently caught late. Specialised confirmatory tests (bone-marrow biopsy for leukemia, haemoglobin electrophoresis for thalassemia) are expensive or unavailable in rural areas, so a **predictive gap** opens between when a routine blood count first shows a signature and when the condition is confirmed. At the same time, data-privacy regulation (the Personal Data Protection Bill, **PDPB 2023**) prevents laboratories from pooling raw patient records to build shared diagnostic tools. The national health response is therefore fragmented and reactive.

### The solution

FedHealth is a decentralised software ecosystem that resolves the tension between data utility and data privacy using **Federated Learning (FL)**. Instead of moving data to the model, it moves the model to the data. Pathology laboratories train a shared diagnostic model on their own local Complete Blood Count (CBC) data; only model parameters — never raw records — ever leave a lab, and even those parameters are encrypted. The resulting "collective intelligence" is served back to general practitioners as real-time diagnostic confidence and to the National Institute of Health (NIH) as an anonymised surveillance dashboard.

> **A recurring theme:** the system never emits a categorical diagnosis. Every automated output is a set of **calibrated confidence scores**; the treating doctor confirms the diagnosis. This is reflected in the database schema, the model, the inference service, and the user interface alike.

---

## The two privacy guarantees

Everything in the system is built to preserve two guarantees end to end:

1. **Raw patient data never leaves the lab.** Normalisation and training happen inside the lab; only model weights are exchanged.
2. **The central server never sees plaintext weights.** Weight updates are homomorphically encrypted with the **Paillier** cryptosystem; the server aggregates over ciphertext and never holds the decryption key.

These two sentences are the reason the architecture looks the way it does.

## The three tiers

| Tier | Role |
|---|---|
| **Lab Tier** | A containerised Flower federated-learning client per laboratory. Wraps the local LIMS, normalises CBC values, trains the neural network locally, and encrypts the resulting weight update. |
| **Server Tier** | A *blind* aggregator. Receives encrypted weight updates, combines them with Federated Averaging (FedAvg), and redistributes the refined global model — all without ever decrypting anything. |
| **Consumer Tier** | Two role-specific web applications: the **Doctor Portal** (clinical decision support) and the **NIH Dashboard** (national surveillance). |

Cutting across all three tiers are **role-based access control** with mandatory **multi-factor authentication** and an **immutable, tamper-evident audit log** — both required for PDPB 2023 compliance.

## Technology stack

- **Frontend:** React, Leaflet.js (geospatial visualisation)
- **Backend API:** Node.js / Express
- **Federated learning:** Flower (`flwr`)
- **Model logic:** Python, TensorFlow (neural network), XGBoost (gradient-boosted meta-learner)
- **Encryption:** Paillier (`phe`) homomorphic encryption
- **OCR:** Tesseract
- **Database:** PostgreSQL 16 with the PostGIS extension

---

## Foundational data decisions

Before any module was written, the three supplied datasets were profiled directly. The findings reshaped the modelling plan and are essential background.

| Dataset | Shape | Verdict |
|---|---|---|
| `anemia_diagnosed_cbc_data_v4.csv` | 1,281 rows, 14 CBC indices + Diagnosis | **The real multi-disease workhorse** (needs cleaning) |
| `thalassemia_alphanorm.csv` | 203 rows, CBC + electrophoresis + phenotype | Alpha carriers **not separable** from a blood count |
| `biased_leukemia_dataset.csv` | 143,194 rows, 21 mixed columns + Leukemia_Status | **No predictive signal** — excluded |

- **Finding 1 — the "biased" leukemia dataset has no predictive signal.** Every feature was statistically identical across the label, including bone-marrow-blast percentage (49.9 vs 49.5). No Pakistani data (only India, USA, Brazil, Russia, China, UK). *Decision:* excluded from modelling; leukemia signal is sourced instead from the real Leukemia rows inside the anemia dataset. The biased file was repurposed as a documented data-validation and fairness case study.
- **Finding 2 — the anemia dataset is a multi-condition CBC classifier in disguise.** Its Diagnosis column has nine classes (Healthy, four anemia subtypes, Thrombocytopenia, two leukemia classes). It contained physiologically impossible values requiring range-based cleaning. *Decision:* became the basis of **Model A**.
- **Finding 3 — alpha-thalassemia is not separable from a CBC** (ROC AUC ≈ 0.50). *Decision (the "A + B" strategy):* an interpretable **rule layer** (Mentzer index and discriminant formulas) available immediately, plus **Model B** re-pointed from alpha carriers to beta-thalassemia trait, dataset-ready with a separability guard.
- **Finding 4 — the output shape is confidence, not categories.** The model's only output is a calibrated per-condition confidence vector; Healthy is a first-class scored class; training uses balanced class weights and reports per-class metrics.

---

## Modules

The system is organised as ten build modules, each in its own folder.

### [Module 1 — Database](Module%201%20Database) (the backbone)
The persistence layer where several guarantees are enforced *structurally*. PostgreSQL 16 + PostGIS: ten tables plus a `nih_prediction_clusters` view. Highlights:
- **RBAC lives in tables, not code** — the NIH role is granted only `nih:dashboard`, `nih:alerts`, `audit:read`.
- **No categorical diagnosis is stored** — predictions hold a `scores` JSONB; the only authoritative field is `confirmed_condition`, null until a doctor writes it.
- **Pseudonymous patients** — `patient_ref` is an opaque token (e.g. an HMAC), never a name or national ID.
- **The NIH privacy boundary is a SQL view** — district-level aggregates only.
- **Genuinely immutable audit log** — SHA-256 hash-chained rows, insert triggers, revoked UPDATE/DELETE, and a `verify_audit_chain()` function.

### [Module 2 — Authentication](Module%202%20Authentication) (RBAC, MFA, audit)
Node.js / Express security layer. **MFA is structurally mandatory** — a correct password returns only a short-lived *pre-authentication* token; only `/auth/mfa/verify` and `/auth/mfa/verify-setup` issue the full access token, so no protected route is reachable without completing MFA. TOTP via `speakeasy`, passwords via `bcryptjs`, validation via `zod`, hardening via `helmet`/`cors`/`express-rate-limit`. Brute-force lockout, no user enumeration, admins cannot self-register.

### [Module 3 — Machine Learning](Module%203%20ML) (preprocessing + Colab notebooks)
The modelling core. A shared `fedhealth_ml` package (`schema.py`, `preprocess.py`, `models.py`, `rules.py`) ensures notebooks, Flower clients, and the inference service preprocess **identically**.
- **Hybrid ANN → XGBoost:** the **ANN is the federated component** (weights are averageable/encryptable); **XGBoost is a local meta-learner** stacked on the ANN embedding (trees are not weight-averageable).
- **Calibrated output** via temperature scaling; class imbalance handled with balanced weights. Proxy Model A reached macro-F1 ≈ 0.88 with Healthy recall ≈ 0.96.
- **Real-world unit normalisation** validated against a real IDC blood-count report (produced 99% combined anaemia confidence, no false leukemia alarm).
- Four Colab-ready notebooks: EDA, preprocessing, Model A training, Model B training.

### [Module 4 — Federated Learning](Module%204%20FL) (Flower)
The federated-learning machinery: Lab Tier clients, the Server Tier FedAvg aggregator, and data partitioning (IID and non-IID via a Dirichlet distribution). The strategy writes out the FedAvg weighted average **explicitly**, leaving a clean seam for encryption. A mock LIMS wrapper reads a local CSV shard. **Honest caveat:** at the end of Module 4 the server is *not yet blind* — that is what Module 5 adds.

### [Module 5 — Paillier Homomorphic Encryption](Module%205%20Encryption) (the blind server)
Delivers the second privacy guarantee. Paillier is **additively homomorphic**, so the server computes the encrypted weighted sum using only ciphertext and the public key — it never divides and never decrypts. **Key custody is the crux:** the public key goes to the server and all labs; the **private key goes only to the labs**. Validated end to end: reproduced plaintext FedAvg to within ~1.2 × 10⁻⁷ with the server holding only ciphertext.

### [Module 6 — Domain API & Inference Service](Module%206%20Domain%20API)
The layer that connects everything: an Express domain API plus a Python **Flask** inference microservice (called over HTTP). Turns a stored CBC into calibrated confidence scores and the thalassemia rule flag, persists predictions, runs alerting, serves NIH aggregates, handles **OCR** ingestion (Tesseract) and **multilingual symptom** parsing (English / Urdu / Roman-Urdu). **Graceful degradation** picks one of three backends per model: real federated model → scikit-learn fallback → rules-only.

### [Module 7 — Doctor Portal](Module%207%20Doctor%20Portal) (React)
Point-of-care web app for general practitioners, plus the shared React shell. A deliberate **"clinical instrument"** design: monospace clinical values, deep-teal palette, red reserved for risk flags. Features CBC entry, OCR upload, multilingual symptom intake (with optional Web Speech voice dictation), the ranked confidence readout, the thalassemia rule-flag card, doctor confirmation, and longitudinal trend charts.

### [Module 8 — NIH Dashboard](Module%208%20NIH%20Dashboard) (React)
National-surveillance app at the `/nih` route, reusing the Module 7 shell. Three tabbed views: **Surveillance** (Leaflet map — proportional circle markers and a heat layer, with filters and a cluster table), **Alerts** (predictive-alert feed with acknowledgement), and **Compliance** (audit-chain verification). Everything is district-level aggregate — the interface **structurally cannot** show patient points.

### [Module 9 — Docker Compose](Module%209%20Docker%20Compose) (the whole stack)
Brings up the entire system with a single command. Orchestrates a PostGIS database (auto-runs schema, seed, migration), the inference service, the Express backend (Tesseract baked in), and the React frontend behind nginx (which reverse-proxies the API for a shared origin). The **federation is an optional profile** (`docker compose --profile federation up`).

### [Module 10 — Documentation](Module%2010%20Documentation)
The documentation set: this top-level README, the per-folder READMEs, and the detailed technical explanation document. For a Final Year Project, the ability to explain and defend every decision is as important as the code.

---

## Getting started

> **Prerequisites:** Docker & Docker Compose. The three CSV datasets must sit at the repository root (the inference and FL images copy them in). If you change the application database password, change it in **both** the seed script and the environment file.

```bash
# Bring up the core stack (database, inference service, backend, frontend)
docker compose up --build
```

Services come up on:

| Service | Port |
|---|---|
| Frontend (nginx) | 8080 |
| Backend (Express) | 4000 |
| Inference service (Flask) | 8000 |

Create the first administrator with a one-line command against the running backend container (see [Module 9](Module%209%20Docker%20Compose)). The first admin must still enrol in MFA on first login.

```bash
# Opt-in: run the federated-learning training (Flower server + lab clients)
docker compose --profile federation up
```

To produce the real trained model artifacts, run the four Colab notebooks in [Module 3](Module%203%20ML); once the artifacts are present, the inference service serves the federated model instead of the scikit-learn fallback.

---

## Documented simplifications

Deliberate FYP-scope simplifications, each flagged where it was made:

- Labs share one preprocessor (summary statistics, not patient data); fully federated normalisation is future work.
- Paillier uses a single shared keypair (vs threshold Paillier) and a demo key size of 1,024 bits (vs 2,048+).
- Transport uses server-authenticated TLS (vs full client-certificate mutual TLS).
- Passwords use `bcryptjs` (vs argon2id) to avoid native-build friction.
- The inference service uses a scikit-learn fallback until trained artifacts are present, and auto-registers the served model on first use.
- Symptoms are decision-support context, not model input; the CBC model is CBC-only.
- The multilingual NLP is a keyword lexicon, not a transformer or translation API.
- The frontend keeps the token in local storage (vs an http-only cookie); voice uses the Web Speech API as a progressive enhancement.
- The Docker Compose federation runs plaintext FedAvg; the encrypted blind-server federation is shown via the one-command simulation.
- The mock LIMS reads a local CSV shard in place of a real hospital connector.

## Current status

All ten modules are built. Wherever the build environment allowed, work was validated by execution: the data pipeline, cleaning, Model A's proxy performance, the thalassemia rule layer, the Paillier homomorphic mathematics (matching plaintext FedAvg to ~1.2 × 10⁻⁷), the Flask inference service, and the OCR and symptom parsers all run and produce correct results; all import, syntax, and configuration checks pass.

Parts requiring the full runtime — the live Flower training loop, the Express app against a live PostgreSQL database, the Vite production build, and a live `docker compose up` — are syntax-checked and cross-wired but were not executed in the build environment (no network, no Docker/DB).

**Remaining team work:** running the Colab notebooks to produce the real trained artifacts, and sourcing a beta-thalassemia-trait dataset for Model B (the notebook is ready, with a separability guard).

---

## Glossary

| Term | Meaning |
|---|---|
| **ANN** | Artificial Neural Network; the model component that is federated and encrypted. |
| **CBC** | Complete Blood Count, the routine blood test whose indices are the model's input. |
| **FedAvg** | Federated Averaging; combines labs' model updates by an example-weighted mean. |
| **Federated Learning** | Training a shared model across data silos without moving the data. |
| **Homomorphic encryption** | Encryption permitting computation on ciphertext; Paillier is additively homomorphic. |
| **JWT** | JSON Web Token, the signed token carrying a session. |
| **LIMS** | Laboratory Information Management System. |
| **Macro-F1** | Average of per-class F1 scores weighting every class equally; reveals bias toward frequent classes. |
| **Mentzer index** | Mean cell volume ÷ red-cell count; below 13 suggests thalassemia trait, above 13 iron deficiency. |
| **MFA / TOTP** | Multi-Factor Authentication via a Time-based One-Time Password. |
| **PDPB 2023** | The Personal Data Protection Bill driving the privacy and audit design. |
| **RBAC** | Role-Based Access Control. |
| **Temperature scaling** | A calibration method that rescales confidence so reported percentages match real frequencies. |
