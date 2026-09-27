#!/usr/bin/env node
// backend/scripts/import-fl-history.js
// ---------------------------------------------------------------------------
// Imports federated run records into fl_training_runs / fl_rounds so the Model
// Health charts plot real training history. One run = one directory written by
// Module 4 (run_experiments.py) or Module 5 (encrypted_federation.py):
//
//   <run>/settings.json       seed, mode, alpha, labs, rounds, local_epochs,
//                             train_rows {lab-00: n, ...}, runtime, and for
//                             Paillier runs encryption.modulus_bits
//   <run>/round_history.json  validation[] per round (round 0 = starting model):
//                             log_loss, accuracy, macro_f1, sick_called_healthy,
//                             eligible; aggregation[] per round: total_examples,
//                             train_rows; selected_round
//   <run>/equivalence_report.json  (Paillier runs) plaintext-vs-encrypted check
//
// Lab/node names are the run's own lab ids (lab-00...) with their row counts.
// Encryption is 'paillier' ONLY when settings.json records an encryption block
// (key_bits = its modulus_bits); every other run is imported as 'none'.
// Test metrics are attached from <four_class_v1>/final_test/<seed>_<scenario>
// _metrics.json when that file exists (the frozen one-shot test; never re-run).
// Run files carry no timestamps, so completed_at stays NULL unless given.
//
//   node scripts/import-fl-history.js --all <four_class_v1 dir>
//   node scripts/import-fl-history.js <run dir> [--scenario name]
//        [--base-model <centralized bundle dir>] [--completed-at <ISO time>]
//
// Idempotent: source_file (run dir relative to the repo root) is UNIQUE.
// ---------------------------------------------------------------------------
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { withTransaction, pool } = require('../src/db/pool');
const MlModels = require('../src/models/mlModels');

const ROOT = path.resolve(__dirname, '../..');
const SCENARIOS = ['iid', 'non_iid_05', 'non_iid_01', 'source'];

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readIf = (p) => (fs.existsSync(p) ? readJson(p) : null);

function parseArgs(argv) {
  const opts = { dirs: [], all: null, scenario: null, baseModel: null, completedAt: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') opts.all = argv[++i];
    else if (a === '--scenario') opts.scenario = argv[++i];
    else if (a === '--base-model') opts.baseModel = argv[++i];
    else if (a === '--completed-at') opts.completedAt = argv[++i];
    else opts.dirs.push(a);
  }
  return opts;
}

/** Read one final_test/*_metrics.json (if present) into the shape stored on the run's test_metrics column. */
function testSummary(file) {
  const payload = readIf(file);
  if (!payload) return null;
  const m = payload.metrics;
  return {
    split: payload.split, head: 'hybrid', version: payload.version,
    accuracy: m.accuracy, macro_f1: m.macro_f1, log_loss: m.log_loss,
    sick_called_healthy: m.sick_called_healthy, ece_15_bins: m.ece_15_bins,
    source_file: rel(file),
  };
}

/** Parse one run directory's settings/round_history/equivalence files and insert its run + per-round rows. */
async function importRun(runDir, opts) {
  const dir = path.resolve(runDir);
  const settings = readJson(path.join(dir, 'settings.json'));
  const history = readJson(path.join(dir, 'round_history.json'));
  const scenario = opts.scenario || path.basename(dir);
  const sourceFile = rel(dir);

  const seedDir = path.dirname(dir);
  const runRoot = path.dirname(seedDir);
  const baseMeta = readIf(path.join(opts.baseModel ? path.resolve(opts.baseModel) : path.join(seedDir, 'centralized/model'), 'meta.json'));
  const baseVersion = baseMeta?.version || null;
  const baseRow = baseVersion ? await MlModels.findByNameVersion(baseMeta.model_name, baseVersion) : null;

  const encrypted = !!settings.encryption;
  const keyBits = encrypted ? settings.encryption.modulus_bits : null;
  const finalTest = path.join(runRoot, 'final_test');
  const testMetrics = fs.existsSync(finalTest) && !encrypted ? {
    federated: testSummary(path.join(finalTest, `seed${settings.seed}_${scenario}_metrics.json`)),
    centralized_same_seed: testSummary(path.join(finalTest, `seed${settings.seed}_centralized_metrics.json`)),
  } : null;
  const equivalence = readIf(path.join(dir, 'equivalence_report.json'));

  const validation = history.validation || [];
  const aggregation = new Map((history.aggregation || []).map((a) => [a.round, a]));
  if (validation.length !== settings.rounds + 1) {
    throw new Error(`${sourceFile}: expected ${settings.rounds + 1} validation rounds, found ${validation.length}`);
  }

  return withTransaction(async (db) => {
    const existing = await db.query('SELECT id FROM fl_training_runs WHERE source_file = $1', [sourceFile]);
    if (existing.rows.length) return { sourceFile, skipped: true, id: existing.rows[0].id };

    const { rows: [run] } = await db.query(
      `INSERT INTO fl_training_runs
         (model_id, started_at, completed_at, total_rounds, labs, local_epochs, encryption, key_bits,
          source_file, scenario, seed, partition_mode, dirichlet_alpha, selected_round, lab_train_rows,
          runtime, base_model_version, settings, test_metrics, equivalence)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING id`,
      [baseRow?.id || null, opts.completedAt || null, settings.rounds, settings.labs, settings.local_epochs,
        encrypted ? 'paillier' : 'none', keyBits, sourceFile, scenario, settings.seed, settings.mode,
        settings.alpha, history.selected_round, JSON.stringify(settings.train_rows || {}),
        settings.runtime || null, baseVersion, JSON.stringify(settings),
        testMetrics ? JSON.stringify(testMetrics) : null, equivalence ? JSON.stringify(equivalence) : null]
    );

    for (const v of validation) {
      const agg = aggregation.get(v.round);
      const labs = agg ? Object.keys(agg.train_rows || {}).sort() : [];
      await db.query(
        `INSERT INTO fl_rounds (run_id, round_number, loss, accuracy, macro_f1, sick_called_healthy,
                                eligible, clients, lab_ids, total_examples, lab_train_rows)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [run.id, v.round, v.log_loss, v.accuracy, v.macro_f1, v.sick_called_healthy, v.eligible,
          labs.length, labs.join(','), agg ? agg.total_examples : null, JSON.stringify(agg?.train_rows || {})]
      );
    }
    return { sourceFile, id: run.id, rounds: validation.length, encryption: encrypted ? `paillier/${keyBits}` : 'none',
             selected: history.selected_round };
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dirs = [...opts.dirs];
  if (opts.all) {
    const root = path.resolve(opts.all);
    for (const seed of fs.readdirSync(root).filter((d) => /^seed\d+$/.test(d)).sort()) {
      for (const scenario of SCENARIOS) {
        const d = path.join(root, seed, scenario);
        if (fs.existsSync(path.join(d, 'round_history.json'))) dirs.push(d);
      }
    }
  }
  if (!dirs.length) {
    console.error('Usage: node scripts/import-fl-history.js --all <four_class_v1 dir> | <run dir> [--scenario s] '
      + '[--base-model <bundle>] [--completed-at <ISO>]');
    process.exit(1);
  }
  for (const d of dirs) {
    const r = await importRun(d, opts);
    console.log(r.skipped ? `already imported: ${r.sourceFile}`
      : `imported ${r.sourceFile}: ${r.rounds} rounds (incl. round 0), encryption ${r.encryption}, selected round ${r.selected}`);
  }
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
