# FedHealth integration: model, database, backend, encryption evidence and frontend

Branch `feat/integration` (from `main` at `c0ff0d6`). This document is the result of both phases:
Phase A (database, inference, backend, registry, federated/encrypted run records; details in
[INTEGRATION_HANDOFF.md](INTEGRATION_HANDOFF.md)) and Phase B (frontend alignment, Model Health,
robust input handling, OCR engine, tests). How to run it: **[RUN_GUIDE.md](RUN_GUIDE.md)**.

Nothing here claims clinical validity. The served model is a proof of concept trained on a public
composite: frozen-test hybrid accuracy 0.888 (macro-F1 0.888, leukemia recall 0.875, 9 sick called
healthy, ECE 0.033), but 0.29–0.87 accuracy on data sources it never saw, and federation did not beat
the starting model in 9 of 12 runs.

## 1. What flows end to end

```
Doctor (React, :5173) --/api--> Vite proxy --> Node/Express (:4000) --X-API-Key--> Flask (:8000, seed-42 bundle)
   |  10 CBC values + printed units              |  validate + convert (contract)         |  normalize_units + ANN/XGBoost hybrid
   |  OCR image/text  -----------------------> sharp + tesseract -> 10 values + printed units
   v                                             v
Model Health / NIH views  <-- aggregates --  PostgreSQL 18 + PostGIS (CHECK-enforced four-class contract)
```

One contract drives every layer: `Module 3 ML/schema.py` (10 ordered features, 4 ordered classes,
canonical units, plausible ranges) and `fedhealth_ml.preprocess.normalize_units` (accepted unit
aliases and factors). `tools/export_contract.py` exports them to
`Module 1-2 Merged Backend/src/contract/cbcContract.json` and `frontend/src/lib/cbcContract.json`
(identical, generated, checked by tests). The database carries the same literals in `init/009`.

## 2. Contract matrix

Every row has an automated check; "tests" names where. Status: all rows pass (§6).

| Item | schema.py / normalize_units | Flask `/infer` | Node API | Database | Frontend | Tests |
|---|---|---|---|---|---|---|
| 10 features, order | `FEATURES` | `/contract`; unknown key → 400 | contract JSON; `prepareCbc` unknown → 400 | `fedhealth_cbc_ranges()` keys; `chk_lab_reports_cbc_contract` | `CBC_FIELDS` from contract; form has exactly 10 fields | pytest `test_exported_contract_*`, `test_frontend_form_fields_*`, `test_database_contract_literals_*`; Playwright mock |
| Canonical units | `UNITS` | `canonical_units` | `CANONICAL_UNITS` | column comment; `cbc` stored canonical | first unit option; charts/history in canonical units | same |
| Unit aliases + factors | `normalize_units` table | same function | `accepted_units` (probed from Python) | — (stores canonical + `cbc_units` as printed) | `unit_options` (each verified accepted), same normalization | `test_every_exported_unit_alias_*`, `test_node_conversion_*`, `test_frontend_validation_matches_backend_and_python` |
| Plausible ranges | `PLAUSIBLE_RANGES` | 400 | 400 (same wording + unit hint) | CHECK → 23514 | inline error (same wording + hint) | same + robustness matrix |
| Missing / wrong unit | "Declare the unit…", "Unsupported unit…" | 400 | 400 | — | inline error; OCR "choose the unit" | same |
| Value types | numbers only | numbers only (no strings/bools/NaN) | numbers only, field named in message | JSON number CHECK | "must be a number"; `12,4`/`1e3` refused | robustness matrix, pytest Flask wrong-type row |
| 4 classes, order | `CLASSES` | `classes` array (Flask sorts object keys) | `assertContract`; zod enums; scores re-keyed in order | `fedhealth_classes()`; scores/top/confirmed/alert CHECKs | labels, colours, confirm options from contract | validators tests, layer tests, acceptance A1/A6 |
| Scores | calibrated softmax | `scores` | stored as-is | exactly 4 keys, [0,1], sum 1; top = arg-max | `ConfidenceScores` shows all 4 | acceptance A1, layer tests |
| Registry | bundle `meta.json` + `final_test/seed42_centralized_metrics.json` | `/models` version | `register-model.js` refuses mismatches | `ml_models` (+ provenance, limitations, training_data) | model card, stat cards | `test_served_bundle_*`, acceptance A5, Playwright live |
| FL runs | `round_history.json`, `settings.json` | — | `import-fl-history.js` | `fl_training_runs`, `fl_rounds` | accuracy chart (validation), runs table, partitions, contribution | acceptance A5, Playwright |
| Encryption | `settings.json` `encryption` block | — | imported as `paillier`/`key_bits` only when recorded | CHECK key_bits ↔ scheme | card: 12 plaintext + 1 Paillier-2048 | acceptance A5, Playwright |
| OCR output | units accepted by `normalize_units` | — | 10 features + printed unit + status | — | fills values/units, flags problems | `test_ocr_output_*`, backend OCR tests (incl. real tesseract), Playwright live |
| Non-model fields | not inputs | not accepted in `cbc` | stored; `screening.notModelInputs` | comments "NOT a model input" | labelled "(context, not used by the model)" | acceptance A1, Playwright mock |
| Data-quality | — | — | MCHC/MCV/MCH vs HGB/HCT/RBC > 20% → warning | — | same check, amber warning before and after | backend + frontend unit tests, parity test |

