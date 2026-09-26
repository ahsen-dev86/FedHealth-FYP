-- FedHealth — 010_domain_api_columns.sql
--
-- Module 6 domain API columns. Carries forward
-- "Module 6 Domain API/002_add_rule_flags_symptoms.sql" (rule_flags, symptoms),
-- which was never part of the merged init/ sequence, and adds what the unit-aware
-- report flow needs:
--   * lab_reports.cbc_units    : the unit string declared or printed for each value
--                                (e.g. {"WBC": "/mm3", "PLT": "/mm3"}), kept as entered
--   * lab_reports.cbc_reported : the values as entered/printed, before conversion
--                                (lab_reports.cbc holds the canonical values the model scored)
--   * predictions.imputed_features : features absent from the report that the fitted
--                                preprocessor filled with training medians
-- Sex, age, symptoms and location are stored as clinical/surveillance context and
-- are NOT model inputs. rule_flags stays for API compatibility; the research-only
-- rules are disabled in inference, so the service always returns {}.

ALTER TABLE predictions
    ADD COLUMN IF NOT EXISTS rule_flags JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS imputed_features JSONB NOT NULL DEFAULT '[]';

ALTER TABLE lab_reports
    ADD COLUMN IF NOT EXISTS symptoms JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS cbc_units JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS cbc_reported JSONB NOT NULL DEFAULT '{}';

-- Keys of the unit/as-reported maps and the imputed list must be model features.
CREATE OR REPLACE FUNCTION fedhealth_feature_keys_only(m jsonb, value_type text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_typeof(m) = 'object'
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(m) e
            WHERE NOT (fedhealth_cbc_ranges() ? e.key) OR jsonb_typeof(e.value) <> value_type);
$$;

CREATE OR REPLACE FUNCTION fedhealth_feature_list(a jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_typeof(a) = 'array'
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(a) e
            WHERE jsonb_typeof(e) <> 'string' OR NOT (fedhealth_cbc_ranges() ? (e #>> '{}')));
$$;

ALTER TABLE lab_reports
    ADD CONSTRAINT chk_lab_reports_cbc_units CHECK (fedhealth_feature_keys_only(cbc_units, 'string')),
    ADD CONSTRAINT chk_lab_reports_cbc_reported CHECK (fedhealth_feature_keys_only(cbc_reported, 'number'));

ALTER TABLE predictions
    ADD CONSTRAINT chk_predictions_rule_flags_object CHECK (jsonb_typeof(rule_flags) = 'object'),
    ADD CONSTRAINT chk_predictions_imputed_features CHECK (fedhealth_feature_list(imputed_features));

COMMENT ON COLUMN lab_reports.symptoms IS 'Parsed symptom tags shown to the doctor; NOT a model input';
COMMENT ON COLUMN lab_reports.cbc_units IS 'Unit strings as declared/printed per feature, before conversion';
COMMENT ON COLUMN lab_reports.cbc_reported IS 'CBC values as entered/printed, before unit conversion';
COMMENT ON COLUMN predictions.rule_flags IS 'Research-only rule flags; disabled in inference, always {}; NOT model output';
COMMENT ON COLUMN predictions.imputed_features IS 'Features filled with training medians because the report omitted them';
