# Integration handoff (Phase A record)

> **Phase B is complete** (frontend, Model Health, OCR engine, input hardening, tests). The
> current state, contract matrix, problems/fixes and test results are in [INTEGRATION.md](INTEGRATION.md);
> how to run it is in [RUN_GUIDE.md](RUN_GUIDE.md). This file keeps the Phase A record; its §4 API
> notes are still accurate, its "open problems" list was worked through in Phase B.

Branch `feat/integration` (from `main` at `c0ff0d6`), local commits only; nothing has been pushed
or merged. Phase A covered the database, inference service, backend, model registry, FL history
and encryption evidence, with API/SQL-level acceptance. **Phase B (frontend alignment, Model
Health UI, `docs/INTEGRATION.md`) has not been started.** Read this file first, and don't redo
anything listed under "Done".

## 1. Done in Phase A

| Area | Result | Where |
|---|---|---|
| Model check | Seed-42 bundle `v2-four-class-seed42-b24108b19482` loads in `.venv` (TF 2.20.0 / Keras 3.15.1). The example report with printed units scores anemia 0.588, healthy 0.224, thalassemia 0.169, leukemia 0.019 (WBC 9,010/mm3 → 9.01; PLT 147,000/mm3 → 147) | `Module 6 Domain API/` |
| Database | `fedhealth` on local PostgreSQL 18 (port 5432), PostGIS 3.6.2, pgcrypto 1.4, citext 1.8; `init/001`–`010` applied with a SHA-256 ledger (`schema_migrations`); `fedhealth_app` has a random password (the 005 placeholder is never used); app role cannot UPDATE/DELETE `audit_logs` | `Module 1-2 Merged Backend/init`, `scripts/db-setup.js` |
| Four-class DB contract | `009`: CHECKs on `lab_reports.cbc` (keys ⊆ the 10 features, numbers inside `PLAUSIBLE_RANGES`, canonical units), `predictions.scores` (exactly the 4 classes, each in [0,1], sum 1 ± 0.001), `top_condition`/`top_confidence` = arg-max, `confirmed_condition` and `alerts.condition` ∈ 4 classes, `ml_models` `cbc_multiclass` classes in order; FL scenario/seed columns; demo labs renamed "Demo site - <district>" (report geography, not FL nodes). `010`: Module 6 columns (`rule_flags`, `symptoms`) plus `cbc_units`, `cbc_reported`, `imputed_features` | `init/009_*.sql`, `init/010_*.sql` |
| Canonical copies | Canonical: `Module 1-2 Merged Backend/init` + `src`, the Python service in `Module 6 Domain API/`, and `frontend/`. `Module 1 Database/` is marked superseded (its four-class migration is folded into `009`). The Module 6 Node files were **moved** into the backend. `Module 7 Doctor Portal/` and `Module 8 NIH Dashboard/` are older standalone frontend copies, not maintained (Phase B: add a "superseded by frontend/" note or remove them). `Module 2 Authentication/` is also an older copy of what is in the merged backend | READMEs |
| Backend wiring | Module 6 domain routes mounted at the root (see §4). Uses the zod validators; unit conversion and range checks come from the exported contract (`src/contract/cbcContract.json`, generated from `schema.py` + `normalize_units`). `/predict` stores the report and prediction in one transaction, after checking that the inference service converted units exactly as the backend did | `src/routes`, `src/services`, `src/validators` |
| Inference service | `FEDHEALTH_MODEL_DIR` serves the bundle directly. Unknown CBC/unit keys are rejected. `/infer` also returns `canonical_cbc`, `imputed_features`, `risk_threshold`, `risk_rule`, `calibration`. New `/normalize` and `/contract` | `Module 6 Domain API/app.py`, `predictors.py` |
| OCR | Returns the 10 feature keys **plus the unit string printed on the report**. Accepts pasted text (`text`); image OCR answers **501** because tesseract is not installed | `src/services/ocr.js` |
| Registry | `cbc_multiclass` / `v2-four-class-seed42-b24108b19482` active; `calibration=temperature_scaling`. Metrics are the frozen test payload (hybrid accuracy 0.8875, macro-F1 0.8876, leukemia recall 0.875, sick-called-healthy 9, ECE 0.0325), plus ANN/baseline test accuracies, source-holdout (ANN 0.291–0.868, hybrid 0.330–0.835) and provenance-CSV counts | `scripts/register-model.js` |
| FL history | 12 Colab plaintext runs imported (3 seeds × iid / non_iid_05 / non_iid_01 / source, 21 validation rounds each incl. round 0), encryption `none`. 9 of 12 kept round 0; non-IID α=0.1 validation loss rose by round 20 (0.381→0.405, 0.387→0.473, 0.377→0.761) | `scripts/import-fl-history.js` |
| Encrypted run | **Run on the real seed-42 bundle**: 5 rounds, IID, 3 labs, 2048-bit Paillier, about 20 min. Max abs weight difference vs plaintext FedAvg **0.0** in every round, identical validation metrics, round 0 kept. Imported as `encryption='paillier'`, `key_bits=2048` | `docs/evidence/paillier_seed42_iid_r5/` |
| Tests | `python -m pytest`: **58 passed, 2 xfailed** (the xfails are the Phase B frontend rows). Backend `npm test`: **24 unit + 23 DB layer passed**. `node tools/test_prediction_service.cjs` passes. Frontend untouched: `npm run build` OK, Playwright smoke **1 passed** | `tests/test_integration_contract.py`, `Module 1-2 Merged Backend/test/` |
| API acceptance | `scripts/e2e-acceptance.js` against the live stack: **58 passed, 0 failed** (acceptance 1–4 and 6, the API part of 5, RBAC/MFA, SQL evidence) | `docs/evidence/phase_a_api_acceptance.md` |