## 3. Problems found and fixed

Phase A (details in the handoff): Module 6 routes never mounted; alerts missing `prediction_id`;
high-risk alerts labelled with the wrong class; Flask ignored unknown fields; Flask key sorting broke a
class-order check; 400s mapped to 502; OCR returned no units and mangled `9,010`; FL importer read a
file the runs never wrote; any active model could replace the real one on Model Health; audit
entries lost their resource id on errors and 403s were not audited; `trust proxy: true` let clients
bypass the login rate limit; migration hashes broke on CRLF checkouts; demo labs carried real
hospital names as FL nodes.

Phase B:

| # | Problem | Fix |
|---|---|---|
| 1 | Frontend used nine old class names and a 14-field form (PDW, PCT, LYM/NEUT counts were never model inputs), sent CBC without units | Contract module shared with the backend; 10-field form with a unit per value; four classes everywhere |
| 2 | The Vite `/api` proxy did not strip `/api`, so **every real request in development got 404**: the real frontend had never worked against the backend | Proxy rewrite, like Module 9's nginx |
| 3 | A developer `.env.local` with `VITE_USE_MOCK=true` silently turned `npm run dev` and the live tests into the mock (a live test "saw" mock scores) | Test servers and the run script set `VITE_USE_MOCK` explicitly; live tests assert no mock banner |
| 4 | NIH map plotted `approx_lat/lng`, which the API never returned: no real cluster could appear | API returns centroid rounded to 0.01°, exact centroid removed; doctor picks a district with district-level coordinates |
| 5 | Model Health showed an invented "CBC-Net v1.0.0-preview 0.87/0.91", Paillier for every run, hospital-named nodes with fake up/down status | Real registry, measured metrics, per-run encryption truth, lab-00..lab-04 partitions; no-data charts labelled "Sample data" (a limitations panel was added, then removed from the page at the author's request: limitations are reported in the written documentation; the data stays available at `/model-health/limitations`) |
| 6 | Image OCR impossible (no engine); the old wrapper built a shell command from request input | Tesseract 5.4 installed; called with `execFile` (no shell); `lang` validated; image preprocessing (sharp) |
| 7 | At scan size tesseract read RBC 4.47 as 447 | Upscale/greyscale/normalise before OCR: rendered report reads 10/10; degraded scan 9/10 with the misread caught by the range check |
| 8 | Malformed ids (`/predictions/abc/confirm`) reached SQL → **500**; upload errors → 500; unexpected 500s leaked internal messages | UUID param guards (400), multer/body-parser/SQLSTATE mapping, generic 500 body |
| 9 | Patient reference accepted CNIC/phone/email/HTML; age "abc" was sent as `null` and accepted; lat without lng; dates in 2999 | Validation in API and UI with the same rules and messages |
| 10 | `"__proto__"` inside `cbc` was silently dropped by zod | CBC objects validated as sent; the key is rejected like any unknown field |
| 11 | Wrong-type values gave a generic message | Field-named messages ("cbc.HGB: HGB must be a number, not the text "12.4"") |
| 12 | Mistyped units only said "out of range" | Hint names the unit that would fit (never applied automatically) |
| 13 | Inconsistent entries (a typo in HGB) passed silently | Non-blocking data-quality warning from red-cell index arithmetic (0.7% of dataset rows trip it) |
| 14 | Flask accepted numeric strings, returned HTML error pages, had no size limit | JSON-number typing, JSON 404/405/413/500, 64 KB limit |
| 15 | Unknown federated run id silently returned the default run | 404 |
| 16 | Frontend showed "Failed to fetch"; an expired session left the user stuck with 401s | Clear network/service messages; 401 while signed in signs out with a notice |
| 17 | Same borderline CBC scored leukemia 0.480 or 0.506 depending on how the model service was launched (TensorFlow oneDNN rounding) | Service pins `TF_ENABLE_ONEDNN_OPTS=0`; both settings reproduce the recorded validation (421/480, log loss 0.35894) |
| 18 | Run helper: starting only the frontend overwrote the PID file; stopping npm left Vite running | PID merge, tree kill, port-based fallback; start/stop `.cmd` launchers |
| 19 | Live browser tests failed intermittently when run with the mock tests: two Vite dev servers shared one dependency cache and deleted each other's files | Separate `cacheDir` per server (`VITE_CACHE_DIR`); all 10 Playwright tests pass twice in a row |

## 4. Sample data (illustrative, always labelled)

| Chart | Why no real data | Label |
|---|---|---|
| Model Health → *Live node status* | The federation ran as a batch simulation; no FL client reports liveness | "Sample data" badge; neutral names "Sample site A–D" |
| Model Health → *Data intake* trend | Shown only while this deployment has < 2 days of reports (live counts are shown in the text) | "Sample data" badge + live count |
| Model Health → intake breakdowns | Only when no reports exist in the window | "Sample data" badge |
| Mock mode (`-Mock`) | No backend | "Demo mode — mock API" banner; prediction scores say they are not from the model; Model Health uses a snapshot of the real registry/runs |

Real data everywhere else: registered model and test metrics, per-round validation
curves of all 13 runs, runs table, encryption per run, lab partitions and training rows, training-data
class/source counts, predictions served/average latency/reports, NIH clusters and alerts, audit chain.

## 5. Robustness (wrong and absurd input)

`scripts/e2e-robustness.js` sends 130+ bad inputs to the running API and the model service and
checks each gets the expected 4xx with a JSON message that says what to fix, never a 500, and that
nothing rejected is stored. Categories: malformed/oversized/wrong-type bodies; missing, garbage,
forged, unsigned (`alg: none`), expired and wrong-scope tokens; wrong role; SQL in email; admin
self-registration; gmail NIH; duplicate email; short password; bad MFA codes; patient references that
are CNICs, phones, emails, HTML, SQL, Urdu text, too long, numbers; CBC as array/string/empty/all
null; string/boolean/list/Infinity/NaN values; negative, zero, huge, >100% values; boundary values
(accepted); unknown, lower-case, `__proto__`, `constructor`, non-model (PDW) keys; missing, empty,
null, numeric, unsupported, injected, overlong units; counts/fractions/g/L typed with the wrong unit
(hints checked); age/sex/coordinates/dates/place names/symptom length/extra fields/labId/model/source;
malformed and unknown ids (incl. SQL in the path); wrong-case and old class names on confirmation;
NIH/Model Health query parameters; OCR with no input, empty/huge text, PDF, empty/fake/truncated/9 MB
images, wrong field, two files, command injection in `lang`; Flask without/with wrong key, wrong
types, NaN, 70 KB body, unknown route, wrong method. Latest result: **133 of 133 passed**
([evidence](evidence/robustness_matrix.md)). The UI enforces the same rules before sending
(Playwright "nonsense input" test) and the database rejects the same values independently
(acceptance A6).

## 6. Test results (latest runs, this machine)

| Suite | Result |
|---|---|
| `pytest` (ML, federation, encryption, 16 contract rows incl. frontend and Flask robustness) | **64 passed**, 0 failed (18 Keras/NumPy deprecation warnings) |
| Backend `npm test` (unit incl. real tesseract OCR + DB layer) | **34 + 23 passed** |
| Registry check `node tools/test_prediction_service.cjs` | passed |
| API acceptance `scripts/e2e-acceptance.js` | **60/60** ([evidence](evidence/phase_a_api_acceptance.md)) |
| Robustness matrix `scripts/e2e-robustness.js` | **133/133** ([evidence](evidence/robustness_matrix.md)) |
| Frontend `npm test` | **7/7** |
| Frontend build (real and mock) | builds |
| Playwright smoke / mock / live (text assertions only, no screenshots) | **10/10**, twice in a row |
| Encrypted federation (5 rounds, 2048-bit, real model) | equal to plaintext FedAvg (max diff 0.0) ([evidence](evidence/paillier_seed42_iid_r5/README.md)) |

## 7. Remaining gaps (not done, stated plainly)

- No clinical validation; unseen-source accuracy 0.29–0.87. Screening support only.
- Encrypted run: 5 rounds only, one shared keypair, simulated key authority, in-process transport (no
  TLS on that path), no threshold Paillier, no privacy proof. Inference is not encrypted.
- OCR: printed units such as `/cmm` are not accepted by `normalize_units` (doctor picks a unit); PDFs
  must be pasted as text; phone photos of poor quality can misread digits (range checks catch
  implausible ones, plausible misreads need the doctor's review).
- NIH k-anonymity threshold is `>= 1` (demo); CORS is open; JWT is stored in localStorage.
- Docker/Module 9 files are not updated for this integration (inference `HOST=0.0.0.0`, model path,
  `init/009`–`010`, `TRUST_PROXY`, tesseract in the image).
- The local database holds test records from acceptance/robustness/Playwright runs (`e2e-*`).
  Clean slate: `node scripts/db-setup.js --reset`, then `run-local.ps1 -Setup` and `npm run demo:users`.
- Help Portal content is sample data (`npm run demo:help`: five fictional NGOs marked "(sample)", not
  verified, example.org sites, no-password accounts).
- `Module 1 Database`, `Module 7 Doctor Portal`, `Module 8 NIH Dashboard` are superseded copies (marked).
