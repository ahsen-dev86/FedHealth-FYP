# FedHealth — Module 1 (Database) + Module 2 (Authentication), merged

This reconciles two prior builds of these modules into one tested pair.
If you're reading this to understand what to trust: **everything in this
folder was executed against a real PostgreSQL 16 + PostGIS 3.4 instance
and a real running Express server this session — not just read and
reasoned about.** See "Validation log" below for the exact evidence.

## Why a merge was needed

Two versions of Module 1 existed: one built and validated earlier in this
project (had two structural DB guarantees the other lacked), and one
uploaded separately (had several genuinely good domain-modeling
improvements the first lacked). Module 2 (Authentication) only existed in
the uploaded version, and tested clean on first pass — it's included here
**byte-for-byte unchanged** (verified with `diff` against the original
upload before and after assembly).

## What changed and why

**Ported in from the validated build (these two were missing from the
uploaded Module 1, and both were proven exploitable before being fixed
here):**
- `trg_check_confirmation_role` — without it, any user id (not just a
  doctor's) could be written to `predictions.confirmed_by` with no error
  anywhere in the stack. Proven live: a lab_tech's id successfully
  "confirmed" a diagnosis. Now a Postgres trigger rejects this outright
  (`SQLSTATE 23514`) regardless of which future route calls it.
- `trg_lab_reports_default_geo` — without it, a report could be inserted
  with a valid `lab_id` but no coordinates, silently degrading the NIH
  map. Proven live: `district/province/latitude/longitude` all came back
  `NULL` for such an insert. Now backfilled from the parent lab
  automatically, without overwriting an explicit doctor-supplied override.

**Kept from the uploaded Module 1 (genuine improvements over the earlier
validated build):**
- `citext` email — case-insensitive, so `Doctor@X.com` and `doctor@x.com`
  can't become two accounts.
- `labs.fl_client_id` / `lims_type` — a real hook for Module 3/4's
  federated clients.
- Gov-domain trigger now matches subdomains (`surveillance.nih.org.pk`),
  not just an exact domain, and sets `users.is_gov_verified`.
- `nih_prediction_clusters` aggregates **per day**, not all-time, with a
  `HAVING count(*) >= 1` comment flagging k-anonymity for production —
  genuinely good privacy engineering, kept and documented.
- Richer clinical fields: `sex`, `age_years`, `collected_at`,
  `doctor_notes`; richer model registry fields: `disease_scope`,
  `calibration`.
- `predictions.scores_is_object` CHECK constraint (scores must be a
  non-empty JSON object) — a good defensive addition that wasn't in the
  earlier build.

**Kept from the validated build instead of the upload:**
- `alerts.prediction_id` FK — the uploaded `alerts` table had no link
  back to the specific prediction that triggered a `high_risk_case`
  alert, which loses click-through traceability. Restored here.
- Least-privilege grants for `fedhealth_app` written directly (no
  GRANT-ALL-then-REVOKE pattern) — same end result for `audit_logs`,
  slightly harder to accidentally regress since there's no REVOKE line
  to remember.
- NIH view's centroid uses proper `ST_Centroid(ST_Collect(...))` instead
  of averaging raw lat/lng — a real geographic centroid, not an
  approximation, while keeping the daily grouping.
- `src/models/pseudonymize.js` — **neither prior version had this at
  all.** `patient_ref` was just accepted as a raw string parameter with
  nothing generating it. This HMAC-SHA256 helper is what actually
  produces an opaque, deterministic, unrecognizable token from a lab's
  internal record number.

**Packaging fix (affected both original zips):** neither ran standalone
as delivered — every file's `require()` path assumed a single merged
`backend/src/{db,models,auth,middleware,config}/` tree. That's the layout
used here.

## Validation log (this session, in order)

1. Built the merged schema from zero (`init/001` through `006`) — clean,
   no errors.
2. `test/functional_tests.sql` — 12 sections, all pass on a fresh
   database: RBAC seed correctness, audit hash chain formation, privilege-
   level *and* trigger-level blocks on `audit_logs` (independently, even
   for the table owner), deliberate tamper + correct detection via
   `verify_audit_chain()`, gov-domain rejection **and** subdomain
   acceptance, `citext` case-insensitive uniqueness, geo auto-default in
   both directions (fills when absent, preserves when supplied), the
   confirmation-role guard in both directions, and the NIH view's exact
   column set.
3. `test/run_layer_tests.js` — 14 checks against the actual Node
   model layer (not just SQL), all pass on a fresh database.
4. Assembled the full backend (`src/` + `scripts/`), confirmed every file
   copied from the Module 2 upload is **byte-identical** to the original
   via `diff`.
5. Installed dependencies, booted the real Express server against the
   merged database, and ran the complete flow over real HTTP:
   register → `/auth/mfa/setup` → a real TOTP code generated from the
   returned secret → `/auth/mfa/verify-setup` → real access token →
   `/auth/me` → confirmed a doctor gets `403` on `/audit` → 5 wrong
   passwords locks the account (`423`), stays locked even with the
   correct password afterward → `nih_official` registration rejected for
   `gmail.com`, accepted for `nih.org.pk` and for a subdomain of it, with
   `is_gov_verified` correctly set → login with a different-case email
   still authenticates (citext) → bootstrapped an admin, completed their
   MFA, hit `/audit` and `/audit/verify` (`{ok:true, broken_at:null}`).
6. Re-ran the exact two exploit scenarios from the audit against the
   merged schema and confirmed both are now rejected correctly, with the
   real Postgres error surfacing (`23514`, doctor-only message).

**One test-ordering note if you re-run things yourself:**
`functional_tests.sql`'s tamper-detection test (T5) deliberately corrupts
the audit chain on purpose, to prove `verify_audit_chain()` catches it.
Rebuild the database fresh (or use a separate one) before running
`run_layer_tests.js` afterward, or its own chain-intact check will
correctly report the chain as broken — because at that point, in that
database, it genuinely is (on purpose).

## Quick start

```
docker compose up -d db
cp .env.example .env      # edit PATIENT_REF_HMAC_KEY and JWT_SECRET
npm install
npm test                   # runs test/run_layer_tests.js
npm run bootstrap:admin    # ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run bootstrap:admin
npm start
```

Manual (no Docker): run `init/001` through `006` in order with `psql -f`,
same as before.

## Integration contract for the rest of the team

**Module 3/4 (federated training / inference)** — `labs.fl_client_id` is
your hook for mapping a Flower client to a lab row. Call
`MlModels.register(...)` before any prediction references that model's
id — `predictions.model_id` is a real foreign key.

**Module 6 (API)** — `patient_ref` must come from
`Pseudonymize.derivePatientRef(labInternalId)`, never a raw identifier.
`Predictions.confirmByDoctor(...)` throws a Postgres error with
`.code === '23514'` if the confirmer isn't a doctor/admin — catch that
specific code (see `src/middleware/errors.js`, already wired for it) and
return `403`. Don't add a second app-side role check — the trigger is the
actual source of truth now.

**Module 7 (trends)** — `LabReports.listByPatient(patientRef)`,
oldest-first.

**Module 8 (NIH Dashboard)** — read *only* `NihClusters.getClusters(...)`.
Never query `predictions` or `lab_reports` directly from anything
reachable by an `nih_official` role. Compliance tab:
`AuditLogs.verifyChain()` → `{ ok, broken_at }`.

**Module 9 (deploy)** — `init/*.sql` mount at
`/docker-entrypoint-initdb.d` (see `docker-compose.yml`). They only run
once, on first start with an empty data volume. Replace the placeholder
passwords in `init/005_roles_and_privileges.sql` before this touches
anything but a laptop, and note that re-running init scripts against a
cluster where the role already exists will **not** silently reset its
password (`IF NOT EXISTS` guard) — use `ALTER ROLE ... WITH PASSWORD` to
rotate deliberately.

## Deliberately not done here

- No seed `ml_models` row — the registry should be populated by whoever
  registers a real model.
- No admin UI wired to `Permissions.grantToRole`/`revokeFromRole` yet —
  the functions exist, nothing calls them.
- CORS is open (`cors()` with no options) — fine for the demo, restrict
  origins before this is ever exposed beyond localhost.
