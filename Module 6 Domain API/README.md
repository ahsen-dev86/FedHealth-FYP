# FedHealth — Backend (Auth: RBAC + MFA + Audit)

Module 2 delivers authentication, authorization, and immutable audit logging on
top of the Module 1 database. The full domain API (reports, predictions, NIH)
arrives in Module 6 and reuses exactly this middleware.

## What's here
- **RBAC** — `requirePermission(...)` gates routes on permission codes from the
  `role_permissions` table (Module 1). NIH officials can't reach patient routes.
- **Mandatory MFA (TOTP)** — you cannot obtain a full access token without
  clearing MFA. Login returns only a short-lived *pre-auth* token; the access
  token is issued only after `/auth/mfa/verify`.
- **Brute-force lockout** — N bad passwords locks the account for M minutes.
- **Immutable audit** — every auth event and protected action is appended to the
  hash-chained `audit_logs` table.

## Setup
```bash
cd backend
cp .env.example .env          # edit PGPASSWORD + JWT_SECRET
npm install
# Ensure the DB from Module 1 is up and seeded, then:
npm run bootstrap:admin -- admin@fedhealth.pk 'StrongPass123' 'FedHealth Admin'
npm start                     # -> http://localhost:4000
```

## End-to-end test (curl)

1) **Log in** (first time -> MFA setup required):
```bash
curl -s localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@fedhealth.pk","password":"StrongPass123"}'
# -> { "mfaSetupRequired": true, "preAuthToken": "<PRE>" }
```

2) **Start MFA setup** (returns a QR + a manual key):
```bash
curl -s localhost:4000/auth/mfa/setup -H "Authorization: Bearer <PRE>"
# -> { "qrDataUrl": "...", "manualKey": "<BASE32>" , ...}
```

3) **Generate a code** from the manual key and confirm setup:
```bash
CODE=$(npm run --silent totp:code -- <BASE32>)
curl -s localhost:4000/auth/mfa/verify-setup -H "Authorization: Bearer <PRE>" \
  -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}"
# -> { "activated": true, "accessToken": "<ACCESS>" }
```

4) **Use the access token** — RBAC + audit in action:
```bash
curl -s localhost:4000/auth/me           -H "Authorization: Bearer <ACCESS>"
curl -s localhost:4000/audit             -H "Authorization: Bearer <ACCESS>"  # admin only
curl -s localhost:4000/audit/verify      -H "Authorization: Bearer <ACCESS>"  # -> { ok:true, broken_at:null }
```

On subsequent logins you'll get `{ "mfaRequired": true, "preAuthToken": ... }`
instead — POST the current code to `/auth/mfa/verify` to get a fresh access token.

## RBAC quick check
- A **doctor** hitting `/audit` gets **403** — that role isn't granted `audit:read`.
- **NIH officials** *are* granted `audit:read` (compliance oversight), but are
  deliberately **not** granted `report:read` / `prediction:read`. The Module 6
  patient routes will therefore return 403 for the NIH role — that's the
  "NIH never touches individual patient data" guarantee, enforced by RBAC.
- Registering an `nih_official` requires a `@gov.pk` / `@nih.org.pk` email; any
  other domain is rejected with 400 by the database trigger (not app code).

---

# Module 6 — Domain API (reports, predictions, NIH)

Adds the clinical + surveillance endpoints on top of the auth/RBAC/audit layer.
All routes are RBAC-gated and audited. Model scoring is delegated to the Python
inference service (`ml/inference_service`), which must be running.

## New dependencies
- **Inference service** at `INFERENCE_URL` (default `http://localhost:8000`).
- **Tesseract binary** for OCR: `apt-get install tesseract-ocr` (Linux) /
  `brew install tesseract` (macOS). Added to the backend Docker image in Module 9.
- npm: `multer` (uploads), `node-tesseract-ocr` (OCR).

## Endpoints
| Method + path | Permission | Purpose |
|---|---|---|
| `POST /reports` | report:create | Create a CBC report (manual). Optional `symptomsText` is parsed. |
| `GET /reports/:id` | report:read | Read a report |
| `GET /patients/:ref/history` | report:read | Longitudinal history (trend charts) |
| `POST /reports/:id/predict` | prediction:create | Score an existing report |
| `POST /predict` | report:create + prediction:create | Create report **and** score in one call |
| `POST /ocr` | report:create | Image upload → Tesseract → extracted CBC values |
| `POST /symptoms/parse` | (any auth) | English/Urdu/Roman-Urdu symptom → tags |
| `GET /predictions/:id` | prediction:read | Read scores + rule flags |
| `POST /predictions/:id/confirm` | prediction:confirm | Doctor confirms the diagnosis |
| `GET /nih/clusters` | nih:dashboard | Aggregated, anonymized clusters (heatmap) |
| `GET /nih/alerts` | nih:alerts | Alerts feed |
| `POST /nih/alerts/:id/ack` | nih:alerts | Acknowledge an alert |
| `GET /models` | (any auth) | What the inference service serves |
| `POST /models/register` | model:register | Register + activate a model version |
| `POST /labs` / `GET /labs` | lab:manage / any | Manage FL-node/lab records |

## Example doctor flow (after login → access token in `$T`)
```bash
# Create a report and score it in one call
curl -s localhost:4000/predict -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{
    "patientRef":"pt-hash-001","sex":"F","ageYears":24,
    "district":"Lahore","province":"Punjab","latitude":31.52,"longitude":74.35,
    "symptomsText":"fatigue, pale skin, thakan",
    "cbc":{"WBC":7.4,"LYMp":30,"NEUTp":60,"LYMn":2.1,"NEUTn":4.5,"RBC":5.6,
           "HGB":10.2,"HCT":33,"MCV":68,"MCH":21,"MCHC":31,"PLT":250,"PDW":14,"PCT":0.2}}'
# -> { report, prediction:{scores,...}, rule_flags:{thalassemia_trait:{flag:true,...}}, alerts:[...] }

# Doctor confirms
curl -s localhost:4000/predictions/<id>/confirm -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"confirmedCondition":"iron_deficiency_anemia"}'
```
