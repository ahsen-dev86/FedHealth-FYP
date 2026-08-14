-- db/migrations/002_add_rule_flags_symptoms.sql
-- ---------------------------------------------------------------------------
-- Additive, backwards-compatible migration for Module 6.
--   * predictions.rule_flags : the interpretable rule-based flags returned by
--     the inference service alongside the ML confidence scores (e.g. the
--     thalassemia-trait discriminant-index flag). Kept SEPARATE from `scores`
--     so the ML output and the rule output never get conflated.
--   * lab_reports.symptoms   : structured symptoms parsed from the Doctor Portal
--     intake (multilingual). These are decision-support CONTEXT shown to the
--     doctor; they are NOT fed into the CBC model (which is CBC-only).
-- Run once, after schema.sql, on an existing database:
--   psql -f db/migrations/002_add_rule_flags_symptoms.sql
-- ---------------------------------------------------------------------------

ALTER TABLE predictions
    ADD COLUMN IF NOT EXISTS rule_flags JSONB NOT NULL DEFAULT '{}';

ALTER TABLE lab_reports
    ADD COLUMN IF NOT EXISTS symptoms JSONB NOT NULL DEFAULT '{}';
