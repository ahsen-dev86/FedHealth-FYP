-- FedHealth — Module 1 (Database) — MERGED build
-- 003_functions_and_triggers.sql
--
-- Six guarantees, each enforced here so they hold regardless of which
-- route or script touches the table:
--   1. updated_at bookkeeping
--   2. gov-domain rule for nih_official (now matches subdomains too)
--   3. audit hash chain (append-only, tamper-evident)
--   4. doctor-only diagnosis confirmation  <-- was MISSING in the upload
--   5. lab_reports geo auto-default from its lab <-- was MISSING in the upload
--   6. chain verification function

-- ---------------------------------------------------------------------
-- 1. updated_at
-- ---------------------------------------------------------------------
CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_touch
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. Government e-mail domain rule for NIH officials
-- ---------------------------------------------------------------------
-- Runs on insert or whenever email/role changes. Accepts an exact domain
-- match OR any subdomain of an approved domain, and auto-sets
-- is_gov_verified for display purposes.
CREATE FUNCTION enforce_nih_gov_domain() RETURNS trigger AS $$
DECLARE
    rname   TEXT;
    edomain TEXT;
BEGIN
    SELECT name INTO rname FROM roles WHERE id = NEW.role_id;

    IF rname = 'nih_official' THEN
        edomain := lower(split_part(NEW.email::text, '@', 2));
        IF NOT EXISTS (
            SELECT 1 FROM gov_email_domains g
             WHERE edomain = g.domain OR edomain LIKE '%.' || g.domain
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

-- ---------------------------------------------------------------------
-- 3. Audit hash chain
-- ---------------------------------------------------------------------
CREATE FUNCTION audit_row_payload(
    p_prev_hash     BYTEA, p_user_id UUID, p_action TEXT, p_resource_type TEXT,
    p_resource_id   TEXT, p_metadata JSONB, p_ip_address INET, p_ts TIMESTAMPTZ
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(p_prev_hash, 'hex')
        || COALESCE(p_user_id::text, '')
        || p_action
        || COALESCE(p_resource_type, '')
        || COALESCE(p_resource_id, '')
        || COALESCE(p_metadata::text, '')
        || COALESCE(p_ip_address::text, '')
        || p_ts::text;
$$;

-- Column defaults (id via BIGSERIAL, ts via now()) are materialized BEFORE
-- this BEFORE-INSERT trigger fires, so NEW.id / NEW.ts are already
-- available. Advisory lock serializes concurrent inserts so "read the
-- last hash, then write the next one" is effectively atomic.
CREATE FUNCTION audit_compute_hash() RETURNS trigger AS $$
DECLARE
    last_hash BYTEA;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('fedhealth_audit_logs_chain'));

    SELECT row_hash INTO last_hash FROM audit_logs ORDER BY id DESC LIMIT 1;
    IF last_hash IS NULL THEN
        last_hash := decode(repeat('0', 64), 'hex');   -- genesis: 32 zero bytes
    END IF;

    IF NEW.ts IS NULL THEN
        NEW.ts := now();
    END IF;

    NEW.prev_hash := last_hash;
    NEW.row_hash := digest(
        audit_row_payload(last_hash, NEW.actor_user_id, NEW.action, NEW.resource_type,
                           NEW.resource_id, NEW.metadata, NEW.ip_address, NEW.ts),
        'sha256'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_hash
    BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_compute_hash();

-- Fires regardless of who is connected — even a superuser is blocked —
-- as the second layer of defense-in-depth on top of the revoked
-- UPDATE/DELETE grants in 005_roles_and_privileges.sql.
CREATE FUNCTION audit_block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_block_mutation();

CREATE TRIGGER trg_audit_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_block_mutation();

-- Walks the whole chain; returns the id of the first row whose prev_hash
-- or row_hash no longer matches what it should be, or NULL if intact.
CREATE FUNCTION verify_audit_chain()
RETURNS TABLE(ok boolean, broken_at bigint) AS $$
DECLARE
    rec           RECORD;
    expected_prev BYTEA := decode(repeat('0', 64), 'hex');
    computed_hash BYTEA;
BEGIN
    FOR rec IN SELECT * FROM audit_logs ORDER BY id ASC LOOP
        IF rec.prev_hash IS DISTINCT FROM expected_prev THEN
            RETURN QUERY SELECT false, rec.id; RETURN;
        END IF;

        computed_hash := digest(
            audit_row_payload(rec.prev_hash, rec.actor_user_id, rec.action, rec.resource_type,
                               rec.resource_id, rec.metadata, rec.ip_address, rec.ts),
            'sha256'
        );

        IF computed_hash IS DISTINCT FROM rec.row_hash THEN
            RETURN QUERY SELECT false, rec.id; RETURN;
        END IF;

        expected_prev := rec.row_hash;
    END LOOP;

    RETURN QUERY SELECT true, NULL::bigint;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 4. Doctor-only diagnosis confirmation
--    (this guarantee was MISSING from the uploaded draft — proven
--    exploitable live: a lab_technician id could confirm a diagnosis
--    with nothing anywhere in the stack stopping it)
-- ---------------------------------------------------------------------
CREATE FUNCTION check_confirmation_role() RETURNS trigger AS $$
DECLARE
    confirmer_role TEXT;
BEGIN
    IF NEW.confirmed_condition IS NOT NULL THEN
        IF NEW.confirmed_by IS NULL THEN
            RAISE EXCEPTION 'confirmed_condition cannot be set without confirmed_by'
                USING ERRCODE = 'check_violation';
        END IF;

        SELECT r.name INTO confirmer_role
        FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = NEW.confirmed_by;

        IF confirmer_role IS NULL OR confirmer_role NOT IN ('doctor', 'admin') THEN
            RAISE EXCEPTION 'Only a doctor (or admin override) may confirm a diagnosis, got role: %', confirmer_role
                USING ERRCODE = 'check_violation';
        END IF;

        IF NEW.confirmed_at IS NULL THEN
            NEW.confirmed_at := now();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_confirmation_role
    BEFORE INSERT OR UPDATE OF confirmed_condition, confirmed_by ON predictions
    FOR EACH ROW EXECUTE FUNCTION check_confirmation_role();

-- ---------------------------------------------------------------------
-- 5. lab_reports geo auto-default from its lab
--    (also MISSING from the uploaded draft — proven exploitable live:
--    a report inserted without coordinates came back with district,
--    province, latitude, longitude ALL null even though its lab has
--    known coordinates)
-- ---------------------------------------------------------------------
CREATE FUNCTION default_lab_report_geo() RETURNS trigger AS $$
DECLARE
    lab_row labs%ROWTYPE;
BEGIN
    IF NEW.lab_id IS NOT NULL AND (
        NEW.district IS NULL OR NEW.province IS NULL
        OR NEW.latitude IS NULL OR NEW.longitude IS NULL
    ) THEN
        SELECT * INTO lab_row FROM labs WHERE id = NEW.lab_id;

        NEW.district  := COALESCE(NEW.district, lab_row.district);
        NEW.province  := COALESCE(NEW.province, lab_row.province);
        NEW.latitude  := COALESCE(NEW.latitude, lab_row.latitude);
        NEW.longitude := COALESCE(NEW.longitude, lab_row.longitude);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lab_reports_default_geo
    BEFORE INSERT ON lab_reports
    FOR EACH ROW EXECUTE FUNCTION default_lab_report_geo();