## 2. Run it (no Docker)

Ports: PostgreSQL 5432 (Windows service `postgresql-x64-18`), inference 8000 (127.0.0.1),
backend 4000, Vite 5173 (proxies `/api` → 4000; `VITE_USE_MOCK=true` swaps in the mock client).

```powershell
# once: Python env (never the global Python: Keras 3.14 cannot load the bundles)
py -3.12 -m venv .venv; .venv\Scripts\python.exe -m pip install -r requirements-test.txt
cd "Module 1-2 Merged Backend"; npm install; cd ..\frontend; npm install; cd ..

# env files (git-ignored; values are NOT in this repo): see §3
powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Setup           # migrate, register model, import runs (idempotent)
powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Start -Frontend # inference + backend + Vite
powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Status
powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Stop
```

Manual equivalent (what `-Setup`/`-Start` do):

```sh
cd "Module 1-2 Merged Backend"
node scripts/db-setup.js            # --reset drops and rebuilds ONLY the fedhealth database
node scripts/register-model.js      # seed-42 defaults; --bundle/--metrics to override
node scripts/import-fl-history.js --all ../FYP_model_data_drive/FYP/four_class/four_class_v1
node scripts/import-fl-history.js ../docs/evidence/paillier_seed42_iid_r5 --scenario iid \
     --base-model ../FYP_model_data_drive/FYP/four_class/four_class_v1/seed42/centralized/model \
     --completed-at 2026-09-26T15:08:14+05:00
# inference (repo root): FEDHEALTH_MODEL_DIR=<seed42/centralized/model> HOST=127.0.0.1 PORT=8000
#   INFERENCE_API_KEY=<same as backend .env>  .venv\Scripts\python.exe "Module 6 Domain API/app.py"
node src/bootstrap.js               # backend :4000; logs "inference contract matches (cbc-four-class-v1)"
npm test                            # test:unit + test:db (needs the database)
node scripts/e2e-acceptance.js --out <file.md>   # needs inference + backend running
```

Accounts: `scripts/bootstrap-admin.js` (env `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`) creates
the first admin; doctors, lab techs and NIH officials (`@nih.org.pk` / `@gov.pk` emails only) use
`POST /auth/register`. Every account enrols TOTP at first login; `node scripts/totp-code.js <manualKey>`
prints the current code. The acceptance script creates throwaway `e2e-*` accounts each run and keeps
their passwords in memory only. No persistent demo login exists yet; Phase B should create its own
test doctor/NIH accounts and record them in a git-ignored file.

## 3. Environment variables (names only)

