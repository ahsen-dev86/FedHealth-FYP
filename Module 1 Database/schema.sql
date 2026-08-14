-- ============================================================================
-- FedHealth — PostgreSQL schema  (Module 1: Database backbone)
-- ----------------------------------------------------------------------------
-- Target DB image: postgis/postgis:16  (PostgreSQL 16 + PostGIS + contrib)
-- Run order:  psql -f schema.sql   then   psql -f seed/seed.sql
--
-- Design goals this schema enforces AT THE DATABASE LAYER (not just in app code),
-- so they hold even if a route has a bug:
--   * RBAC          -> roles / permissions / role_permissions
--   * MFA + gov-verify for NIH -> users columns + enforce_nih_gov_domain() trigger
--   * Privacy tiering -> NIH sees ONLY the aggregated nih_prediction_clusters view
--   * No categorical AI diagnosis -> predictions.scores (JSONB) is the only model
--                       output; the doctor's confirmed_condition is the sole
--                       authoritative diagnosis.
--   * Immutable audit log (PDPB 2023) -> hash-chained + append-only triggers
--   * Geospatial (NIH heatmaps / cluster detection) -> PostGIS geography columns
-- ============================================================================

-- --- Extensions -------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(); digest() for the audit hash chain
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive, canonical email storage
CREATE EXTENSION IF NOT EXISTS postgis;    -- lab locations + spatial clustering for the NIH tier


-- ============================================================================
-- 1. RBAC  (Module 6.1 — Secure Governance & Role-Based Access)
-- ============================================================================

-- The four stakeholder roles in the FedHealth trust model.
CREATE TABLE roles (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,   -- 'admin' | 'doctor' | 'lab_tech' | 'nih_official'
    description TEXT NOT NULL DEFAULT ''
);

