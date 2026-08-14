-- ============================================================================
-- FedHealth — seed data  (run AFTER schema.sql)
--   psql -f seed/seed.sql
-- Seeds: roles, permissions, RBAC matrix, gov domains, demo labs, model
-- registry scaffolding, and the least-privilege application DB role.
-- No user accounts are seeded here — user creation (with password hashing +
-- TOTP) is owned by Module 2 (auth) so secrets are never hand-written in SQL.
-- ============================================================================

-- --- Roles ------------------------------------------------------------------
INSERT INTO roles (name, description) VALUES
    ('admin',        'System administrator — full access, user/model management'),
    ('doctor',       'General practitioner — CDSS access, confirms diagnoses'),
    ('lab_tech',     'Laboratory technician — submits CBC reports for own lab'),
    ('nih_official', 'NIH surveillance officer — aggregated dashboard + alerts only')
ON CONFLICT (name) DO NOTHING;

-- --- Permissions ------------------------------------------------------------
INSERT INTO permissions (code, description) VALUES
    ('report:create',     'Create a CBC lab report'),
    ('report:read',       'Read lab reports within scope'),
    ('prediction:create', 'Request a model inference on a report'),
    ('prediction:read',   'Read prediction confidence scores'),
    ('prediction:confirm','Confirm/override a diagnosis (doctor only)'),
    ('nih:dashboard',     'View the aggregated NIH geospatial dashboard'),
    ('nih:alerts',        'View and acknowledge NIH outbreak alerts'),
    ('audit:read',        'Read the immutable audit log / verify its chain'),
    ('user:manage',       'Create and manage user accounts'),
    ('model:register',    'Register / activate ML model versions'),
    ('lab:manage',        'Create and manage lab (FL node) records')
ON CONFLICT (code) DO NOTHING;

-- --- RBAC matrix ------------------------------------------------------------
-- admin: everything.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- doctor: point-of-care CDSS. Can create reports, run + read + confirm predictions.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
       ON p.code IN ('report:create','report:read',
                     'prediction:create','prediction:read','prediction:confirm')
WHERE r.name = 'doctor'
ON CONFLICT DO NOTHING;

-- lab_tech: submits CBC data for their lab; may read predictions on it.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
       ON p.code IN ('report:create','report:read','prediction:read')
WHERE r.name = 'lab_tech'
ON CONFLICT DO NOTHING;

-- nih_official: aggregated dashboard + alerts ONLY. Deliberately NO report:read
-- or prediction:read — the NIH tier cannot reach individual patient rows.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
       ON p.code IN ('nih:dashboard','nih:alerts','audit:read')
WHERE r.name = 'nih_official'
ON CONFLICT DO NOTHING;

-- --- Approved government e-mail domains for NIH registration ----------------
INSERT INTO gov_email_domains (domain) VALUES
    ('nih.org.pk'),
    ('gov.pk')
ON CONFLICT (domain) DO NOTHING;

-- --- Demo labs (FL nodes) with real Pakistani coordinates -------------------
-- These give the federated simulation node identities and put points on the
-- NIH map. Extend to match however many Flower clients you spin up (Module 4).
INSERT INTO labs (name, lims_type, district, province, latitude, longitude, fl_client_id) VALUES
    ('Aga Khan Lab - Karachi',     'Nexus Pro', 'Karachi',   'Sindh',       24.8607, 67.0011, 'lab-khi-01'),
    ('Shaukat Khanum - Lahore',    'Nexus Pro', 'Lahore',    'Punjab',      31.5204, 74.3587, 'lab-lhr-01'),
    ('PIMS Lab - Islamabad',       'Nexus Pro', 'Islamabad', 'Islamabad',   33.6844, 73.0479, 'lab-isb-01'),
    ('LRH Lab - Peshawar',         'Nexus Pro', 'Peshawar',  'KPK',         34.0151, 71.5249, 'lab-psh-01'),
    ('Civil Hospital - Quetta',    'Nexus Pro', 'Quetta',    'Balochistan', 30.1798, 66.9750, 'lab-qta-01')
ON CONFLICT (fl_client_id) DO NOTHING;

-- --- ML model registry scaffolding ------------------------------------------
-- Placeholder rows so the backend/frontend can develop against a known class
-- set before Colab training finishes. Module 3 will UPDATE these with the real
-- metrics (per-class recall, macro-F1) and flip is_active on. Class keys are the
-- snake_case condition names the model will score. 'healthy' is a real class.
INSERT INTO ml_models (name, version, disease_scope, classes, metrics, calibration, is_active) VALUES
    ('cbc_multiclass', 'v0.0.0-scaffold',
     'CBC-based confidence scoring: anemia subtypes, leukemia, thrombocytopenia, healthy',
     '["healthy","iron_deficiency_anemia","normocytic_hypochromic_anemia",
       "normocytic_normochromic_anemia","other_microcytic_anemia","macrocytic_anemia",
       "thrombocytopenia","leukemia","leukemia_with_thrombocytopenia"]'::jsonb,
     '{}'::jsonb, NULL, FALSE),
    ('thal_carrier', 'v0.0.0-scaffold',
     'CBC-based alpha-thalassemia carrier confidence',
     '["normal","alpha_carrier"]'::jsonb,
     '{}'::jsonb, NULL, FALSE)
ON CONFLICT (name, version) DO NOTHING;


-- ============================================================================
-- Least-privilege application role
-- ----------------------------------------------------------------------------
-- The Express backend connects as `fedhealth_app`, which can read/write the
-- operational tables but is explicitly DENIED UPDATE/DELETE on audit_logs, so
-- the immutable log cannot be altered even if the app is compromised. (The
-- triggers block it too; this is defense-in-depth.)
--
-- NOTE: run this block once, as a superuser. Change the password before any
-- real deployment. If you connect as the default superuser during local dev,
-- these grants are harmless no-ops for you.
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fedhealth_app') THEN
        CREATE ROLE fedhealth_app LOGIN PASSWORD 'change_me_in_prod';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO fedhealth_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fedhealth_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fedhealth_app;

-- Lock down the audit log: append + read only.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM fedhealth_app;
GRANT  SELECT, INSERT                ON audit_logs TO   fedhealth_app;

-- The NIH aggregated view is selectable; base tables are already covered above,
-- but route-level RBAC (Module 2) is what actually keeps NIH users off them.
GRANT SELECT ON nih_prediction_clusters TO fedhealth_app;
