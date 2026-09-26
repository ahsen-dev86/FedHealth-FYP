// backend/src/models/modelHealth.js
// ---------------------------------------------------------------------------
// Read-side queries for the AI Model Health dashboard (NIH/admin tier,
// 'nih:dashboard'). Everything is aggregate and comes from stored records:
//   * the active registry row (scripts/register-model.js: measured test
//     metrics, source-holdout results, training-data counts)
//   * federated runs (scripts/import-fl-history.js: round_history.json +
//     settings.json; accuracy/loss are GLOBAL VALIDATION values per round,
//     round 0 = the centralized starting model)
//   * live usage from predictions / lab_reports
// FL "nodes" are the simulated partitions lab-00..lab-04 named in each run's
// settings, with their training-row counts — not real sites and not live
// telemetry. Report sites (labs table) appear under data intake instead.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');
const { contract } = require('../contract');
const { HttpError } = require('../middleware/errors');

const RUN_COLUMNS = `t.id, t.scenario, t.seed, t.partition_mode, t.dirichlet_alpha, t.encryption, t.key_bits,
  t.total_rounds, t.labs, t.local_epochs, t.selected_round, t.lab_train_rows, t.runtime,
  t.base_model_version, t.completed_at, t.created_at AS imported_at, t.source_file, t.test_metrics,
  (t.model_id IS NOT NULL) AS registered_base_model`;
const LATEST_FIRST = 't.completed_at DESC NULLS LAST, t.created_at DESC';

/** The active version of the served model (other registry names never stand in for it). */
async function activeModel() {
  const { rows } = await query(
    'SELECT * FROM ml_models WHERE is_active = TRUE AND name = $1 ORDER BY created_at DESC LIMIT 1',
    [contract.model_name]);
  return rows[0] || null;
}

async function summary() {
  const [model, { rows: predRows }, { rows: reportRows }, { rows: runRows }, { rows: byScheme }] = await Promise.all([
    activeModel(),
    query('SELECT COUNT(*)::int AS total, AVG(inference_ms)::float AS avg_ms FROM predictions'),
    query('SELECT COUNT(*)::int AS total FROM lab_reports'),
    query(`SELECT ${RUN_COLUMNS} FROM fl_training_runs t ORDER BY ${LATEST_FIRST} LIMIT 1`),
    query(`SELECT encryption, COUNT(*)::int AS runs,
                  COUNT(*) FILTER (WHERE selected_round = 0)::int AS kept_round_zero
             FROM fl_training_runs GROUP BY encryption`),
  ]);
  return {
    activeModel: model,
    totalPredictions: predRows[0]?.total || 0,
    avgInferenceMs: predRows[0]?.avg_ms != null ? Math.round(predRows[0].avg_ms) : null,
    totalLabReports: reportRows[0]?.total || 0,
    lastTrainingRun: runRows[0] || null,
    trainingRuns: {
      total: byScheme.reduce((s, r) => s + r.runs, 0),
      byEncryption: Object.fromEntries(byScheme.map((r) => [r.encryption, r.runs])),
      keptRoundZero: byScheme.reduce((s, r) => s + r.kept_round_zero, 0),
    },
  };
}

async function runs() {
  const { rows } = await query(
    `SELECT ${RUN_COLUMNS},
            to_jsonb(r0) - 'id' - 'run_id' - 'created_at' AS round_zero,
            to_jsonb(rs) - 'id' - 'run_id' - 'created_at' AS selected,
            to_jsonb(rf) - 'id' - 'run_id' - 'created_at' AS final,
            (SELECT COUNT(*)::int FROM fl_rounds x WHERE x.run_id = t.id AND x.eligible IS FALSE) AS ineligible_rounds,
            (SELECT max((e ->> 'max_abs_weight_difference')::float)
               FROM jsonb_array_elements(COALESCE(t.equivalence, '[]'::jsonb)) e) AS max_abs_weight_difference
       FROM fl_training_runs t
       LEFT JOIN fl_rounds r0 ON r0.run_id = t.id AND r0.round_number = 0
       LEFT JOIN fl_rounds rs ON rs.run_id = t.id AND rs.round_number = t.selected_round
       LEFT JOIN fl_rounds rf ON rf.run_id = t.id AND rf.round_number = t.total_rounds
      ORDER BY t.seed, t.scenario, t.encryption`);
  return rows;
}

