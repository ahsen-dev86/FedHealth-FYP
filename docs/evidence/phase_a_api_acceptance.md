# FedHealth Phase A API acceptance run 2026-09-26T11:26:58.372Z
Backend http://127.0.0.1:4000; inference http://127.0.0.1:8000; run id 20260926112658. Tokens, TOTP secrets and passwords are redacted.

## A0 Services and accounts (MFA flow)
  - `GET /health/inference` → **200**
- PASS inference service healthy and serving the hybrid — {"models":{"cbc_multiclass":"centralized_hybrid"},"ok":true,"service":"fedhealth-inference"}
  - `node scripts/bootstrap-admin.js` (ADMIN_EMAIL=e2e-admin-20260926112658@fedhealth.test) → exit 0
  - `POST /auth/login` body {"email":"e2e-admin-20260926112658@fedhealth.test","password":"<redacted>"} → **200**
  - `POST /auth/mfa/setup` body {} → **200**
  - `POST /auth/mfa/verify-setup` body {"code":"<totp>"} → **200**
- PASS admin MFA enrolled via scripts/totp-code.js
  - `POST /auth/register` body {"email":"e2e-doctor-20260926112658@fedhealth.test","password":"<redacted>","fullName":"E2E doctor","role":"doctor","organization":"FedHealth E2E"} → **201**
- PASS doctor registered, MFA setup required
  - `POST /auth/mfa/setup` body {} → **200**
  - `POST /auth/mfa/verify-setup` body {"code":"<totp>"} → **200**
- PASS doctor MFA enrolled via scripts/totp-code.js
  - `POST /auth/register` body {"email":"e2e-nih-20260926112658@nih.org.pk","password":"<redacted>","fullName":"E2E nih_official","role":"nih_official","organization":"FedHealth E2E"} → **201**
- PASS nih_official registered, MFA setup required
  - `POST /auth/mfa/setup` body {} → **200**
  - `POST /auth/mfa/verify-setup` body {"code":"<totp>"} → **200**
- PASS nih_official MFA enrolled via scripts/totp-code.js
  - `POST /auth/register` body {"email":"e2e-labtech-20260926112658@fedhealth.test","password":"<redacted>","fullName":"E2E lab_tech","role":"lab_tech","organization":"FedHealth E2E"} → **201**
- PASS lab_tech registered, MFA setup required
  - `POST /auth/mfa/setup` body {} → **200**
  - `POST /auth/mfa/verify-setup` body {"code":"<totp>"} → **200**
- PASS lab_tech MFA enrolled via scripts/totp-code.js
  - doctor signs in again: password step, then TOTP step
  - `POST /auth/login` body {"email":"e2e-doctor-20260926112658@fedhealth.test","password":"<redacted>"} → **200**
- PASS password accepted, second factor required
  - `POST /auth/mfa/verify` body {"code":"<totp>"} → **200**
- PASS TOTP accepted, access token issued
  - `POST /predict` body {} → **401**
- PASS pre-auth token cannot call clinical routes

