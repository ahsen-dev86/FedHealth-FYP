#!/usr/bin/env node
// backend/scripts/import-fl-history.js
// ---------------------------------------------------------------------------
// One-off / rerunnable importer that turns a real Module 4 FL training run
// into rows in fl_training_runs / fl_rounds, so the Model Health dashboard's
// accuracy-over-rounds chart plots genuine training history instead of
// fabricated numbers.
//
// Input: the checkpoint_metadata.json written by
// `Module 4 FL/fl_artifacts.py:save_ann_checkpoint()` after a training run
// (see `Module 4 FL/server.py`), which has the shape:
//   {
//     "run_info": {
//       "rounds": <int>, "labs": <int>, "local_epochs": <int>,
//       "history": {
//         "losses_distributed": [[round, loss], ...],
//         "metrics_distributed": { "<metric>": [[round, value], ...], ... },
//         "metrics_distributed_fit": {
//           "round": [[round, round], ...],
//           "clients": [[round, n], ...],
//           "lab_ids": [[round, "lab-00,lab-01,..."], ...],
//           "total_examples": [[round, n], ...]
//         }
//       }
//     }
//   }
// (Flower serializes its (round, value) tuples as 2-element arrays in JSON.)
//
// Usage:
//   node scripts/import-fl-history.js <path-to-checkpoint_metadata.json> \
//     [--encryption paillier] [--key-bits 2048] [--model-id <uuid>]
//
// Idempotent: fl_training_runs.source_file is UNIQUE, so re-running against
// the same file is a no-op (reports "already imported" and exits 0).
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../src/db/pool');

function parseArgs(argv) {
  const [file, ...rest] = argv;
  const opts = { encryption: 'none', keyBits: null, modelId: null };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const val = rest[i + 1];
    if (flag === '--encryption') opts.encryption = val;
    else if (flag === '--key-bits') opts.keyBits = Number(val);
    else if (flag === '--model-id') opts.modelId = val;
  }
  return { file, opts };
}

/** Flower tuples arrive as [round, value] pairs — index them by round number. */
function byRound(pairs) {
  const map = new Map();
  for (const [round, value] of pairs || []) map.set(round, value);
  return map;
}

async function main() {
  const { file, opts } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error('Usage: node import-fl-history.js <checkpoint_metadata.json> [--encryption paillier] [--key-bits 2048] [--model-id <uuid>]');
    process.exit(1);
  }

  const absPath = path.resolve(file);
  const raw = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  const runInfo = raw.run_info || raw; // tolerate being pointed at run_info directly
  const history = runInfo.history;
  if (!history?.losses_distributed?.length) {
    console.error(`No history.losses_distributed found in ${absPath} — nothing to import.`);
    process.exit(1);
  }

  const sourceFile = path.basename(absPath);
  const existing = await query('SELECT id FROM fl_training_runs WHERE source_file = $1', [sourceFile]);
  if (existing.rows.length) {
    console.log(`Already imported (${sourceFile} -> run ${existing.rows[0].id}). Nothing to do.`);
    await pool.end();
    return;
  }

  const clientsByRound = byRound(history.metrics_distributed_fit?.clients);
  const labIdsByRound = byRound(history.metrics_distributed_fit?.lab_ids);
  const accuracyByRound = byRound(
    history.metrics_distributed?.accuracy || history.metrics_distributed?.macro_f1
  );

  const totalRounds = runInfo.rounds || history.losses_distributed.length;

  const { rows: [run] } = await query(
    `INSERT INTO fl_training_runs (model_id, total_rounds, labs, local_epochs, encryption, key_bits, source_file, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     RETURNING *`,
    [opts.modelId, totalRounds, runInfo.labs || null, runInfo.local_epochs || null,
      opts.encryption, opts.keyBits, sourceFile]
  );

  let inserted = 0;
  for (const [round, loss] of history.losses_distributed) {
    await query(
      `INSERT INTO fl_rounds (run_id, round_number, loss, accuracy, clients, lab_ids)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (run_id, round_number) DO NOTHING`,
      [run.id, round, loss, accuracyByRound.get(round) ?? null,
        clientsByRound.get(round) ?? 0, labIdsByRound.get(round) ?? '']
    );
    inserted += 1;
  }

  console.log(`Imported run ${run.id} from ${sourceFile}: ${inserted} rounds.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
