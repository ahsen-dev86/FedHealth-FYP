-- Preserve old predictions and model rows as evidence; do not rewrite their labels.
BEGIN;
UPDATE ml_models SET is_active = FALSE
WHERE name IN ('thal_carrier', 'thal_screen')
   OR (name = 'cbc_multiclass' AND classes <> '["healthy","anemia","thalassemia","leukemia"]'::jsonb);
COMMIT;
-- Register the selected run using its final *_metrics.json payload, then activate
-- that exact version through the model registry API. No scores are invented here.
