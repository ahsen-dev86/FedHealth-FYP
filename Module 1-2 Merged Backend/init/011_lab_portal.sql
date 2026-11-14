-- FedHealth — 011_lab_portal.sql
--
-- Lab engineer portal. A lab engineer is an account with the existing
-- 'lab_tech' role whose users.lab_id points at the lab (FL node) they run.
-- They get ONE new permission, lab:dashboard, which opens GET /lab/dashboard:
-- an operational view of their own lab's node (is it live, how much data it
-- has sent, its federated-training contributions). The route scopes every
-- query to users.lab_id, so the permission alone never exposes another lab.
--
-- Deliberately NOT granted: report:read patient rows beyond what lab_tech
-- already had, prediction:*, nih:*. The dashboard is node/aggregate data only.

INSERT INTO permissions (code, description) VALUES
    ('lab:dashboard', 'View the operations dashboard of the caller''s own lab / FL node')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name IN ('lab_tech', 'admin') AND p.code = 'lab:dashboard'
ON CONFLICT DO NOTHING;

UPDATE roles
   SET description = 'Lab engineer — runs a lab''s FedHealth node; sees that lab''s node dashboard and submits its CBC reports.'
 WHERE name = 'lab_tech';