/**
 * Per-round validation history. Default run: the active model's seed, IID,
 * plaintext (the reference curve); pick another with runId. `runs` lists them all.
 */
async function accuracyHistory({ runId = null } = {}) {
  const { rows: all } = await query(
    `SELECT t.id, t.scenario, t.seed, t.encryption, t.key_bits, t.total_rounds, t.selected_round,
            t.base_model_version
       FROM fl_training_runs t ORDER BY t.seed, t.scenario, t.encryption`);
  if (all.length === 0) {
    const { rows: versions } = await query(
      'SELECT name, version, metrics, created_at FROM ml_models ORDER BY created_at ASC');
    return {
      source: 'ml_models',
      points: versions.map((v) => ({
        round_number: null, loss: v.metrics?.log_loss ?? null,
        accuracy: v.metrics?.accuracy ?? null, clients: null, created_at: v.created_at, version: v.version,
      })),
      runs: [],
    };
  }
  if (runId && !all.some((r) => r.id === runId)) throw new HttpError(404, 'federated run not found');
  const model = await activeModel();
  const run = (runId && all.find((r) => r.id === runId))
    || all.find((r) => r.base_model_version === model?.version && r.scenario === 'iid' && r.encryption === 'none')
    || all[0];
  const { rows: points } = await query(
    `SELECT round_number, loss, accuracy, macro_f1, sick_called_healthy, eligible, clients, lab_ids,
            total_examples, lab_train_rows
       FROM fl_rounds WHERE run_id = $1 ORDER BY round_number`, [run.id]);
  return { source: 'fl_rounds', metric_split: 'validation', run, points, runs: all };
}

/** FL participants: the lab ids recorded in run settings, with training rows per run. */
async function nodes() {
  const { rows } = await query(
    `SELECT l.key AS lab_id,
            COUNT(*)::int AS runs,
            array_agg(DISTINCT t.scenario ORDER BY t.scenario) AS scenarios,
            MIN(l.value::int) AS min_train_rows,
            MAX(l.value::int) AS max_train_rows,
            jsonb_agg(jsonb_build_object('run_id', t.id, 'scenario', t.scenario, 'seed', t.seed,
                                         'encryption', t.encryption, 'train_rows', l.value::int)
                      ORDER BY t.seed, t.scenario, t.encryption) AS train_rows_by_run
       FROM fl_training_runs t, jsonb_each_text(t.lab_train_rows) l
      GROUP BY l.key ORDER BY l.key`);
  return rows.map((r) => ({
    ...r,
    kind: 'simulated_partition',
    note: 'Partition of the public training split used in federated simulation; not a live site.',
  }));
}

/** Training rows each FL lab contributed, per run (settings.train_rows). */
async function nodeContribution() {
  const { rows } = await query(
    `SELECT t.id AS run_id, t.scenario, t.seed, t.encryption, l.key AS lab_id, l.value::int AS train_rows
       FROM fl_training_runs t, jsonb_each_text(t.lab_train_rows) l
      ORDER BY t.seed, t.scenario, t.encryption, l.key`);
  return rows;
}

/** Reports and predictions actually stored in this database (live, may be sparse). */
async function dataIntake({ days = 30 } = {}) {
  const window = [days];
  const [{ rows: byDay }, { rows: bySource }, { rows: byCondition }, { rows: bySite }] = await Promise.all([
    query(`SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS count
             FROM lab_reports WHERE created_at > now() - ($1 || ' days')::interval
            GROUP BY 1 ORDER BY 1`, window),
    query(`SELECT source, COUNT(*)::int AS count
             FROM lab_reports WHERE created_at > now() - ($1 || ' days')::interval
            GROUP BY source ORDER BY 2 DESC`, window),
    query(`SELECT p.top_condition AS condition, COUNT(*)::int AS count
             FROM predictions p WHERE p.created_at > now() - ($1 || ' days')::interval
            GROUP BY 1 ORDER BY 2 DESC`, window),
    query(`SELECT l.id, l.name, l.district, l.province,
                  MAX(lr.created_at) AS last_report_at,
                  COUNT(lr.id) FILTER (WHERE lr.created_at > now() - ($1 || ' days')::interval)::int AS reports
             FROM labs l LEFT JOIN lab_reports lr ON lr.lab_id = l.id
            GROUP BY l.id ORDER BY l.name`, window),
  ]);
  return { days, byDay, bySource, byCondition, bySite };
}

