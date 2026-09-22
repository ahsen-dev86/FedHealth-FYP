// backend/src/models/modelHealth.js
// ---------------------------------------------------------------------------
// Read-side queries for the AI Model Health dashboard (NIH/admin tier, same
// permission as the Surveillance dashboard: 'nih:dashboard'). Everything here
// is aggregate — no patient-level data crosses this module.
//
// accuracyHistory() prefers real per-round FL history (fl_rounds, populated by
// scripts/import-fl-history.js from Module 4's checkpoint_metadata.json). If
// no FL run has been imported yet, it falls back to the ml_models version
// timeline (each row's `metrics` jsonb + created_at) so the chart still shows
// something meaningful before the importer has run.
//
// nodes() status is a RECENCY HEURISTIC (last lab_report timestamp), not a
// live FL heartbeat — this project's FL layer is a batch simulation (Module 4),
// not an always-on federation, so there is no true "node is up right now"
// signal to read. Documented rather than faked as real-time telemetry.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');

async function summary() {
  const [{ rows: modelRows }, { rows: predRows }, { rows: reportRows }, { rows: runRows }] = await Promise.all([
    query(`SELECT * FROM ml_models WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1`),
    query(`SELECT COUNT(*)::int AS total, AVG(inference_ms)::float AS avg_ms FROM predictions`),
    query(`SELECT COUNT(*)::int AS total FROM lab_reports`),
    query(`SELECT * FROM fl_training_runs ORDER BY started_at DESC LIMIT 1`),
  ]);
  return {
    activeModel: modelRows[0] || null,
    totalPredictions: predRows[0]?.total || 0,
    avgInferenceMs: predRows[0]?.avg_ms != null ? Math.round(predRows[0].avg_ms) : null,
    totalLabReports: reportRows[0]?.total || 0,
    lastTrainingRun: runRows[0] || null,
  };
}

async function accuracyHistory() {
  const { rows: fromRounds } = await query(
    `SELECT r.round_number, r.loss, r.accuracy, r.clients, r.created_at, r.run_id
       FROM fl_rounds r
       JOIN fl_training_runs t ON t.id = r.run_id
      ORDER BY t.started_at ASC, r.round_number ASC`
  );
  if (fromRounds.length > 0) {
    return { source: 'fl_rounds', points: fromRounds };
  }

  const { rows: versions } = await query(
    `SELECT name, version, metrics, created_at
       FROM ml_models
      ORDER BY created_at ASC`
  );
  return {
    source: 'ml_models',
    points: versions.map((v) => ({
      round_number: null,
      loss: v.metrics?.loss ?? null,
      accuracy: v.metrics?.accuracy ?? v.metrics?.macro_f1 ?? null,
      clients: null,
      created_at: v.created_at,
      version: v.version,
    })),
  };
}

async function nodes() {
  const { rows } = await query(
    `SELECT
        l.id, l.name, l.district, l.province, l.fl_client_id,
        MAX(lr.created_at) AS last_report_at,
        COUNT(lr.id) FILTER (WHERE lr.created_at > now() - interval '7 days') AS reports_7d,
        COUNT(lr.id) FILTER (WHERE lr.created_at > now() - interval '30 days') AS reports_30d,
        COUNT(lr.id) AS reports_total
       FROM labs l
       LEFT JOIN lab_reports lr ON lr.lab_id = l.id
      GROUP BY l.id
      ORDER BY l.name`
  );
  const now = Date.now();
  return rows.map((r) => {
    const lastMs = r.last_report_at ? new Date(r.last_report_at).getTime() : null;
    const ageDays = lastMs ? (now - lastMs) / 86_400_000 : Infinity;
    const status = ageDays <= 7 ? 'up' : ageDays <= 30 ? 'stale' : 'down';
    return {
      ...r,
      reports_7d: Number(r.reports_7d),
      reports_30d: Number(r.reports_30d),
      reports_total: Number(r.reports_total),
      status,
    };
  });
}

async function dataIntake({ days = 30 } = {}) {
  const [{ rows: byDay }, { rows: bySource }, { rows: byCondition }] = await Promise.all([
    query(
      `SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS count
         FROM lab_reports
        WHERE created_at > now() - ($1 || ' days')::interval
        GROUP BY 1 ORDER BY 1`,
      [days]
    ),
    query(
      `SELECT source, COUNT(*)::int AS count
         FROM lab_reports
        WHERE created_at > now() - ($1 || ' days')::interval
        GROUP BY source`,
      [days]
    ),
    query(
      `SELECT COALESCE(p.top_condition, 'unclassified') AS condition, COUNT(*)::int AS count
         FROM lab_reports lr
         JOIN predictions p ON p.lab_report_id = lr.id
        WHERE lr.created_at > now() - ($1 || ' days')::interval
        GROUP BY 1 ORDER BY 2 DESC`,
      [days]
    ),
  ]);
  return { byDay, bySource, byCondition };
}

async function nodeContribution({ days = 30 } = {}) {
  const { rows } = await query(
    `SELECT l.id AS lab_id, l.name, date_trunc('day', lr.created_at) AS day, COUNT(*)::int AS count
       FROM lab_reports lr
       JOIN labs l ON l.id = lr.lab_id
      WHERE lr.created_at > now() - ($1 || ' days')::interval
      GROUP BY l.id, l.name, 2
      ORDER BY l.name, 2`,
    [days]
  );
  return rows;
}

async function encryptionStatus() {
  const { rows } = await query(
    `SELECT encryption, key_bits, total_rounds, labs, completed_at
       FROM fl_training_runs ORDER BY started_at DESC LIMIT 1`
  );
  const latest = rows[0] || null;
  const { rows: encRounds } = await query(
    `SELECT COUNT(r.id)::int AS count
       FROM fl_rounds r
       JOIN fl_training_runs t ON t.id = r.run_id
      WHERE t.encryption = 'paillier'`
  );
  return {
    scheme: latest?.encryption || 'none',
    keyBits: latest?.key_bits || null,
    roundsEncrypted: encRounds[0]?.count || 0,
    lastRunCompletedAt: latest?.completed_at || null,
  };
}

module.exports = { summary, accuracyHistory, nodes, dataIntake, nodeContribution, encryptionStatus };
