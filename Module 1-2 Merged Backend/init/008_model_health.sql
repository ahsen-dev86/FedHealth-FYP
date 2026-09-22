-- FedHealth — 008_model_health.sql
--
-- Federated-training history for the Model Health dashboard. A "run" is one
-- execution of Module 4's FL server (fl/server.py); each "round" is one
-- federated round within that run, matching the per-round metrics Flower
-- already returns (see fl_artifacts.py's checkpoint_metadata.json). Imported
-- via scripts/import-fl-history.js rather than fabricated — see that script's
-- header for the exact shape it expects.

CREATE TABLE fl_training_runs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id       UUID REFERENCES ml_models(id),
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at   TIMESTAMPTZ,
    total_rounds   INT NOT NULL,
    labs           INT NOT NULL,
    local_epochs   INT,
    encryption     TEXT NOT NULL DEFAULT 'none' CHECK (encryption IN ('none','paillier')),
    key_bits       INT,
    -- Path/name of the checkpoint_metadata.json this run was imported from,
    -- so re-running the importer against the same file is a no-op.
    source_file    TEXT UNIQUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fl_rounds (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id            UUID NOT NULL REFERENCES fl_training_runs(id) ON DELETE CASCADE,
    round_number      INT NOT NULL,
    loss              DOUBLE PRECISION,
    accuracy          DOUBLE PRECISION,   -- from metrics_distributed if present, else NULL
    clients           INT NOT NULL,
    lab_ids           TEXT NOT NULL,      -- comma-separated, as produced by strategy.py
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, round_number)
);

CREATE INDEX idx_fl_rounds_run ON fl_rounds(run_id);

GRANT SELECT, INSERT, UPDATE ON fl_training_runs, fl_rounds TO fedhealth_app;
