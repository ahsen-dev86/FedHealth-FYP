-- FedHealth — Module 1 (Database) — MERGED build
-- 004_view.sql
--
-- The entire NIH privacy boundary lives here. NIH is granted SELECT on
-- THIS VIEW ONLY (005) — never on lab_reports or predictions directly.
-- No patient_ref, no raw CBC, no individual row — ever.
--
-- Daily granularity (adopted from the uploaded draft) lets the NIH
-- dashboard show trend-over-time / emerging clusters, not just an
-- all-time total. The HAVING threshold is a k-anonymity guard: a cluster
-- of 1 in a sparse rural district could otherwise re-identify a specific
-- patient by elimination — raise it for a real deployment.

CREATE VIEW nih_prediction_clusters AS
SELECT
    lr.province,
    lr.district,
    p.top_condition                           AS condition,
    date_trunc('day', p.created_at)           AS day,
    count(*)                                   AS case_count,
    round(avg(p.top_confidence)::numeric, 3)  AS avg_confidence,
    count(*) FILTER (WHERE p.risk_flag)        AS high_risk_count,
    -- Proper geographic centroid (not a naive lat/lng average), as GeoJSON.
    ST_AsGeoJSON(ST_Centroid(ST_Collect(lr.location::geometry)))::jsonb AS centroid
FROM predictions p
JOIN lab_reports lr ON lr.id = p.lab_report_id
WHERE p.top_condition IS NOT NULL
GROUP BY lr.province, lr.district, p.top_condition, date_trunc('day', p.created_at)
HAVING count(*) >= 1;   -- demo threshold; raise to >= 5 for k-anonymity in production
