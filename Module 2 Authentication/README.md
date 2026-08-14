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
