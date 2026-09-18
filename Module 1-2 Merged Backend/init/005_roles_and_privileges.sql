-- FedHealth — Module 1 (Database) — MERGED build
-- 005_roles_and_privileges.sql
--
-- fedhealth_app is what the Express backend connects as. Deliberately NOT
-- a superuser and NOT the table owner. Grants are additive-only (no
-- blanket GRANT-then-REVOKE) so there's no reliance on remembering a
-- REVOKE elsewhere in this file to keep audit_logs honest — the grant
-- list below simply never includes UPDATE/DELETE on it.
--
-- CHANGE THIS PASSWORD before this runs anywhere but a laptop.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fedhealth_app') THEN
        CREATE ROLE fedhealth_app LOGIN PASSWORD 'change_me_in_prod';
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO fedhealth_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fedhealth_app;

GRANT SELECT, INSERT, UPDATE ON
    roles, permissions, gov_email_domains,
    users, labs, lab_reports, ml_models, predictions, alerts
TO fedhealth_app;

-- role_permissions is the one table that legitimately needs hard DELETE
-- (revoking a permission from a role).
GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO fedhealth_app;

-- The audit log's core guarantee: fedhealth_app can INSERT and SELECT,
-- never UPDATE or DELETE. Even before the triggers in 003 get a chance
-- to reject a mutating statement, Postgres itself refuses it.
GRANT SELECT, INSERT ON audit_logs TO fedhealth_app;

-- NIH's entire access surface, at the grant level: this view and nothing
-- from lab_reports or predictions directly.
GRANT SELECT ON nih_prediction_clusters TO fedhealth_app;
