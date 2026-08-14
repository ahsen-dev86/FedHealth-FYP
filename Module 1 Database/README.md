# FedHealth — Database Module (Module 1)

PostgreSQL backbone for FedHealth: RBAC, users/MFA, labs (FL nodes), CBC lab
reports, an ML-model registry, confidence-score predictions with doctor
confirmation, an immutable hash-chained audit log, alerts, and the aggregated
NIH privacy view.

## Requirements
- A **PostGIS-enabled** PostgreSQL (the schema uses `CREATE EXTENSION postgis`).
  Use the `postgis/postgis:16` image — it's plain PostgreSQL plus PostGIS.

## Run it locally (Docker, quick)
```bash
# 1. Start a PostGIS-enabled Postgres
docker run --name fedhealth-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=fedhealth -p 5432:5432 -d postgis/postgis:16

# 2. Load schema, then seed (run as the superuser so the app-role grants apply)
docker cp schema.sql        fedhealth-db:/schema.sql
docker cp seed/seed.sql      fedhealth-db:/seed.sql
docker exec -it fedhealth-db psql -U postgres -d fedhealth -f /schema.sql
docker exec -it fedhealth-db psql -U postgres -d fedhealth -f /seed.sql
```
(The full stack gets a `docker-compose.yml` in Module 9 — this is just the DB.)

## Point the backend at it
```bash
cp ../backend/.env.example ../backend/.env   # then edit PGPASSWORD
```

## Prove the audit log is tamper-evident (nice for defense)
```sql
-- After some activity exists in audit_logs:
SELECT * FROM verify_audit_chain();     -- ok = true, broken_at = NULL

-- Deletes/updates are blocked outright:
DELETE FROM audit_logs WHERE id = 1;    -- ERROR: audit_logs is append-only ...

-- If a row's content were ever changed out-of-band, verify_audit_chain()
-- returns ok=false and the id of the first broken link.
```

## What the schema enforces (talking points)
- **RBAC** in `roles/permissions/role_permissions`; the NIH role is granted
  *only* `nih:dashboard`, `nih:alerts`, `audit:read` — never report/prediction
  reads.
- **NIH gov-email rule** via the `enforce_nih_gov_domain()` trigger.
- **No categorical AI diagnosis:** `predictions.scores` (JSONB) is the sole model
  output; `predictions.confirmed_condition` (doctor-set) is the sole diagnosis.
- **Privacy boundary in SQL:** NIH data comes from the `nih_prediction_clusters`
  view (aggregated, no patient refs, no raw CBC).
- **Immutable audit:** append-only triggers + hash chain + `REVOKE UPDATE/DELETE`.