-- Fine-grained permission codes (e.g. 'report:create'). Roles are granted these.
CREATE TABLE permissions (
    id          SERIAL PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

-- Which permissions each role holds. The auth middleware (Module 2) reads this
-- to gate every protected route.
CREATE TABLE role_permissions (
    role_id       INT NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
    permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Approved government e-mail domains. NIH officials MUST register under one of
-- these (scope 6.1.1). Enforced by the enforce_nih_gov_domain() trigger below.
CREATE TABLE gov_email_domains (
    domain TEXT PRIMARY KEY   -- e.g. 'nih.org.pk', 'gov.pk'
);


-- ============================================================================
-- 2. USERS  (accounts, MFA, lockout)   — Module 6.1.1
-- ============================================================================
CREATE TABLE users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 CITEXT UNIQUE NOT NULL,
    password_hash         TEXT,                       -- Argon2/bcrypt hash, set by Module 2 auth
    full_name             TEXT NOT NULL,
    role_id               INT  NOT NULL REFERENCES roles(id),
    lab_id                UUID,                        -- FK to labs added after that table exists
    organization          TEXT,                        -- hospital / lab / NIH department name
    email_verified        BOOLEAN NOT NULL DEFAULT FALSE,
    is_gov_verified       BOOLEAN NOT NULL DEFAULT FALSE,   -- set TRUE by trigger for valid NIH emails
    -- --- MFA (TOTP) ---------------------------------------------------------
    mfa_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret            TEXT,                        -- base32 TOTP secret (encrypt at rest in prod)
    mfa_confirmed_at      TIMESTAMPTZ,
    -- --- account state / brute-force protection -----------------------------
    status                TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','active','suspended')),
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================================
-- 3. LABS  (federated-learning nodes + geolocation)   — Module 6.3 / 6.5
-- ============================================================================
-- Each participating pathology lab is one Flower FL client and one point on the
-- NIH map. Raw patient data never leaves the lab; only its coordinates + name
-- live here, so the NIH tier can plot anonymized aggregates.
CREATE TABLE labs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    lims_type    TEXT,                         -- e.g. 'Nexus Pro'
    district     TEXT NOT NULL,
    province     TEXT NOT NULL,
    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,
    -- Generated PostGIS point (WGS84) for radius search + DBSCAN clustering.
    -- If your PostGIS build rejects a generated geography column, drop this line
    -- and populate `geom` from a BEFORE INSERT trigger instead (same expression).
    geom         GEOGRAPHY(Point, 4326)
                     GENERATED ALWAYS AS
                     ((ST_SetSRID(ST_MakePoint(longitude, latitude), 4326))::geography) STORED,
    fl_client_id TEXT UNIQUE,                  -- id the Dockerized Flower client authenticates with
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Now wire users -> labs (a lab_tech belongs to exactly one lab).
ALTER TABLE users
    ADD CONSTRAINT users_lab_fk FOREIGN KEY (lab_id) REFERENCES labs(id);


-- ============================================================================
-- 4. LAB REPORTS  (a single CBC record)   — Module 6.2 / 6.3.1
-- ============================================================================
CREATE TABLE lab_reports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id       UUID REFERENCES labs(id),                    -- NULL when doctor-entered (manual/OCR)
    created_by   UUID NOT NULL REFERENCES users(id),
    source       TEXT NOT NULL CHECK (source IN ('lims','manual','ocr')),
    -- Pseudonymous patient token — an OPAQUE string (e.g. HMAC of the lab's local
    -- MRN). No name / DOB / national ID is ever stored centrally (PDPB 2023).
    -- It is stable per patient, so we can build longitudinal trends without PII.
    patient_ref  TEXT NOT NULL,
    sex          TEXT CHECK (sex IS NULL OR sex IN ('M','F','O')),
    age_years    INT  CHECK (age_years IS NULL OR age_years BETWEEN 0 AND 130),
    -- Normalized canonical CBC indices, already unit-harmonized (e.g. HGB in g/dL)
    -- by the lab-side normalizer. Stored as JSONB because the three source datasets
    -- have slightly different columns; the canonical key set lives in fedhealth_ml.
    cbc          JSONB NOT NULL,
    -- Denormalized location (copied from the lab, or geocoded for manual entries)
    -- so NIH aggregation never has to touch the labs table.
    district     TEXT,
    province     TEXT,
    latitude     DOUBLE PRECISION,
    longitude    DOUBLE PRECISION,
    collected_at TIMESTAMPTZ,                                 -- when the blood sample was taken
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lab_reports_patient ON lab_reports (patient_ref, collected_at);
CREATE INDEX idx_lab_reports_lab     ON lab_reports (lab_id);


-- ============================================================================
-- 5. ML MODEL REGISTRY   — supports "not biased toward one disease"
-- ============================================================================
-- Every prediction records which model version produced it, and each version
-- carries its per-class validation metrics. This lets you PROVE at defense that
-- the model has balanced recall across diseases (not just high overall accuracy).
CREATE TABLE ml_models (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,               -- 'cbc_multiclass' | 'thal_carrier'
    version       TEXT NOT NULL,               -- e.g. 'v1.0.0'
    disease_scope TEXT NOT NULL,               -- human-readable description
    classes       JSONB NOT NULL,              -- ordered condition keys, incl. 'healthy'
    metrics       JSONB NOT NULL DEFAULT '{}', -- {"macro_f1":..,"per_class_recall":{...}}
    calibration   TEXT,                        -- 'temperature_scaling' | 'platt' | NULL
    is_active     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);


-- ============================================================================
-- 6. PREDICTIONS   — Module 6.2.2  (confidence scores, NOT categorical labels)
-- ============================================================================
CREATE TABLE predictions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_report_id       UUID NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
    model_id            UUID NOT NULL REFERENCES ml_models(id),
    -- THE model output. A calibrated per-condition confidence map, e.g.
    --   {"healthy":0.12,"iron_deficiency_anemia":0.55,"leukemia":0.03, ...}
    -- The system deliberately never collapses this into a single disease label.
    scores              JSONB NOT NULL,
    -- Convenience fields for TRIAGE / ALERT SORTING ONLY. Explicitly NOT a
    -- diagnosis — they just mirror the highest-scoring key so lists and the NIH
    -- alerting pipeline can rank cases without re-parsing the JSON each time.
    top_condition       TEXT,
    top_confidence      REAL CHECK (top_confidence IS NULL OR top_confidence BETWEEN 0 AND 1),
    risk_flag           BOOLEAN NOT NULL DEFAULT FALSE,   -- e.g. high leukemia confidence -> feeds NIH alerts
    inference_ms        INT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- --- Doctor confirmation: the ONLY authoritative diagnosis in FedHealth ---
    confirmed_by        UUID REFERENCES users(id),
    confirmed_condition TEXT,
    confirmed_at        TIMESTAMPTZ,
    doctor_notes        TEXT,
    -- Guard: scores must be a non-empty JSON object.
    CONSTRAINT scores_is_object CHECK (jsonb_typeof(scores) = 'object' AND scores <> '{}'::jsonb)
);
CREATE INDEX idx_predictions_report  ON predictions (lab_report_id);
CREATE INDEX idx_predictions_created ON predictions (created_at);


-- ============================================================================
-- 7. AUDIT LOG   — Module 6.1.2  (immutable, hash-chained, append-only)
-- ============================================================================
-- Tamper-evident log: each row stores the SHA-256 of (previous row_hash || this
-- row's canonical fields), forming a blockchain-style chain. Any edit/delete of
-- an earlier row breaks every hash after it, and is detectable by
-- verify_audit_chain(). UPDATE/DELETE are additionally blocked by triggers.
CREATE TABLE audit_logs (
    id            BIGSERIAL PRIMARY KEY,       -- monotonic order = chain order
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id UUID,                        -- NULL for system-generated events
    actor_role    TEXT,
    action        TEXT NOT NULL,               -- 'LOGIN','VIEW_PREDICTION','CREATE_REPORT', ...
    resource_type TEXT,
    resource_id   TEXT,
    ip_address    INET,
    user_agent    TEXT,
    metadata      JSONB NOT NULL DEFAULT '{}',
    prev_hash     BYTEA NOT NULL,              -- set by trigger (chain link)
    row_hash      BYTEA NOT NULL               -- set by trigger (this row's hash)
);
CREATE INDEX idx_audit_ts    ON audit_logs (ts);
CREATE INDEX idx_audit_actor ON audit_logs (actor_user_id);


-- ============================================================================
-- 8. ALERTS   — Module 6.5.2  (NIH predictive alerting feed)
-- ============================================================================
CREATE TABLE alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            TEXT NOT NULL CHECK (type IN ('outbreak_cluster','high_risk_case','system')),
    severity        TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    condition       TEXT,                       -- condition that triggered it (e.g. 'leukemia')
    district        TEXT,
    province        TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    payload         JSONB NOT NULL DEFAULT '{}',-- {case_count, threshold, window_days, ...}
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ
);
CREATE INDEX idx_alerts_status ON alerts (status);


-- ============================================================================
-- 9. TRIGGERS & FUNCTIONS
-- ============================================================================

-- 9a. Auto-touch updated_at ---------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_touch
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- 9b. Enforce government e-mail domain for NIH officials  (scope 6.1.1) --------
-- Runs on insert or whenever email/role changes. Rejects NIH accounts whose
-- email domain isn't an approved gov domain, and auto-sets is_gov_verified.
CREATE OR REPLACE FUNCTION enforce_nih_gov_domain() RETURNS trigger AS $$
DECLARE
    rname   TEXT;
    edomain TEXT;
BEGIN
    SELECT name INTO rname FROM roles WHERE id = NEW.role_id;

    IF rname = 'nih_official' THEN
        edomain := lower(split_part(NEW.email::text, '@', 2));
        -- Accept an exact domain match OR any sub-domain of an approved domain.
        IF NOT EXISTS (
            SELECT 1 FROM gov_email_domains g
             WHERE edomain = g.domain
                OR edomain LIKE '%.' || g.domain
        ) THEN
            RAISE EXCEPTION
                'NIH officials must register with an approved government email domain (got: %)', edomain
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.is_gov_verified := TRUE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_gov_domain
    BEFORE INSERT OR UPDATE OF email, role_id ON users
    FOR EACH ROW EXECUTE FUNCTION enforce_nih_gov_domain();


-- 9c. Audit hash chain  (compute prev_hash + row_hash on insert) --------------
-- Column defaults (id via BIGSERIAL, ts via now()) are materialized BEFORE this
-- BEFORE-INSERT trigger fires, so NEW.id / NEW.ts are already available to hash.
CREATE OR REPLACE FUNCTION audit_compute_hash() RETURNS trigger AS $$
DECLARE
    last_hash BYTEA;
    genesis   BYTEA := '\x00';
    payload   BYTEA;
BEGIN
    -- Serialize concurrent appends so the chain stays strictly ordered.
    PERFORM pg_advisory_xact_lock(hashtext('fedhealth_audit_chain'));

    SELECT row_hash INTO last_hash FROM audit_logs ORDER BY id DESC LIMIT 1;
    IF last_hash IS NULL THEN
        last_hash := genesis;         -- first row links to the genesis hash
    END IF;
    NEW.prev_hash := last_hash;

    -- Canonical, order-stable serialization of this row's immutable fields.
    payload := convert_to(
        coalesce(NEW.id::text, '')            || '|' ||
        coalesce(NEW.ts::text, '')            || '|' ||
        coalesce(NEW.actor_user_id::text, '') || '|' ||
        coalesce(NEW.actor_role, '')          || '|' ||
        coalesce(NEW.action, '')              || '|' ||
        coalesce(NEW.resource_type, '')       || '|' ||
        coalesce(NEW.resource_id, '')         || '|' ||
        coalesce(NEW.metadata::text, '{}'),
        'UTF8');

    NEW.row_hash := digest(NEW.prev_hash || payload, 'sha256');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_hash
    BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_compute_hash();


-- 9d. Append-only enforcement -------------------------------------------------
-- Blocks UPDATE/DELETE at the row level. Combined with the REVOKE in seed.sql
-- (which stops the app role from even attempting them), the log is immutable.
CREATE OR REPLACE FUNCTION audit_block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only and cannot be %', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_block_mutation();

CREATE TRIGGER trg_audit_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_block_mutation();


-- 9e. Chain verification ------------------------------------------------------
-- Recomputes the whole chain and returns the first tampered row id (or NULL).
-- Call from the compliance view: SELECT * FROM verify_audit_chain();
CREATE OR REPLACE FUNCTION verify_audit_chain()
RETURNS TABLE(ok BOOLEAN, broken_at BIGINT) AS $$
DECLARE
    r             RECORD;
    expected_prev BYTEA := '\x00';
    calc          BYTEA;
    payload       BYTEA;
BEGIN
    FOR r IN SELECT * FROM audit_logs ORDER BY id ASC LOOP
        -- Link check: this row's prev_hash must equal the previous row's hash.
        IF r.prev_hash <> expected_prev THEN
            ok := FALSE; broken_at := r.id; RETURN NEXT; RETURN;
        END IF;

        payload := convert_to(
            coalesce(r.id::text, '')            || '|' ||
            coalesce(r.ts::text, '')            || '|' ||
            coalesce(r.actor_user_id::text, '') || '|' ||
            coalesce(r.actor_role, '')          || '|' ||
            coalesce(r.action, '')              || '|' ||
            coalesce(r.resource_type, '')       || '|' ||
            coalesce(r.resource_id, '')         || '|' ||
            coalesce(r.metadata::text, '{}'),
            'UTF8');
        calc := digest(r.prev_hash || payload, 'sha256');

        -- Content check: recomputed hash must match the stored hash.
        IF calc <> r.row_hash THEN
            ok := FALSE; broken_at := r.id; RETURN NEXT; RETURN;
        END IF;

        expected_prev := r.row_hash;
    END LOOP;

    ok := TRUE; broken_at := NULL; RETURN NEXT;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 10. NIH PRIVACY BOUNDARY  (aggregated, anonymized view)   — Module 6.5.1
-- ============================================================================
-- The NIH tier is granted SELECT on THIS VIEW ONLY (see seed.sql) — never on
-- lab_reports or predictions. It exposes district-level counts and average
-- confidence, with NO patient_ref, NO raw CBC, and NO individual rows. This is
-- the "only anonymized aggregates reach the NIH" guarantee, enforced in SQL.
CREATE OR REPLACE VIEW nih_prediction_clusters AS
SELECT
    lr.province,
    lr.district,
    p.top_condition                          AS condition,
    date_trunc('day', p.created_at)          AS day,
    count(*)                                  AS case_count,
    round(avg(p.top_confidence)::numeric, 3) AS avg_confidence,
    count(*) FILTER (WHERE p.risk_flag)       AS high_risk_count,
    -- District centroid (approx) for the Leaflet heatmap — never an exact patient point.
    avg(lr.latitude)                          AS approx_lat,
    avg(lr.longitude)                         AS approx_lng
FROM predictions p
JOIN lab_reports lr ON lr.id = p.lab_report_id
GROUP BY lr.province, lr.district, p.top_condition, date_trunc('day', p.created_at)
HAVING count(*) >= 1;   -- demo threshold. In production raise to >= 5 for k-anonymity.

-- ============================================================================
-- End of schema.
-- ============================================================================