- Repository-root `.env` (git-ignored, used only by `scripts/db-setup.js`): `PG_SUPERUSER`, `PG_SUPERUSER_PASSWORD`.
- `Module 1-2 Merged Backend/.env` (git-ignored; template `.env.example`): `PORT`, `NODE_ENV`,
  `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PG_POOL_MAX`, `JWT_SECRET`, `JWT_ISSUER`,
  `JWT_ACCESS_TTL`, `JWT_PREAUTH_TTL`, `BCRYPT_ROUNDS`, `TOTP_ISSUER`, `TOTP_WINDOW`,
  `LOGIN_LOCK_THRESHOLD`, `LOGIN_LOCK_MINUTES`, `PATIENT_REF_HMAC_KEY`, `INFERENCE_URL`,
  `INFERENCE_TIMEOUT_MS`, `INFERENCE_API_KEY`, `ALERT_CLUSTER_WINDOW_DAYS`, `ALERT_CLUSTER_MIN_CASES`,
  `TRUST_PROXY` (default `loopback`). `JWT_SECRET`, `PATIENT_REF_HMAC_KEY`, `PGPASSWORD` and
  `INFERENCE_API_KEY` were generated randomly for this machine.
- Inference service: `FEDHEALTH_MODEL_DIR` (or `MODELS_DIR` containing `cbc_multiclass/`),
  `INFERENCE_API_KEY`, `HOST` (default 127.0.0.1), `PORT` (8000), `RISK_THRESHOLD` (0.30).
- Acceptance script: `E2E_BASE_URL` (default `http://127.0.0.1:4000`).
- Frontend: `VITE_USE_MOCK`, `VITE_API_URL` (unchanged).

## 4. API: endpoints the frontend must consume and what changed

All paths are relative to the Vite `/api` prefix. The current frontend already calls these paths;
the **shapes** below are what Phase B must align to.

**Doctor / lab tier**

- `POST /predict` (report:create + prediction:create). The body is strict (unknown keys → 400):
  `{ patientRef, cbc: {WBC..NEUTp: number|null}, units: {feature: unit string as printed} | canonicalUnits: true,
  sex?, ageYears?, symptomsText?, district?, province?, latitude?, longitude?, collectedAt?, labId?, source?: 'manual'|'ocr' }`.
  **Changed:** the frontend currently sends `cbc` without `units`, which is now a 400
  ("Provide CBC values and declared units, or canonicalUnits: true"). Only the 10 features are
  accepted. Accepted units per feature: `cbcContract.json → accepted_units` (normalized keys) and
  `canonical_units`. The response is `201 { persisted, report, prediction, inference, model, screening, rule_flags, alerts }`:
  - `inference.scores` keyed in class order healthy, anemia, thalassemia, leukemia (the order is in `inference.classes`); `inference.ranked`, `top_condition`, `top_confidence`, `risk_flag`, `risk_threshold` (0.3), `risk_rule`, `canonical_cbc`, `canonical_units`, `imputed_features`, `calibration {method, temperature}`, `model_version`, `mode` (`centralized_hybrid`), `inference_ms`, `screening_only`, `requires_doctor_confirmation`.
  - `model {id, name, version, active, calibration, mode}` shows the model version/confidence.
  - `screening {disclaimer, modelInputs: [10 features], imputedFeatures, notModelInputs, riskRule, riskThreshold}`: show `disclaimer` on the doctor screen, and label sex/age/symptoms/location "not used by the model".
  - `report.cbc` (canonical), `report.cbc_units` (as printed), `report.cbc_reported` (as entered), `report.symptoms`.
  - `rule_flags` is always `{}`: rules are disabled and must not be shown as model output (`RuleFlag.jsx` has nothing to render).
  - Error 400 messages name the field (e.g. `Unsupported unit for WBC: mmol/L`, `HGB outside supported range 2..24 g/dL …`); 503 means no model is loaded; 502/504 mean the inference service is unreachable.
- `POST /ocr` (report:create). Either JSON `{text}` (pasted report text) or multipart `image` (501
  without tesseract). **Changed** response: `{ cbc: {feature: value as printed}, units: {feature: printed unit|null},
  unitStatus: {feature: 'accepted'|'unsupported'|'no_unit_printed'|'missing'}, canonical, outOfRange, missing,
  extractedCount, engine, text }`. Pass `cbc` + `units` straight to `/predict`; ask the doctor to pick a unit where
  `unitStatus` is not `accepted` (e.g. `/cmm` is printed on some reports but is not accepted by `normalize_units`).