/** Class/split/source counts of the data the active model was trained on. */
async function trainingData() {
  const model = await activeModel();
  return model ? { model: { name: model.name, version: model.version }, ...model.training_data } : null;
}

async function encryptionStatus() {
  const [{ rows: [latest] }, { rows: byScheme }, { rows: [encRounds] }, { rows: encryptedRuns }] = await Promise.all([
    query(`SELECT t.encryption, t.key_bits, t.total_rounds, t.labs, t.completed_at, t.scenario, t.seed
             FROM fl_training_runs t ORDER BY ${LATEST_FIRST} LIMIT 1`),
    query('SELECT encryption, COUNT(*)::int AS runs FROM fl_training_runs GROUP BY encryption'),
    query(`SELECT COUNT(r.id)::int AS count FROM fl_rounds r JOIN fl_training_runs t ON t.id = r.run_id
            WHERE t.encryption = 'paillier' AND r.round_number > 0`),
    query(`SELECT t.id, t.scenario, t.seed, t.total_rounds, t.labs, t.key_bits, t.completed_at, t.selected_round,
                  t.settings -> 'encryption' AS details,
                  (SELECT max((e ->> 'max_abs_weight_difference')::float)
                     FROM jsonb_array_elements(COALESCE(t.equivalence, '[]'::jsonb)) e) AS max_abs_weight_difference
             FROM fl_training_runs t WHERE t.encryption = 'paillier' ORDER BY ${LATEST_FIRST}`),
  ]);
  const runsByScheme = Object.fromEntries(byScheme.map((r) => [r.encryption, r.runs]));
  return {
    // Legacy keys: describe the most recently completed run only.
    scheme: latest?.encryption || 'none',
    keyBits: latest?.key_bits || null,
    roundsEncrypted: encRounds?.count || 0,
    lastRunCompletedAt: latest?.completed_at || null,
    latestRun: latest || null,
    // Truth across all runs: plaintext runs are 'none'; only runs whose
    // settings.json records Paillier are counted as encrypted.
    runsByScheme,
    encryptedRuns,
    note: 'Encryption applies to federated training updates only (Paillier, simulated key authority, '
      + 'in-process transport). Inference is not encrypted.',
  };
}

/** Measured weaknesses to show next to the headline metrics. */
async function limitations() {
  const model = await activeModel();
  const all = await runs();
  const plaintext = all.filter((r) => r.encryption === 'none');
  const keptZero = plaintext.filter((r) => r.selected_round === 0);
  const delta = (a, b) => (a != null && b != null ? a - b : null);
  return {
    model: model && { name: model.name, version: model.version },
    sourceHoldout: model?.limitations?.source_holdout || null,
    federation: {
      metric: 'global validation log loss selects the round; round 0 is the centralized starting model',
      plaintextRuns: plaintext.length,
      keptRoundZero: keptZero.length,
      runs: plaintext.map((r) => ({
        scenario: r.scenario, seed: r.seed, selected_round: r.selected_round,
        val_loss_round0: r.round_zero?.loss ?? null, val_loss_selected: r.selected?.loss ?? null,
        val_loss_final: r.final?.loss ?? null,
        val_macro_f1_round0: r.round_zero?.macro_f1 ?? null, val_macro_f1_final: r.final?.macro_f1 ?? null,
        test_accuracy_federated: r.test_metrics?.federated?.accuracy ?? null,
        test_accuracy_centralized: r.test_metrics?.centralized_same_seed?.accuracy ?? null,
        test_accuracy_delta: delta(r.test_metrics?.federated?.accuracy, r.test_metrics?.centralized_same_seed?.accuracy),
      })),
    },
    notes: model?.limitations?.notes || [],
  };
}

module.exports = {
  summary, runs, accuracyHistory, nodes, nodeContribution, dataIntake, trainingData, encryptionStatus, limitations,
};
