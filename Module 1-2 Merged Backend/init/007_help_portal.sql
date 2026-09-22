-- FedHealth — 007_help_portal.sql
--
-- The Help Portal: NGOs/foundations create a public profile and post supply
-- requests (blood, medicines, equipment). Browsing is public (no auth) so
-- donors can find a cause; only the owning NGO can edit its own profile/
-- requests (enforced in the route layer via ngos.user_id = req.user.id).

INSERT INTO roles (name, description) VALUES
    ('ngo', 'NGO / foundation — manages its own public profile and supply requests.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (code, description) VALUES
    ('help:manage_own', 'Create/update own NGO profile and supply requests')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE name = 'ngo'), id FROM permissions
WHERE code IN ('help:manage_own')
ON CONFLICT DO NOTHING;

CREATE TABLE ngos (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    mission        TEXT NOT NULL DEFAULT '',
    description    TEXT NOT NULL DEFAULT '',
    logo_url       TEXT,
    website        TEXT,
    contact_email  CITEXT,
    contact_phone  TEXT,
    district       TEXT,
    province       TEXT,
    -- Free-form {method: details} map, e.g. {"bank": "...", "jazzcash": "...", "easypaisa": "..."}
    donation_info  JSONB NOT NULL DEFAULT '{}',
    -- Reserved for a future admin-verification flow; unused by the v1 self-serve register.
    verified       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE supply_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id        UUID NOT NULL REFERENCES ngos(id) ON DELETE CASCADE,
    category      TEXT NOT NULL CHECK (category IN ('blood','medicine','equipment','funds','other')),
    blood_group   TEXT CHECK (blood_group IS NULL OR blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    quantity      TEXT,               -- free text e.g. "12 units" / "500 test strips"
    urgency       TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low','medium','high','critical')),
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_fulfilled','fulfilled','closed')),
    needed_by     DATE,
    district      TEXT,
    province      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_supply_requests_ngo ON supply_requests(ngo_id);
CREATE INDEX idx_supply_requests_status ON supply_requests(status);
CREATE INDEX idx_ngos_user ON ngos(user_id);

GRANT SELECT, INSERT, UPDATE ON ngos, supply_requests TO fedhealth_app;
