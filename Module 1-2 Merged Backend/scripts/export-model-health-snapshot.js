#!/usr/bin/env node
// backend/scripts/export-model-health-snapshot.js
// ---------------------------------------------------------------------------
// Writes frontend/src/api/modelHealthSnapshot.json from the database so the
// frontend's mock client (VITE_USE_MOCK=true) shows the REAL registered model,
// run records, limitations and encryption status instead of invented numbers.
// Only registry/run-derived data is exported; live deployment counts
// (predictions, reports, intake) are left out and the mock labels its own as
// sample data. Re-run after registering a model or importing runs.
//
//   node scripts/export-model-health-snapshot.js
// ---------------------------------------------------------------------------
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const MH = require('../src/models/modelHealth');
const { pool } = require('../src/db/pool');

const OUT = path.resolve(__dirname, '../../frontend/src/api/modelHealthSnapshot.json');

async function main() {
  const summary = await MH.summary();
  const runs = await MH.runs();
  const histories = {};
  for (const r of runs) histories[r.id] = (await MH.accuracyHistory({ runId: r.id })).points;
  const defaultRun = (await MH.accuracyHistory({})).run;
  const snapshot = {
    note: 'Snapshot of the real registry and imported run records for the mock client; live counts excluded.',
    exported_at: new Date().toISOString(),
    activeModel: summary.activeModel,
    trainingRuns: summary.trainingRuns,
    lastTrainingRun: summary.lastTrainingRun,
    runs,
    defaultRunId: defaultRun?.id || null,
    histories,
    nodes: await MH.nodes(),
    nodeContribution: await MH.nodeContribution(),
    trainingData: await MH.trainingData(),
    encryption: await MH.encryptionStatus(),
    limitations: await MH.limitations(),
  };
  fs.writeFileSync(OUT, `${JSON.stringify(snapshot)}\n`);
  console.log(`wrote ${path.relative(path.resolve(__dirname, '../..'), OUT)} (${runs.length} runs, `
    + `${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
