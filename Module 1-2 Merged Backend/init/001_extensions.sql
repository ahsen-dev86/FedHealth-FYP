-- FedHealth — Module 1 (Database) — MERGED build
-- 001_extensions.sql
--
-- postgis   : geography(Point,4326) type + spatial functions for lab/report
--             locations and the NIH cluster centroid.
-- pgcrypto  : gen_random_uuid() for every surrogate key; digest() for the
--             SHA-256 audit hash chain.
-- citext    : case-insensitive email storage, so "Doctor@X.com" and
--             "doctor@x.com" can't become two accounts. (Adopted from the
--             uploaded Module 1 draft — a real improvement over plain TEXT.)

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
