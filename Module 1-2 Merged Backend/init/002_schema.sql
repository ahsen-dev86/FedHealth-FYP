-- FedHealth — Module 1 (Database) — MERGED build
-- 002_schema.sql
--
-- This reconciles two prior builds:
--   - our validated build (had the confirmation-role and geo-default
--     triggers; the full test suite proved these two guarantees hold)
--   - an uploaded draft (had richer clinical/domain fields, citext email,
--     federated-learning client hooks, and a daily-granularity NIH view)
--
-- Every guarantee below is enforced AT THE DATABASE LAYER, not just in
-- application code, so it holds even if a route has a bug:
--   * RBAC              -> roles / permissions / role_permissions
--   * Gov-verified NIH   -> users columns + trigger (003)
--   * No AI diagnosis    -> predictions.scores is the only model output;
--                           confirmed_condition is the sole authoritative
--                           diagnosis, and ONLY a doctor/admin may set it
--                           (trigger, 003 — this is the guarantee that was
--                           missing from the uploaded draft).
--   * Geo integrity      -> lab_reports inherits its lab's location by
--                           default (trigger, 003 — also missing from the
--                           uploaded draft; this exact gap was found and
--                           fixed once already this project).
--   * Immutable audit    -> hash-chained + append-only triggers (003) AND
--                           revoked UPDATE/DELETE privilege (005).
--   * Privacy tiering     -> NIH reads ONLY the aggregated
--                           nih_prediction_clusters view (004).

-- ============================================================================
-- 1. RBAC
-- ============================================================================

CREATE TABLE roles (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,   -- 'admin' | 'doctor' | 'lab_tech' | 'nih_official'
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE permissions (
    id          SERIAL PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,   -- e.g. 'report:create', 'nih:dashboard'
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
    role_id       INT NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
    permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Approved government e-mail domains for NIH-official registration.
CREATE TABLE gov_email_domains (
    domain TEXT PRIMARY KEY
);

-- ============================================================================
-- 2. LABS  (federated-learning nodes + geolocation)
-- ============================================================================
-- Defined before `users` so users.lab_id can be a normal inline FK (no
-- ALTER TABLE needed later).
CREATE TABLE labs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    lims_type    TEXT,                          -- e.g. 'Nexus Pro'
    district     TEXT NOT NULL,
    province     TEXT NOT NULL,
    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,
    location     GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
                     ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
                 ) STORED,
    -- id the Dockerized Flower FL client authenticates with (Module 3/4).
    fl_client_id TEXT UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_labs_district ON labs(district);
CREATE INDEX idx_labs_location ON labs USING GIST(location);

-- ============================================================================
-- 3. USERS  (accounts, MFA, lockout)
-- ============================================================================
CREATE TABLE users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 CITEXT UNIQUE NOT NULL,
    password_hash         TEXT,
    full_name             TEXT NOT NULL,
    role_id               INT  NOT NULL REFERENCES roles(id),
    lab_id                UUID REFERENCES labs(id),
    organization          TEXT,                        -- hospital / lab / NIH department name
    is_gov_verified       BOOLEAN NOT NULL DEFAULT FALSE,   -- set TRUE by trigger for valid NIH emails
    mfa_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret            TEXT,
    mfa_confirmed_at      TIMESTAMPTZ,
    status                TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','active','suspended')),
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_lab  ON users(lab_id);

-- ============================================================================
-- 4. LAB REPORTS  (one CBC record)
-- ============================================================================
CREATE TABLE lab_reports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id       UUID REFERENCES labs(id),     -- NULL only for a doctor-entered report with no lab
    created_by   UUID NOT NULL REFERENCES users(id),
    source       TEXT NOT NULL CHECK (source IN ('lims','manual','ocr')),
    -- Opaque pseudonymous token (e.g. HMAC of the lab's internal record
    -- number — see src/models/pseudonymize.js). Never a name/DOB/CNIC.
    patient_ref  TEXT NOT NULL,
    sex          TEXT CHECK (sex IS NULL OR sex IN ('M','F','O')),
    age_years    INT  CHECK (age_years IS NULL OR age_years BETWEEN 0 AND 130),
    cbc          JSONB NOT NULL,
    -- district/province/lat/long are nullable here on purpose: trigger 003
    -- backfills all four from the parent lab whenever the app/doctor
    -- doesn't supply them explicitly, so the NIH view never has to join
    -- back to `labs` AND a forgetful insert can't silently drop off the map.
    district     TEXT,
    province     TEXT,
    latitude     DOUBLE PRECISION,
    longitude    DOUBLE PRECISION,
    location     GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
                     CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
                          THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
                          ELSE NULL
                     END
                 ) STORED,
    collected_at TIMESTAMPTZ,                  -- when the blood sample was taken
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lab_reports_patient ON lab_reports(patient_ref, collected_at);
CREATE INDEX idx_lab_reports_lab     ON lab_reports(lab_id);
CREATE INDEX idx_lab_reports_district ON lab_reports(district);

