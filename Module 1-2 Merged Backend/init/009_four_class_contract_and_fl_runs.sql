-- FedHealth — 009_four_class_contract_and_fl_runs.sql
--
-- 1. Enforces the four-class CBC model contract (Module 3 ML/schema.py) in the
--    database, so a drifting route, script or seed cannot store old nine-class
--    labels, unknown CBC fields or out-of-range values:
--      * lab_reports.cbc   : keys are a subset of the 10 ordered features, every
--                            value a JSON number inside schema.PLAUSIBLE_RANGES
--                            (canonical units; the API converts before storing)
--      * predictions.scores: exactly healthy/anemia/thalassemia/leukemia, each in
--                            [0,1], summing to 1; top_condition/top_confidence
--                            must be the arg-max of scores
--      * confirmed_condition, alerts.condition: one of the four classes
--      * ml_models          : cbc_multiclass rows carry the four classes in order
--    tests/test_integration_contract.py checks these literals against schema.py.
--    Constraints are added NOT VALID and then validated, so a database that still
--    holds pre-four-class history keeps those rows (as the Module 1 note asked)
--    while every new or updated row is checked.
-- 2. Deactivates any old cbc_multiclass / thal_* model contract (folded in from
--    the standalone Module 1 Database/003_four_class_model_contract.sql).
-- 3. Renames the seeded demo labs. They are geography anchors for reports, not
--    federated-learning participants; the FL nodes are the simulated partitions
--    lab-00..lab-04 recorded in each run's settings.json (see fl_training_runs).
-- 4. Adds scenario/seed and per-round validation columns so the 12 federated
--    Colab runs (3 seeds x iid/non_iid_05/non_iid_01/source) and the Paillier run
--    are distinguishable. Loaded by scripts/import-fl-history.js from
--    round_history.json + settings.json.

-- ---------------------------------------------------------------------------
-- Contract helpers (IMMUTABLE so they can back CHECK constraints)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fedhealth_classes() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT ARRAY['healthy','anemia','thalassemia','leukemia']::text[];
$$;

CREATE OR REPLACE FUNCTION fedhealth_cbc_ranges() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
    SELECT '{"WBC":[0.5,200],"RBC":[1,8],"HGB":[2,24],"HCT":[5,70],"MCV":[40,140],
             "MCH":[10,50],"MCHC":[20,40],"RDW":[9,40],"PLT":[1,1500],"NEUTp":[0,100]}'::jsonb;
$$;