- `GET /patients/:ref/history` (report:read): array of reports, oldest first; each has canonical `cbc`,
  `cbc_units`, `cbc_reported`, `symptoms` and **new** `prediction: {id, scores, top_condition, top_confidence,
  risk_flag, imputed_features, confirmed_condition, confirmed_at, model_name, model_version} | null`.
- `POST /predictions/:id/confirm` `{confirmedCondition: one of the 4 classes, notes?}` → updated row; anything else is 400.
- `GET /predictions/:id`, `POST /reports`, `GET /reports/:id`, `POST /reports/:id/predict` (same response as `/predict`).
- `POST /symptoms/parse {text}` → `{language, symptoms, tags, raw, usedByModel: false}`.

**NIH tier (nih:dashboard / nih:alerts)**

- `GET /nih/clusters?province=&condition=<class>`: rows `{province, district, condition, day, case_count,
  avg_confidence, high_risk_count, centroid}`; any condition outside the 4 classes is 400. `day` is midnight in
  the DB time zone (Asia/Karachi), serialized as UTC. `healthy` rows exist in the view, so filter them in the UI.
- `GET /nih/alerts?status=&limit=`: `{id, type, severity, title, description, condition, district, province,
  latitude, longitude, payload, status, created_at, acknowledged_at}`. **Changed:** no `prediction_id` or
  `acknowledged_by`. `high_risk_case` alerts are always `condition: 'leukemia'` (the risk flag is the leukemia
  score), even when the top score is another class. `outbreak_cluster` covers anemia/thalassemia/leukemia per
  district, once per ISO week. `POST /nih/alerts/:id/ack`.
- `GET /audit`, `GET /audit/verify` (audit:read; NIH and admin).

**Model Health (nih:dashboard)**, all read from stored records:

- `GET /model-health/summary` → `{activeModel, totalPredictions, avgInferenceMs, totalLabReports, lastTrainingRun,
  trainingRuns: {total: 13, byEncryption: {none: 12, paillier: 1}, keptRoundZero: 10}}`. `activeModel` is the
  registry row: `metrics` (test split, hybrid head: `accuracy`, `macro_f1`, `per_class_recall`, `per_class`,
  `confusion_matrix`, `sick_called_healthy`, `log_loss`, `ece_15_bins`, `subtypes`, `sources`, `ann`,
  `baselines`, `test_rows` 480), `calibration`, `classes`, `provenance`, `limitations`, `training_data`.
  **Replaces** the mock "FedHealth CBC-Net v1.0.0-preview 0.87/0.91".
- `GET /model-health/accuracy-history?run=<uuid>` → `{source: 'fl_rounds', metric_split: 'validation', run, points, runs}`.
  Default run: seed 42 IID plaintext. `points[]`: `{round_number (0 = starting model), loss, accuracy, macro_f1,
  sick_called_healthy, eligible, clients, lab_ids, total_examples, lab_train_rows}`. Label the axis "validation",
  not test. `runs[]` lists all 13 for a selector.
- `GET /model-health/runs` (new): one row per run with `scenario, seed, partition_mode, dirichlet_alpha, encryption,
  key_bits, total_rounds, labs, selected_round, lab_train_rows, runtime, base_model_version, completed_at (NULL for
  the Colab runs: no timestamps were recorded), test_metrics {federated, centralized_same_seed}, round_zero,
  selected, final, ineligible_rounds, max_abs_weight_difference`.
- `GET /model-health/nodes`: **changed**. FL participants are the simulated partitions `lab-00`..`lab-04`:
  `{lab_id, runs, scenarios, min_train_rows, max_train_rows, train_rows_by_run[], kind: 'simulated_partition', note}`.
  There is no live status/heartbeat, so `NodeStatusTable.jsx` must drop up/stale/down.
- `GET /model-health/node-contribution`: **changed**. Rows `{run_id, scenario, seed, encryption, lab_id, train_rows}`
  (45 rows); `?days` is ignored. `NodeContributionChart.jsx` currently expects `{name, day, count}`.
- `GET /model-health/data-intake?days=` → `{days, byDay, bySource, byCondition, bySite}` from this DB's reports and
  predictions. That data is real but sparse and currently consists only of acceptance-run records.
