-- FedHealth — Module 1 (Database) — MERGED build
-- 006_seed.sql

INSERT INTO roles (name, description) VALUES
    ('admin',        'Full system access. Cannot self-register — created only by scripts/bootstrap-admin.js.'),
    ('doctor',       'General practitioner — CDSS access, confirms diagnoses.'),
    ('lab_tech',     'Laboratory technician — submits CBC reports for own lab.'),
    ('nih_official', 'NIH surveillance officer — aggregated dashboard + alerts only.')
ON CONFLICT (name) DO NOTHING;

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

-- admin: everything
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE name = 'admin'), id FROM permissions
ON CONFLICT DO NOTHING;

-- doctor: patient-level clinical work, not user/lab/model administration,
-- not the NIH surveillance tier
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE name = 'doctor'), id FROM permissions
WHERE code IN ('report:create','report:read','prediction:create','prediction:read','prediction:confirm')
ON CONFLICT DO NOTHING;

-- lab_tech: submits reports, nothing patient-diagnostic
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE name = 'lab_tech'), id FROM permissions
WHERE code IN ('report:create','report:read')
ON CONFLICT DO NOTHING;

-- nih_official: aggregated dashboard + alerts ONLY. Deliberately NO
-- report:read or prediction:read — the NIH tier cannot reach individual
-- patient rows, even via a route-level bug, because the permission to
-- do so simply doesn't exist for this role.
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE name = 'nih_official'), id FROM permissions
WHERE code IN ('nih:dashboard','nih:alerts','audit:read')
ON CONFLICT DO NOTHING;

INSERT INTO gov_email_domains (domain) VALUES
    ('nih.org.pk'),
    ('gov.pk')
ON CONFLICT (domain) DO NOTHING;

-- Demo labs (FL nodes) with real Pakistani coordinates — gives the
-- federated simulation node identities and puts points on the NIH map.
INSERT INTO labs (name, lims_type, district, province, latitude, longitude, fl_client_id) VALUES
    ('Aga Khan Lab - Karachi',  'Nexus Pro', 'Karachi',   'Sindh',     24.8607, 67.0011, 'lab-khi-01'),
    ('Shaukat Khanum - Lahore', 'Nexus Pro', 'Lahore',    'Punjab',    31.5204, 74.3587, 'lab-lhr-01'),
    ('PIMS Lab - Islamabad',    'Nexus Pro', 'Islamabad', 'Islamabad', 33.6844, 73.0479, 'lab-isb-01')
ON CONFLICT (fl_client_id) DO NOTHING;