-- TRUE when c is a non-empty object whose keys are model features and whose
-- values are numbers inside the plausible range (inclusive, canonical units).
CREATE OR REPLACE FUNCTION fedhealth_valid_cbc(c jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    r jsonb := fedhealth_cbc_ranges();
    k text;
    v jsonb;
    n numeric;
BEGIN
    IF c IS NULL OR jsonb_typeof(c) <> 'object' OR c = '{}'::jsonb THEN
        RETURN false;
    END IF;
    FOR k, v IN SELECT * FROM jsonb_each(c) LOOP
        IF NOT (r ? k) OR jsonb_typeof(v) <> 'number' THEN
            RETURN false;
        END IF;
        n := (v #>> '{}')::numeric;
        IF n < (r -> k ->> 0)::numeric OR n > (r -> k ->> 1)::numeric THEN
            RETURN false;
        END IF;
    END LOOP;
    RETURN true;
END;
$$;

-- TRUE when s has exactly the four class keys, numeric values in [0,1] summing
-- to 1 (softmax output, 1e-3 tolerance for float32 rounding).
CREATE OR REPLACE FUNCTION fedhealth_valid_scores(s jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    k text;
    v jsonb;
    n numeric;
    total numeric := 0;
BEGIN
    IF s IS NULL OR jsonb_typeof(s) <> 'object' THEN
        RETURN false;
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(s)) <> cardinality(fedhealth_classes()) THEN
        RETURN false;
    END IF;
    FOR k, v IN SELECT * FROM jsonb_each(s) LOOP
        IF NOT (k = ANY (fedhealth_classes())) OR jsonb_typeof(v) <> 'number' THEN
            RETURN false;
        END IF;
        n := (v #>> '{}')::numeric;
        IF n < 0 OR n > 1 THEN
            RETURN false;
        END IF;
        total := total + n;
    END LOOP;
    RETURN abs(total - 1) <= 0.001;
END;
$$;

-- TRUE when top_condition/top_confidence are NULL or are the arg-max of scores.
CREATE OR REPLACE FUNCTION fedhealth_valid_top(s jsonb, top text, conf real) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN top IS NULL THEN conf IS NULL
        WHEN NOT (s ? top) OR conf IS NULL THEN false
        ELSE abs((s ->> top)::numeric - conf::numeric) <= 0.0001
             AND (s ->> top)::numeric >= (SELECT max((value #>> '{}')::numeric) FROM jsonb_each(s))
    END;
$$;

-- ---------------------------------------------------------------------------
-- Deactivate old model contracts; history rows are kept, not relabelled.
-- ---------------------------------------------------------------------------
UPDATE ml_models SET is_active = FALSE
 WHERE name IN ('thal_carrier', 'thal_screen')
    OR (name = 'cbc_multiclass' AND classes <> '["healthy","anemia","thalassemia","leukemia"]'::jsonb);

-- ---------------------------------------------------------------------------
-- Four-class CHECK constraints
-- ---------------------------------------------------------------------------
ALTER TABLE lab_reports
    ADD CONSTRAINT chk_lab_reports_cbc_contract CHECK (fedhealth_valid_cbc(cbc)) NOT VALID;

ALTER TABLE predictions
    ADD CONSTRAINT chk_predictions_scores_four_class CHECK (fedhealth_valid_scores(scores)) NOT VALID,
    ADD CONSTRAINT chk_predictions_top_is_argmax CHECK (fedhealth_valid_top(scores, top_condition, top_confidence)) NOT VALID,
    ADD CONSTRAINT chk_predictions_confirmed_condition
        CHECK (confirmed_condition IS NULL OR confirmed_condition = ANY (fedhealth_classes())) NOT VALID;

ALTER TABLE alerts
    ADD CONSTRAINT chk_alerts_condition
        CHECK (condition IS NULL OR condition = ANY (fedhealth_classes())) NOT VALID;

ALTER TABLE ml_models
    ADD CONSTRAINT chk_ml_models_four_class
        CHECK (name <> 'cbc_multiclass' OR classes = '["healthy","anemia","thalassemia","leukemia"]'::jsonb) NOT VALID;

-- Validate where the existing rows allow it (always true on a fresh database).
DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
              WHERE conname IN ('chk_lab_reports_cbc_contract', 'chk_predictions_scores_four_class',
                                'chk_predictions_top_is_argmax', 'chk_predictions_confirmed_condition',
                                'chk_alerts_condition', 'chk_ml_models_four_class')
    LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'Constraint % left NOT VALID: pre-four-class history rows exist', c.conname;
        END;
    END LOOP;
END $$;

COMMENT ON COLUMN lab_reports.cbc IS
    'Canonical CBC values used as model input: subset of WBC,RBC,HGB,HCT,MCV,MCH,MCHC,RDW,PLT,NEUTp in 10^3/uL,10^6/uL,g/dL,%,fL,pg,g/dL,%,10^3/uL,%';
COMMENT ON COLUMN lab_reports.sex IS 'Stored for clinical context; NOT a model input';
COMMENT ON COLUMN lab_reports.age_years IS 'Stored for clinical context; NOT a model input';
COMMENT ON COLUMN predictions.scores IS
    'Calibrated four-class confidences {healthy,anemia,thalassemia,leukemia}; screening support, not a diagnosis';
COMMENT ON COLUMN predictions.confirmed_condition IS 'Doctor-confirmed condition; the only authoritative diagnosis';

-- ---------------------------------------------------------------------------
-- Demo labs are report geography, not FL participants.
-- ---------------------------------------------------------------------------
UPDATE labs
   SET name = 'Demo site - ' || district,
       lims_type = NULL,
       fl_client_id = NULL
 WHERE fl_client_id IN ('lab-khi-01', 'lab-lhr-01', 'lab-isb-01', 'lab-psh-01', 'lab-qta-01');

-- ---------------------------------------------------------------------------
-- Registry: provenance, measured limitations and training-data summary.
-- ---------------------------------------------------------------------------
ALTER TABLE ml_models
    ADD COLUMN provenance    JSONB NOT NULL DEFAULT '{}',  -- artifact dir, hashes, training settings, metrics file
    ADD COLUMN limitations   JSONB NOT NULL DEFAULT '{}',  -- measured source-holdout results + protocol notes
    ADD COLUMN training_data JSONB NOT NULL DEFAULT '{}';  -- class/split/source counts from the provenance CSV

-- ---------------------------------------------------------------------------
-- Federated runs: scenario/seed identity and per-round validation detail.
-- ---------------------------------------------------------------------------
ALTER TABLE fl_training_runs
    ADD COLUMN scenario           TEXT,              -- run directory: iid | non_iid_05 | non_iid_01 | source | paillier_iid_r5
    ADD COLUMN seed               INT,
    ADD COLUMN partition_mode     TEXT,              -- settings.mode: iid | non_iid | source
    ADD COLUMN dirichlet_alpha    DOUBLE PRECISION,  -- settings.alpha (non_iid only)
    ADD COLUMN selected_round     INT,               -- round chosen on validation log loss; 0 = starting model kept
    ADD COLUMN lab_train_rows     JSONB NOT NULL DEFAULT '{}',  -- settings.train_rows {lab-00: n, ...}
    ADD COLUMN runtime            TEXT,              -- settings.runtime, verbatim
    ADD COLUMN base_model_version TEXT,              -- round-0 centralized bundle version for this seed
    ADD COLUMN settings           JSONB NOT NULL DEFAULT '{}',  -- settings.json as recorded
    ADD COLUMN test_metrics       JSONB,             -- final_test/<seed>_<scenario>_metrics.json summary, if one exists
    ADD COLUMN equivalence        JSONB;             -- encrypted runs: equivalence_report.json

-- Run files carry no timestamps; completed_at stays NULL unless the importer is
-- given one, instead of pretending the import time is the training time.
ALTER TABLE fl_training_runs
    ALTER COLUMN started_at DROP NOT NULL,
    ALTER COLUMN started_at DROP DEFAULT;

ALTER TABLE fl_training_runs
    ADD CONSTRAINT chk_fl_runs_key_bits CHECK (
        (encryption = 'none' AND key_bits IS NULL) OR
        (encryption = 'paillier' AND key_bits >= 1024)
    ),
    ADD CONSTRAINT chk_fl_runs_selected_round CHECK (
        selected_round IS NULL OR selected_round BETWEEN 0 AND total_rounds
    );

CREATE INDEX idx_fl_runs_scenario_seed ON fl_training_runs(scenario, seed);

COMMENT ON COLUMN fl_training_runs.source_file IS
    'Run directory relative to the repository root; UNIQUE so re-importing is a no-op';

ALTER TABLE fl_rounds
    ADD COLUMN metric_split        TEXT NOT NULL DEFAULT 'validation' CHECK (metric_split = 'validation'),
    ADD COLUMN macro_f1            DOUBLE PRECISION,
    ADD COLUMN sick_called_healthy INT,
    ADD COLUMN eligible            BOOLEAN,
    ADD COLUMN total_examples      INT,
    ADD COLUMN lab_train_rows      JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN fl_rounds.loss IS 'Global validation log loss after aggregation (round 0 = starting model)';
COMMENT ON COLUMN fl_rounds.accuracy IS 'Global validation accuracy after aggregation (round 0 = starting model)';