-- ============================================================================
-- 5. ML MODEL REGISTRY
-- ============================================================================
CREATE TABLE ml_models (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    version       TEXT NOT NULL,
    disease_scope TEXT,
    classes       JSONB NOT NULL,              -- ordered condition keys, incl. 'healthy'
    metrics       JSONB NOT NULL DEFAULT '{}', -- {"macro_f1":..,"per_class_recall":{...}}
    calibration   TEXT,                        -- 'temperature_scaling' | 'platt' | NULL
    is_active     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

-- ============================================================================
-- 6. PREDICTIONS  (confidence scores, NOT categorical labels)
-- ============================================================================
CREATE TABLE predictions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_report_id       UUID NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
    model_id            UUID NOT NULL REFERENCES ml_models(id),
    -- THE model output: a calibrated per-condition confidence map. Never
    -- collapsed into a single disease label.
    scores              JSONB NOT NULL,
    -- Convenience fields for sorting/alerting ONLY. Explicitly NOT a
    -- diagnosis.
    top_condition       TEXT,
    top_confidence       REAL CHECK (top_confidence IS NULL OR top_confidence BETWEEN 0 AND 1),
    risk_flag            BOOLEAN NOT NULL DEFAULT FALSE,
    inference_ms         INT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- --- Doctor confirmation: the ONLY authoritative diagnosis in FedHealth.
    -- Enforced by trg_check_confirmation_role (003): confirmed_by must
    -- resolve to a doctor or admin, or the write is rejected outright.
    confirmed_by         UUID REFERENCES users(id),
    confirmed_condition  TEXT,
    confirmed_at         TIMESTAMPTZ,
    doctor_notes         TEXT,
    CONSTRAINT scores_is_object CHECK (jsonb_typeof(scores) = 'object' AND scores <> '{}'::jsonb)
);

CREATE INDEX idx_predictions_report  ON predictions(lab_report_id);
CREATE INDEX idx_predictions_model   ON predictions(model_id);
CREATE INDEX idx_predictions_created ON predictions(created_at);
CREATE INDEX idx_predictions_risk    ON predictions(risk_flag) WHERE risk_flag = true;

-- ============================================================================
-- 7. ALERTS
-- ============================================================================
CREATE TABLE alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            TEXT NOT NULL CHECK (type IN ('outbreak_cluster','high_risk_case','system')),
    -- Traceable back to the exact case for 'high_risk_case' alerts — the
    -- uploaded draft's alerts had no such link, which loses click-through
    -- from an NIH alert to the record that triggered it.
    prediction_id   UUID REFERENCES predictions(id),
    severity        TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    condition       TEXT,
    district        TEXT,
    province        TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    payload         JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
    dedup_key       TEXT UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    CONSTRAINT chk_alert_shape CHECK (
        (type = 'high_risk_case'  AND prediction_id IS NOT NULL) OR
        (type = 'outbreak_cluster' AND district IS NOT NULL AND condition IS NOT NULL) OR
        (type = 'system')
    )
);

CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_type   ON alerts(type);

-- ============================================================================
-- 8. AUDIT LOG  (append-only, hash-chained — see 003 for the triggers)
-- ============================================================================
CREATE TABLE audit_logs (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id UUID,
    actor_role    TEXT,
    action        TEXT NOT NULL,
    resource_type TEXT,
    resource_id   TEXT,
    ip_address    INET,
    user_agent    TEXT,
    metadata      JSONB NOT NULL DEFAULT '{}',
    prev_hash     BYTEA NOT NULL,
    row_hash      BYTEA NOT NULL
);

CREATE INDEX idx_audit_ts    ON audit_logs(ts);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id);
