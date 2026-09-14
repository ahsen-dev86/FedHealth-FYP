-- FedHealth — Module 1 (Database) — MERGED build
-- test/functional_tests.sql
--
-- Run: psql -d fedhealth -f test/functional_tests.sql
-- Everything below should show EXPECTED, never UNEXPECTED.

\set ON_ERROR_STOP on
\echo '=== T1: nih_official seed has ONLY nih:dashboard, nih:alerts, audit:read ==='
SELECT p.code FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
JOIN roles r ON r.id = rp.role_id
WHERE r.name = 'nih_official' ORDER BY p.code;

\echo '=== T2: audit hash chain forms correctly as fedhealth_app ==='
SET ROLE fedhealth_app;
INSERT INTO audit_logs (action, resource_type, resource_id) VALUES ('LOGIN_SUCCESS','user','u1');
INSERT INTO audit_logs (action, resource_type, resource_id) VALUES ('REPORT_CREATE','lab_report','r1');
RESET ROLE;
SELECT id, encode(prev_hash,'hex') = repeat('0',64) AS is_genesis, length(row_hash) = 32 AS hash_len_ok FROM audit_logs ORDER BY id;
SELECT * FROM verify_audit_chain();  -- expect (true, NULL)

\set ON_ERROR_STOP off
\echo '=== T3: fedhealth_app cannot UPDATE audit_logs (privilege-level block) ==='
SET ROLE fedhealth_app;
UPDATE audit_logs SET action='HACKED' WHERE id=1;
RESET ROLE;

\echo '=== T4: even the table owner is blocked by the trigger (defense in depth) ==='
UPDATE audit_logs SET action='HACKED' WHERE id=1;
DELETE FROM audit_logs WHERE id=1;

\set ON_ERROR_STOP on
\echo '=== T5: tamper (bypass trigger deliberately) + detect ==='
ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_no_update;
UPDATE audit_logs SET action='TAMPERED' WHERE id=2;
ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_no_update;
SELECT * FROM verify_audit_chain();  -- expect (false, 2)

\echo '=== T6: gov email domain trigger — exact match and subdomain ==='
\set ON_ERROR_STOP off
INSERT INTO users (email,full_name,role_id) VALUES ('bad@gmail.com','Bad',(SELECT id FROM roles WHERE name='nih_official'));
\set ON_ERROR_STOP on
INSERT INTO users (email,full_name,role_id) VALUES ('good@nih.org.pk','Good',(SELECT id FROM roles WHERE name='nih_official')) RETURNING is_gov_verified;
INSERT INTO users (email,full_name,role_id) VALUES ('good@surveillance.nih.org.pk','GoodSub',(SELECT id FROM roles WHERE name='nih_official')) RETURNING is_gov_verified;
INSERT INTO users (email,full_name,role_id) VALUES ('doc1@anything.com','Doc One',(SELECT id FROM roles WHERE name='doctor')) RETURNING id;
INSERT INTO users (email,full_name,role_id) VALUES ('tech1@anything.com','Tech One',(SELECT id FROM roles WHERE name='lab_tech')) RETURNING id;

\echo '=== T7: citext — case-insensitive email uniqueness ==='
\set ON_ERROR_STOP off
INSERT INTO users (email,full_name,role_id) VALUES ('DOC1@ANYTHING.COM','Duplicate',(SELECT id FROM roles WHERE name='doctor'));
\set ON_ERROR_STOP on

\echo '=== T8: lab_reports geo auto-default from lab (all coord fields NULL from app) ==='
INSERT INTO lab_reports (lab_id,created_by,source,patient_ref,cbc,district,province,latitude,longitude)
SELECT id, (SELECT id FROM users WHERE email='tech1@anything.com'), 'manual', 'HMAC_T8', '{"hb":12}'::jsonb, NULL,NULL,NULL,NULL
FROM labs LIMIT 1
RETURNING district, province, latitude, longitude, location IS NOT NULL AS has_geo;

\echo '=== T9: explicit doctor-supplied coordinates are NOT overwritten ==='
INSERT INTO lab_reports (lab_id,created_by,source,patient_ref,cbc,district,province,latitude,longitude)
SELECT id, (SELECT id FROM users WHERE email='tech1@anything.com'), 'manual', 'HMAC_T9', '{"hb":10}'::jsonb, 'Model Town','Punjab',31.4805,74.3260
FROM labs LIMIT 1
RETURNING district, province, latitude, longitude;

\echo '=== T10: prediction confirmation role guard ==='
INSERT INTO ml_models (name,version,classes,is_active) VALUES ('m','v1','["healthy","anemia"]'::jsonb,true) RETURNING id \gset model_
INSERT INTO predictions (lab_report_id, model_id, scores, top_condition, top_confidence, risk_flag)
SELECT id, :'model_id', '{"healthy":0.1,"anemia":0.9}'::jsonb, 'anemia', 0.9, true FROM lab_reports WHERE patient_ref='HMAC_T8'
RETURNING id \gset pred_

\set ON_ERROR_STOP off
UPDATE predictions SET confirmed_condition='anemia', confirmed_by=(SELECT id FROM users WHERE email='tech1@anything.com') WHERE id=:'pred_id';
\set ON_ERROR_STOP on
UPDATE predictions SET confirmed_condition='anemia', confirmed_by=(SELECT id FROM users WHERE email='doc1@anything.com') WHERE id=:'pred_id';
SELECT confirmed_condition, confirmed_at IS NOT NULL AS auto_stamped FROM predictions WHERE id=:'pred_id';

\echo '=== T11: NIH view — daily aggregate, no patient-level columns exist on it ==='
SELECT district, province, condition, case_count, avg_confidence, high_risk_count FROM nih_prediction_clusters;
SELECT column_name FROM information_schema.columns WHERE table_name='nih_prediction_clusters' ORDER BY column_name;

\echo '=== T12: fedhealth_app grants sanity check — no UPDATE/DELETE on audit_logs ==='
SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants WHERE grantee='fedhealth_app' GROUP BY table_name ORDER BY table_name;
