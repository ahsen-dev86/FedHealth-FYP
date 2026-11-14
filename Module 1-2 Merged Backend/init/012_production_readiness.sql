-- FedHealth — 012_production_readiness.sql
--
-- Production-readiness additions:
--   1. Account verification: every self-registered account uploads one proof
--      document (medical licence, employee card, NGO registration certificate)
--      and stays 'pending' until an administrator approves it. Accounts that
--      existed before this migration are grandfathered as 'approved'.
--   2. Admin reach: help:manage_all lets an administrator manage any NGO's
--      profile and requests; dataset:export covers the confirmed-case dataset.
--   3. Predictions record which model replica served them (primary / backup)
--      and the per-feature explanation returned with the scores.
--   4. confirmed_cases: every doctor-confirmed diagnosis becomes one labelled
--      CBC record for future training. record_hash (the 10 canonical values +
--      the label) is UNIQUE, so an identical record is stored once.
--   5. A consistent patient reference format for new reports.

-- ---------------------------------------------------------------------------
-- 1. Account verification
-- ---------------------------------------------------------------------------
ALTER TABLE users
    ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'approved'
        CHECK (verification_status IN ('pending', 'approved', 'rejected')),
    ADD COLUMN verification_note TEXT,
    ADD COLUMN verified_by UUID REFERENCES users(id),
    ADD COLUMN verified_at TIMESTAMPTZ;

COMMENT ON COLUMN users.verification_status IS
    'Proof-of-role review: pending until an admin approves the uploaded document';

CREATE TABLE user_proofs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    doc_type    TEXT NOT NULL CHECK (doc_type IN
                    ('medical_license', 'employee_card', 'lab_employee_card', 'ngo_registration')),
    filename    TEXT NOT NULL,
    mime_type   TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
    size_bytes  INT  NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    sha256      TEXT NOT NULL,
    content     BYTEA NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Proof documents are write-once: the app can add and read them, never alter them.
GRANT SELECT, INSERT ON user_proofs TO fedhealth_app;

-- ---------------------------------------------------------------------------
-- 2. Permissions
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, description) VALUES
    ('help:manage_all', 'Manage any NGO profile and its supply requests (administrator)'),
    ('dataset:export',  'Read and export the doctor-confirmed case dataset')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'admin' AND p.code IN ('help:manage_all', 'dataset:export')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Serving replica + explanation on each prediction
-- ---------------------------------------------------------------------------
ALTER TABLE predictions
    ADD COLUMN served_by TEXT NOT NULL DEFAULT 'primary' CHECK (served_by IN ('primary', 'backup')),
    ADD COLUMN explanation JSONB;

COMMENT ON COLUMN predictions.served_by IS 'Which model replica produced the scores: primary or the backup fallback';
COMMENT ON COLUMN predictions.explanation IS 'Per-feature Shapley contributions returned by the inference service';

-- ---------------------------------------------------------------------------
-- 4. Doctor-confirmed case dataset (de-duplicated)
-- ---------------------------------------------------------------------------
-- Canonical text of one labelled record: the 10 model features in contract
-- order (numbers without trailing zeros; blank when not measured) + the label.
CREATE FUNCTION fedhealth_case_hash(cbc jsonb, label text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256(convert_to(
        (SELECT string_agg(COALESCE(trim_scale((cbc ->> f)::numeric)::text, ''), '|' ORDER BY ord)
           FROM unnest(ARRAY['WBC','RBC','HGB','HCT','MCV','MCH','MCHC','RDW','PLT','NEUTp'])
                WITH ORDINALITY AS t(f, ord))
        || '|' || label, 'UTF8')), 'hex');
$$;

CREATE TABLE confirmed_cases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_hash     TEXT NOT NULL UNIQUE,
    cbc             JSONB NOT NULL,           -- canonical values, as scored by the model
    label           TEXT NOT NULL CHECK (label IN ('healthy', 'anemia', 'thalassemia', 'leukemia')),
    prediction_id   UUID REFERENCES predictions(id) ON DELETE SET NULL,
    lab_id          UUID REFERENCES labs(id),
    confirmed_by    UUID REFERENCES users(id),
    model_top_condition TEXT,
    model_version   TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE when the doctor later changed the label
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_confirmed_cases_hash CHECK (record_hash = fedhealth_case_hash(cbc, label))
);

CREATE INDEX idx_confirmed_cases_label ON confirmed_cases(label) WHERE is_active;
CREATE INDEX idx_confirmed_cases_prediction ON confirmed_cases(prediction_id);

GRANT SELECT, INSERT, UPDATE ON confirmed_cases TO fedhealth_app;

-- Diagnoses confirmed before this migration join the dataset too (identical records once).
INSERT INTO confirmed_cases (record_hash, cbc, label, prediction_id, lab_id, confirmed_by,
                             model_top_condition, model_version, created_at)
SELECT fedhealth_case_hash(lr.cbc, p.confirmed_condition), lr.cbc, p.confirmed_condition, p.id, lr.lab_id,
       p.confirmed_by, p.top_condition, m.version, COALESCE(p.confirmed_at, p.created_at)
  FROM predictions p
  JOIN lab_reports lr ON lr.id = p.lab_report_id
  JOIN ml_models m ON m.id = p.model_id
 WHERE p.confirmed_condition IN ('healthy', 'anemia', 'thalassemia', 'leukemia')
 ORDER BY COALESCE(p.confirmed_at, p.created_at)
ON CONFLICT (record_hash) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Patient reference format
-- ---------------------------------------------------------------------------
-- New reports carry either a FedHealth patient ID (FH-XXXX-XXXX, Crockford
-- base32 with a check character; issued by GET /patients/new-ref) or the
-- 64-hex HMAC token a LIMS integration derives (models/pseudonymize.js).
-- NOT VALID: rows written before this migration are left as they are until
-- scripts/migrate-patient-refs.js re-keys them and validates the constraint.
ALTER TABLE lab_reports
    ADD CONSTRAINT chk_lab_reports_patient_ref_format CHECK (
        patient_ref ~ '^FH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'
        OR patient_ref ~ '^[0-9a-f]{64}$'
    ) NOT VALID;

-- Old reference -> new FedHealth patient ID, kept so the re-keying is reversible.
CREATE TABLE patient_ref_migrations (
    old_ref     TEXT PRIMARY KEY,
    new_ref     TEXT NOT NULL UNIQUE,
    migrated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON patient_ref_migrations TO fedhealth_app;