## A1 Doctor posts the example report with printed units
  - `POST /predict` body {"patientRef":"e2e-pt-20260926112658","sex":"F","ageYears":34,"district":"Lahore","province":"Punjab","latitude":31.55,"longitude":74.34,"symptomsText":"fatigue and pale skin","cbc":{"WBC":9010,"RBC":4.47,"HGB":12.4,"HCT":38,"MCV":85,"MCH":28,"MCHC":33,"RDW":13,"PLT":147000,"NEUTp":69},"units":{"WBC":"/mm3","RBC":"mil/mm3","HGB":"g/dL","HCT":"%","MCV":"fl","MCH":"pg","MCHC":"g/dL","RDW":"%","PLT":… → **201**
    → scores {"healthy":0.22385847200237838,"anemia":0.5875491913375329,"thalassemia":0.1693537418207219,"leukemia":0.01923859483936682}; model {"id":"31d8de26-53a5-404a-90e6-80150ca4d5cc","name":"cbc_multiclass","version":"v2-four-class-seed42-b24108b19482","active":true,"calibration":"temperature_scaling","mode":"centralized_hybrid"}; top anemia
- PASS 201 with exactly the four class scores in order
- PASS scores match the recorded acceptance sample (±0.001) — {"healthy":0.224,"anemia":0.588,"thalassemia":0.169,"leukemia":0.019}
- PASS model version and registry row returned
- PASS screening disclaimer and model-input list returned — Screening support only, not a diagnosis. The model scores the 10 CBC values only; sex, age, symptoms and location are stored for context and are not model inputs. A doctor must confirm any condition.
- PASS report stored in canonical units (WBC 9.01, PLT 147)
  - SQL `SELECT id, source, sex, age_years, district, cbc, cbc_units, cbc_reported, symptoms->'tags' AS symptom_tags FROM lab_reports WHERE id = $1`
    → {"id":"41decbfc-cf72-43fe-a78b-e67ae003a0d5","source":"manual","sex":"F","age_years":34,"district":"Lahore","cbc":{"HCT":38,"HGB":12.4,"MCH":28,"MCV":85,"PLT":147,"RBC":4.47,"RDW":13,"WBC":9.01,"MCHC":33,"NEUTp":69},"cbc_units":{"HCT":"%","HGB":"g/dL","MCH":"pg","MCV":"fl","PLT":"/mm3","RBC":"mil/mm3","RDW":"%","WBC":"/mm3","MCHC":"g/dL","NEUTp":"%"},"cbc_reported":{"HCT":38,"HGB":12.4,"MCH":28,"MCV":85,"PLT":147000,"RBC":4.47,"RDW":13,"WBC":9010,"MCHC":33,"NEUTp":69},"symptom_tags":["fatigue","pallor"]}
  - SQL `SELECT p.id, p.scores, p.top_condition, round(p.top_confidence::numeric,3) AS top_confidence, p.risk_flag, p.imputed_features, p.rule_flags, m.version AS model_version FROM predictions p JOIN ml_models m ON m.id = p.model_id WHERE p.id = $1`
    → {"id":"ef8390f5-a5b3-4e20-9034-54eac5aaf2a6","scores":{"anemia":0.5875491913375329,"healthy":0.22385847200237838,"leukemia":0.01923859483936682,"thalassemia":0.1693537418207219},"top_condition":"anemia","top_confidence":"0.588","risk_flag":false,"imputed_features":[],"rule_flags":{},"model_version":"v2-four-class-seed42-b24108b19482"}
- PASS predictions.scores keys are exactly the four classes
  - SQL `SELECT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(cbc) k) AS cbc_keys FROM lab_reports WHERE id = $1`
    → {"cbc_keys":["HCT","HGB","MCH","MCHC","MCV","NEUTp","PLT","RBC","RDW","WBC"]}
- PASS lab_reports.cbc keys are exactly the 10 features

## A2 OCR path (report text) returns the 10 keys plus printed units
  - `POST /ocr` body {"text":"COMPLETE BLOOD COUNT            Result      Unit       Reference\nTotal Leucocyte Count (TLC)     9,010       /mm3       4,000 - 11,000\nRed Blood Cells                 4.47        mil/mm3    4.5 - 5.5\nHaemoglobin                     12.4   L    g/dL       13.0 - 17.0\nHaematocrit (HCT)               38          %          40 - 50\nMCV                             85          fl         8… → **200**
    → cbc {"WBC":9010,"RBC":4.47,"HGB":12.4,"HCT":38,"MCV":85,"MCH":28,"MCHC":33,"RDW":13,"PLT":147000,"NEUTp":69}
    → units {"WBC":"/mm3","RBC":"mil/mm3","HGB":"g/dL","HCT":"%","MCV":"fl","MCH":"pg","MCHC":"g/dL","RDW":"%","PLT":"/mm3","NEUTp":"%"}; missing []
- PASS OCR found all 10 features with a printed unit each
- PASS OCR values and units equal the report
  - `POST /predict` body {"patientRef":"e2e-pt-20260926112658","source":"ocr","district":"Lahore","province":"Punjab","latitude":31.55,"longitude":74.34,"cbc":{"WBC":9010,"RBC":4.47,"HGB":12.4,"HCT":38,"MCV":85,"MCH":28,"MCHC":33,"RDW":13,"PLT":147000,"NEUTp":69},"units":{"WBC":"/mm3","RBC":"mil/mm3","HGB":"g/dL","HCT":"%","MCV":"fl","MCH":"pg","MCHC":"g/dL","RDW":"%","PLT":"/mm3","NEUTp":"%"}} → **201**
- PASS OCR output accepted by /predict with identical scores
  - `POST /ocr` → **200**
    → engine tesseract; cbc {"WBC":9010,"RBC":4.47,"HGB":12.4,"HCT":38,"MCV":85,"MCH":28,"MCHC":33,"RDW":13,"PLT":147000,"NEUTp":69}; units {"WBC":"/mm3","RBC":"mil/mm3","HGB":"g/dL","HCT":"%","MCV":"fl","MCH":"pg","MCHC":"g/dL","RDW":"%","PLT":"/mm3","NEUTp":"%"}
- PASS image OCR (tesseract) of the rendered report returns the 10 values with printed units
  - `POST /ocr` → **400**
- PASS non-image upload is rejected with 400 — Upload a PNG, JPEG, WebP or TIFF image of the report (PDFs: paste the text)
  - `GET /patients/e2e-pt-20260926112658/history` → **200**
- PASS patient history returns both reports with their latest prediction

## A3 Doctor confirms a diagnosis; audit chain verifies
  - `POST /predictions/ef8390f5-a5b3-4e20-9034-54eac5aaf2a6/confirm` body {"confirmedCondition":"anemia","notes":"E2E: iron studies ordered"} → **200**
- PASS confirmation stored
  - `POST /predictions/ef8390f5-a5b3-4e20-9034-54eac5aaf2a6/confirm` body {"confirmedCondition":"healthy"} → **403**
- PASS lab technician cannot confirm (RBAC)
  - SQL `SELECT id, action, actor_role, resource_type, resource_id, metadata->>'status' AS status FROM audit_logs WHERE resource_id = $1 ORDER BY id`
    → {"id":"415","action":"CONFIRM_DIAGNOSIS","actor_role":"doctor","resource_type":"prediction","resource_id":"ef8390f5-a5b3-4e20-9034-54eac5aaf2a6","status":"200"}
    → {"id":"416","action":"CONFIRM_DIAGNOSIS","actor_role":"lab_tech","resource_type":"prediction","resource_id":"ef8390f5-a5b3-4e20-9034-54eac5aaf2a6","status":"403"}
- PASS CONFIRM_DIAGNOSIS audit entries recorded (success and the rejected attempt)
  - `GET /audit/verify` → **200**
    → {"ok":true,"broken_at":null}
- PASS audit hash chain verifies (API, admin)
  - SQL `SELECT * FROM verify_audit_chain()`
    → {"ok":true,"broken_at":null}
- PASS audit hash chain verifies (SQL)
- PASS audit_logs cannot be updated by the app role — SQLSTATE 42501

## A4 High leukemia scores raise alerts and NIH surveillance entries
  - `POST /predict` body {"patientRef":"e2e-leuk-20260926112658-0","district":"Test District cacgajcgbbcgfi","province":"Punjab","cbc":{"WBC":14.52,"RBC":2.49,"HGB":7.4,"HCT":23.1,"MCV":92.8,"MCH":29.7,"MCHC":32,"RDW":14.7,"PLT":22,"NEUTp":57.4},"canonicalUnits":true} → **201**
    → leukemia 0.989; risk_flag true; alerts [["high_risk_case","leukemia","critical"]]
  - `POST /predict` body {"patientRef":"e2e-leuk-20260926112658-1","district":"Test District cacgajcgbbcgfi","province":"Punjab","cbc":{"WBC":24.64,"RBC":2.02,"HGB":6.1,"HCT":18.8,"MCV":93.1,"MCH":30.2,"MCHC":32.4,"RDW":14.9,"PLT":28,"NEUTp":61.4},"canonicalUnits":true} → **201**
    → leukemia 0.990; risk_flag true; alerts [["high_risk_case","leukemia","critical"]]
  - `POST /predict` body {"patientRef":"e2e-leuk-20260926112658-2","district":"Test District cacgajcgbbcgfi","province":"Punjab","cbc":{"WBC":2.75,"RBC":1.98,"HGB":6.6,"HCT":20.8,"MCV":105.1,"MCH":33.3,"MCHC":31.7,"RDW":19.6,"PLT":34,"NEUTp":85.8},"canonicalUnits":true} → **201**
    → leukemia 0.995; risk_flag true; alerts [["high_risk_case","leukemia","critical"],["outbreak_cluster","leukemia","high"]]
- PASS each case raised a high_risk_case alert for leukemia
- PASS third case in the district raised one leukemia outbreak_cluster alert
  - `POST /predict` body {"patientRef":"e2e-border-20260926112658","district":"Lahore","province":"Punjab","latitude":31.55,"longitude":74.34,"cbc":{"WBC":8.7,"RBC":4.31,"HGB":15.3,"HCT":43,"MCV":99.8,"MCH":35.5,"MCHC":35.6,"RDW":12.9,"PLT":220,"NEUTp":71.4},"canonicalUnits":true} → **201**
    → top healthy 0.5034976; leukemia 0.480; alerts [["high_risk_case","leukemia"]]
- PASS risk flag from leukemia score is alerted as leukemia even when another class is top
  - SQL `SELECT type, condition, severity, district, payload FROM alerts WHERE district = $1 ORDER BY created_at`
    → {"type":"high_risk_case","condition":"leukemia","severity":"critical","district":"Test District cacgajcgbbcgfi","payload":{"threshold":0.3,"confidence":0.9885374677289301,"model_version":"v2-four-class-seed42-b24108b19482","top_condition":"leukemia"}}
    → {"type":"high_risk_case","condition":"leukemia","severity":"critical","district":"Test District cacgajcgbbcgfi","payload":{"threshold":0.3,"confidence":0.9898137925905844,"model_version":"v2-four-class-seed42-b24108b19482","top_condition":"leukemia"}}
    → {"type":"high_risk_case","condition":"leukemia","severity":"critical","district":"Test District cacgajcgbbcgfi","payload":{"threshold":0.3,"confidence":0.9950830080757924,"model_version":"v2-four-class-seed42-b24108b19482","top_condition":"leukemia"}}
    → {"type":"outbreak_cluster","condition":"leukemia","severity":"high","district":"Test District cacgajcgbbcgfi","payload":{"threshold":3,"case_count":3,"window_days":7}}
  - `GET /nih/alerts?status=open&limit=50` → **200**
- PASS NIH alert feed lists the district alerts with class names only
  - `GET /nih/clusters?condition=leukemia` → **200**
    → cluster {"province":"Punjab","district":"Test District cacgajcgbbcgfi","condition":"leukemia","day":"2026-09-25T19:00:00.000Z","case_count":3,"avg_confidence":0.991,"high_risk_count":3,"approx_lat":null,"approx_lng":null}
- PASS NIH cluster view aggregates the leukemia cases (no patient data)
  - `GET /nih/clusters?condition=anemia&province=Punjab` → **200**
    → Lahore anemia cluster {"province":"Punjab","district":"Lahore","condition":"anemia","day":"2026-09-25T19:00:00.000Z","case_count":15,"avg_confidence":0.588,"high_risk_count":0,"approx_lat":31.55,"approx_lng":74.34}
- PASS clusters carry rounded map coordinates, not an exact centroid
  - `GET /nih/clusters?condition=iron_deficiency_anemia` → **400**
- PASS NIH cluster filter rejects an old nine-class name
  - `POST /predict` body {"patientRef":"x","cbc":{"HGB":12},"canonicalUnits":true} → **403**
  - `GET /patients/e2e-pt-20260926112658/history` → **403**
- PASS NIH role cannot reach patient-level routes

## A5 Model Health endpoints (API part)
  - `GET /model-health/summary` → **200**
  - `GET /model-health/runs` → **200**
  - `GET /model-health/accuracy-history` → **200**
  - `GET /model-health/nodes` → **200**
  - `GET /model-health/node-contribution` → **200**
  - `GET /model-health/data-intake` → **200**
  - `GET /model-health/training-data` → **200**
  - `GET /model-health/encryption` → **200**
  - `GET /model-health/limitations` → **200**
    → summary.activeModel {"name":"cbc_multiclass","version":"v2-four-class-seed42-b24108b19482","calibration":"temperature_scaling","classes":["healthy","anemia","thalassemia","leukemia"],"accuracy":0.8875,"macro_f1":0.8876343468617662,"split":"test"}
    → summary.trainingRuns {"total":13,"byEncryption":{"none":12,"paillier":1},"keptRoundZero":10}
- PASS registered real model with measured test metrics
- PASS 12 plaintext federated runs imported
    → accuracy-history run {"id":"59a89e74-ca0c-4413-9b08-eeb13d4c68a0","scenario":"iid","seed":42,"encryption":"none","key_bits":null,"total_rounds":20,"selected_round":0,"base_model_version":"v2-four-class-seed42-b24108b19482"}; 21 points (validation)
- PASS accuracy history is validation per round incl. round 0
    → nodes [["lab-00",13,523,1433],["lab-01",13,2,747],["lab-02",13,217,1677],["lab-03",3,184,184],["lab-04",3,435,435]]
- PASS FL nodes are the run lab ids (lab-00..lab-04)
    → encryption {"scheme":"paillier","keyBits":2048,"roundsEncrypted":5,"lastRunCompletedAt":"2026-09-26T10:08:14.000Z","latestRun":{"encryption":"paillier","key_bits":2048,"total_rounds":5,"labs":3,"completed_at":"2026-09-26T10:08:14.000Z","scenario":"iid","seed":42},"runsByScheme":{"none":12,"paillier":1},"encryptedRuns":[{"scenario":"iid","rounds":5,"key_bits":2048,"max_abs_weight_difference":0}],"note":"Encryption applies to federated training updates only (Paillier, simulated key authority, in-process transport). Inference is not encrypted."}
- PASS encryption card data: plaintext runs are "none"; paillier only for recorded encrypted runs
    → limitations {"holdout":[0.29120198265179675,0.8676470588235294],"kept0":9,"of":12}
- PASS limitations: source-holdout 0.29-0.87 and 9 of 12 runs kept round 0
- PASS training-data counts come from the provenance file (3,200 rows, 800 per class)
  - `GET /model-health/summary` → **403**
- PASS doctor cannot open Model Health (nih:dashboard only)

## A6 Invalid inputs are rejected consistently (API, inference service, DB)
  - out-of-range value (HGB 40 g/dL): API 400 "HGB outside supported range 2..24 g/dL (got 40 after converting from g/dL); verify units/value — 40 would fit if the unit is g/L" | inference 400 "HGB outside supported range 2.0..24.0; verify units/value"
- PASS out-of-range value (HGB 40 g/dL) rejected by API and inference service
  - wrong unit (WBC in mmol/L): API 400 "Unsupported unit for WBC: mmol/L" | inference 400 "Unsupported unit for WBC: mmol/L"
- PASS wrong unit (WBC in mmol/L) rejected by API and inference service
  - missing units: API 400 "Provide CBC values and declared units, or canonicalUnits: true" | inference 400 "Provide CBC values and declared units, or canonical_units: true"
- PASS missing units rejected by API and inference service
  - a value without its unit: API 400 "Declare the unit for PLT" | inference 400 "Declare the unit for PLT"
- PASS a value without its unit rejected by API and inference service
  - raw magnitude declared canonical (WBC 9010 10^3/uL): API 400 "WBC outside supported range 0.5..200 10^3/uL (got 9010 after converting from 10^3/uL); verify units/value — 9010 would fit if the unit is /mm³ (count) or /µL (count)" | inference 400 "WBC outside supported range 0.5..200.0; verify units/value"
- PASS raw magnitude declared canonical (WBC 9010 10^3/uL) rejected by API and inference service
  - unknown field (FOO, not a model feature): API 400 "Unknown CBC field(s): FOO; the model uses only WBC, RBC, HGB, HCT, MCV, MCH, MCHC, RDW, PLT, NEUTp" | inference 400 "Unknown CBC field(s): FOO; the model uses only WBC, RBC, HGB, HCT, MCV, MCH, MCHC, RDW, PLT, NEUTp"
- PASS unknown field (FOO, not a model feature) rejected by API and inference service
  - `POST /predictions/ef8390f5-a5b3-4e20-9034-54eac5aaf2a6/confirm` body {"confirmedCondition":"iron_deficiency_anemia"} → **400**
- PASS unknown class rejected by the confirm API
- PASS no report stored for any rejected request
- PASS DB rejects out-of-range canonical value — SQLSTATE 23514
- PASS DB rejects raw unconverted value (WBC 9010) — SQLSTATE 23514
- PASS DB rejects unknown CBC key — SQLSTATE 23514
- PASS DB rejects old nine-class scores — SQLSTATE 23514
- PASS DB rejects top_condition that is not the arg-max — SQLSTATE 23514
- PASS DB rejects unknown confirmed_condition — SQLSTATE 23514

**Result: 60 passed, 0 failed.**