- `GET /model-health/training-data` (new) → `{model, rows: 3200, by_split_class, by_source_class, by_label_basis,
  rows_with_imputed_values: 1692, source_file, sha256, note}` from `Dataset/fedhealth_cbc_4class_provenance.csv`.
- `GET /model-health/encryption` → legacy `{scheme, keyBits, roundsEncrypted, lastRunCompletedAt}` describes only the
  **latest** run (currently the Paillier run, so `scheme: 'paillier'`). Also `latestRun`, `runsByScheme {none: 12,
  paillier: 1}`, `encryptedRuns[] (details incl. key custody/transport limits, max_abs_weight_difference 0)`, `note`.
  The card must present **both**: 12 plaintext runs with no update encryption, and 1 5-round Paillier-2048 run. It
  must not say "client weight updates are encrypted" as a general statement.
- `GET /model-health/limitations` (new) → `{model, sourceHoldout {sources[], ann_accuracy_range, hybrid_accuracy_range,
  note}, federation {metric, plaintextRuns: 12, keptRoundZero: 9, runs[] with val losses and test deltas}, notes[]}`
  feeds the "Known limitations" panel.
- `GET /health/inference` (no auth): inference status passthrough.

## 5. Contract matrix (Phase A rows; Phase B adds the frontend rows)

| Item | schema.py / normalize_units | Flask | Node | DB | Test |
|---|---|---|---|---|---|
| 10 features, order | `FEATURES` | `/contract`, unknown key → 400 | `cbcContract.json`, `prepareCbc` unknown → 400 | `fedhealth_cbc_ranges()` keys; `chk_lab_reports_cbc_contract` | `test_exported_contract_*`, `test_database_contract_literals_match_schema`, `npm run test:db` |
| Canonical units | `UNITS` | `canonical_units` | `CANONICAL_UNITS` | `lab_reports.cbc` comment; `cbc_units` keys ⊆ features | same |
| Unit aliases + factors | `normalize_units` | same function | `accepted_units` table (probed from Python) | n/a (DB stores canonical) | `test_every_exported_unit_alias_*`, `test_node_conversion_and_rejections_match_python` |
| Plausible ranges | `PLAUSIBLE_RANGES` | 400 | 400 (same wording) | CHECK → 23514 | same + acceptance A6 |
| Missing units / value without unit | `Declare the unit` | 400 | 400 | n/a | acceptance A6 |
| 4 classes, order | `CLASSES` | `classes` array (scores keys sorted by Flask) | `assertContract`, zod enums | `fedhealth_classes()`, 4 CHECKs | `test_validators`, layer tests, acceptance A4/A6 |
| scores | softmax | `scores` | re-keyed in class order | `chk_predictions_scores_four_class`, `_top_is_argmax` | acceptance A1, layer tests |
| Registry fields | bundle `meta.json` + final-test payload | `/models` version | `register-model.js` refuses mismatch | `ml_models` (+ provenance/limitations/training_data) | `test_served_bundle_and_registry_payload_match_schema`, acceptance A5 |
| FL run fields | `round_history.json`, `settings.json` | n/a | `import-fl-history.js` | `fl_training_runs`, `fl_rounds` (009 columns) | acceptance A5 |
| OCR output | units accepted by `normalize_units` | n/a | `parseCbcFromText` | n/a | `test_ocr_output_is_accepted_by_normalize_units`, `test/unit/ocr.test.js` |
| Non-model fields | not inputs | not accepted in `cbc` | stored; `screening.notModelInputs` | column comments "NOT a model input" | acceptance A1 |
| Frontend mock / form | — | — | — | — | **xfail(strict) rows for Phase B** |

## 6. Problems found and fixed (carry into `docs/INTEGRATION.md`)

1. Module 6 Node routes/services were never mounted (wrong relative requires, missing model functions such as `getActive`, `setActive`, `Alerts.create/list`, `Predictions.nihClusters`, `Labs.list`, missing `multer`/config/migration). Moved into the backend and wired.
2. `Alerts.create` omitted `prediction_id`, so every high-risk alert would have violated `chk_alert_shape`. Fixed.
3. High-risk alerts used `top_condition` although `risk_flag` is the leukemia score; a case with healthy top and leukemia 0.48 would have been announced as "High-risk healthy". Now always `leukemia`.
4. Flask ignored unknown CBC keys silently. Now 400, as in Node and the DB.
5. Flask `jsonify` sorts keys: the first backend check compared score key order and returned 502. It now compares the key set; order comes from `classes`.
6. Inference-service 400s (unit/range) were mapped to 502. Now passed through as 400.
7. Old OCR returned only values (plus PDW/PCT/LYMp), no units, and `9,010` became `9`. Rewritten.
8. `import-fl-history.js` expected Flower `checkpoint_metadata.json`, which the Colab runs never wrote. Rewritten for `round_history.json` + `settings.json`; `source_file` is the run dir (the old basename would have collided).
9. Model Health "active model" picked any active row (a test model could replace the real one). Now scoped to `cbc_multiclass`.
10. Audit entries of failed requests lost their resource id (Express resets `req.params` before `finish`), and 403s were not audited on domain routes. Both fixed.
11. `trust proxy: true` let any client spoof `X-Forwarded-For` past the login rate limiter (express-rate-limit printed `ERR_ERL_PERMISSIVE_TRUST_PROXY`). Now `loopback`, configurable via `TRUST_PROXY`.
12. Startup contract check initially failed while the model loaded, then reported false drift (Flask key sorting). Added retries and an order-insensitive comparison.
13. `db-setup` hashed CRLF bytes, so a checkout's line endings looked like an edit. Now LF-normalized, with one-time ledger repair.
14. Seeded demo labs carried real hospital names and FL client ids; they are not FL participants. Renamed; FL nodes come from run settings.
15. `run_layer_tests.js` used `{hb: 9.8}` and two-class scores, which the new contract rejects. Updated to four-class data, with DB contract checks added.

## 7. Open problems / not done

- **Phase B, all frontend work** (known mismatches 1, 4-UI, 6): nine-class mock and 6-field form; units per field (the frontend must send `units`, or `/predict` returns 400 now); disclaimer, model version and confidence display; Model Health page on the new shapes; "Known limitations" panel; encryption card truth; "Sample data" labels; `format.js`, `TrendChart`, `PatientHistory`, `RuleFlag`, `OcrUpload`; NIH views; `docs/INTEGRATION.md`; remove the two xfail marks in `tests/test_integration_contract.py`; add frontend contract rows.
- Charts with real data now: accuracy/loss per round (validation), runs, FL nodes and training rows per lab/run, training-data class/source counts, encryption per run, limitations, predictions served / avg inference ms / reports ingested (live DB). Charts with **no** real source (Phase B must label "Sample data" if kept): any live node up/down status or heartbeat, and intake trends over time beyond the few acceptance-run records.
- Image OCR: `tesseract` (system software) and the `node-tesseract-ocr` package are **not installed**; `/ocr` with an image answers 501. Text OCR was verified. Installing needs your approval.
- `/cmm` and `cumm` (printed on some Pakistani reports) are not accepted by `normalize_units`; the doctor must pick a unit. Accepting them would change Module 3.
- Docker/Module 9 not updated: inference container needs `HOST=0.0.0.0` (the default is now 127.0.0.1), `FEDHEALTH_MODEL_DIR` or `MODELS_DIR` wiring, the backend `init/009`/`010` mount, and `TRUST_PROXY` behind nginx.
- Encrypted run limits: 5 rounds only (not 20), one shared keypair, simulated key authority, in-process transport (no TLS on this path), no threshold Paillier, no privacy proof. Encryption covers training updates, not inference.
- The local DB contains acceptance-run test data (`e2e-*` accounts, `E2E-District-*` alerts, a few Lahore predictions) and rows from `npm run test:db` ("Layer Test Lab …", `layer_test_model`, inactive). Clean slate: `node scripts/db-setup.js --reset` and then `-Setup`.
- `/auth/*` is limited to 30 requests per 15 min per IP; one acceptance run uses about 6.
- NIH k-anonymity threshold is still `>= 1` in `004_view.sql` (demo). CORS is still open (`cors()`).
- Nothing was pushed or merged. `main` is unchanged.

## 8. Evidence index

- `docs/evidence/phase_a_api_acceptance.md`: full HTTP + SQL transcript (58/58).
- `docs/evidence/paillier_seed42_iid_r5/`: encrypted run records and equivalence report.
- Local only (git-ignored `run-results/`): encrypted run model/keys/decrypted weights, service logs, full pytest log.
