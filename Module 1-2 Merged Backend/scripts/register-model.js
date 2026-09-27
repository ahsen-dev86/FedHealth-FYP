#!/usr/bin/env node
// backend/scripts/register-model.js
// ---------------------------------------------------------------------------
// Register the served model bundle in ml_models with its MEASURED results, so
// the Model Health page and every stored prediction point at real numbers:
//   * metrics      <- final_test/<seed>_centralized_metrics.json (the registry
//                     payload: hybrid head, frozen 480-row test split), plus the
//                     ANN and baseline test accuracies from final_test/comparison.json
//   * limitations  <- source_holdout/source_holdout.json (source-exclusion
//                     accuracy per excluded source) + the recorded protocol notes
//   * training_data<- Dataset/fedhealth_cbc_4class_provenance.csv counts
//   * provenance   <- the bundle's meta.json (hashes, training settings, versions)
// The payload must name the same model, version, classes and dataset hash as
// the bundle's meta.json, or nothing is written.
//
//   node scripts/register-model.js                # seed-42 defaults, activates
//   node scripts/register-model.js --bundle <dir> --metrics <json> [--no-activate]
// ---------------------------------------------------------------------------
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MlModels = require('../src/models/mlModels');
const { pool } = require('../src/db/pool');
const { CLASSES, FEATURES, contract } = require('../src/contract');

const ROOT = path.resolve(__dirname, '../..');
const RUN = path.join(ROOT, 'FYP_model_data_drive/FYP/four_class/four_class_v1');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function fail(message) {
  console.error(`[register-model] ${message}`);
  process.exit(1);
}

/** Counts from the dataset provenance file (plain CSV: no quoted commas). */
function trainingData(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const col = (name) => header.indexOf(name);
  const need = ['label', 'split', 'source', 'label_basis', 'imputed'];
  if (need.some((c) => col(c) < 0)) fail(`provenance CSV lacks one of ${need.join(', ')}`);
  const bump = (obj, ...keys) => {
    let o = obj;
    keys.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; });
    o[keys[keys.length - 1]] = (o[keys[keys.length - 1]] || 0) + 1;
  };
  const out = { rows: 0, by_split_class: {}, by_source_class: {}, by_label_basis: {}, rows_with_imputed_values: 0 };
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    if (f.length !== header.length) fail(`unexpected CSV row: ${line.slice(0, 80)}`);
    out.rows += 1;
    bump(out.by_split_class, f[col('split')], f[col('label')]);
    bump(out.by_source_class, f[col('source')], f[col('label')]);
    bump(out.by_label_basis, f[col('label_basis')]);
    if (f[col('imputed')]) out.rows_with_imputed_values += 1;
  }
  return {
    ...out,
    source_file: rel(csvPath),
    sha256: sha256(csvPath),
    note: 'Public-data composite; imputed values were borrowed upstream before the split.',
  };
}

/** Condense the source-holdout report (accuracy when each data source is excluded) into the registry's `limitations`. */
function summarizeHoldout(holdout, holdoutPath) {
  const sources = Object.entries(holdout.results).map(([source, r]) => ({
    excluded_source: source,
    ann_accuracy: r.all_excluded_source_rows.ann.accuracy,
    hybrid_accuracy: r.all_excluded_source_rows.hybrid.accuracy,
    ann_macro_f1: r.all_excluded_source_rows.ann.macro_f1,
    hybrid_macro_f1: r.all_excluded_source_rows.hybrid.macro_f1,
    excluded_rows: r.all_excluded_source_rows.ann.per_class
      ? Object.values(r.all_excluded_source_rows.ann.per_class).reduce((s, c) => s + c.support, 0) : null,
    train_rows: r.train_rows,
    validation_rows: r.validation_rows,
  }));
  const range = (key) => [Math.min(...sources.map((s) => s[key])), Math.max(...sources.map((s) => s[key]))];
  return {
    seed: holdout.seed,
    evaluated_on: 'all rows of the excluded source; ANN and preprocessor refitted without it',
    sources,
    ann_accuracy_range: range('ann_accuracy'),
    hybrid_accuracy_range: range('hybrid_accuracy'),
    note: holdout.limitation,
    source_file: rel(holdoutPath),
  };
}

async function main() {
  const bundle = path.resolve(arg('--bundle', path.join(RUN, 'seed42/centralized/model')));
  const metricsPath = path.resolve(arg('--metrics', path.join(RUN, 'final_test/seed42_centralized_metrics.json')));
  const comparisonPath = path.resolve(arg('--comparison', path.join(RUN, 'final_test/comparison.json')));
  const holdoutPath = path.resolve(arg('--holdout', path.join(RUN, 'source_holdout/source_holdout.json')));
  const provenanceCsv = path.resolve(arg('--provenance', path.join(ROOT, 'Dataset/fedhealth_cbc_4class_provenance.csv')));
  const activate = !process.argv.includes('--no-activate');

  const meta = readJson(path.join(bundle, 'meta.json'));
  const payload = readJson(metricsPath);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (payload.model_name !== meta.model_name || payload.version !== meta.version) {
    fail(`metrics are for ${payload.model_name} ${payload.version}, bundle is ${meta.model_name} ${meta.version}`);
  }
  if (!same(payload.classes, meta.classes) || !same(meta.classes, CLASSES)) fail('class order mismatch');
  if (!same(meta.features, FEATURES)) fail('feature order mismatch');
  if (payload.data_sha256 !== meta.data_sha256) fail('metrics and bundle were produced from different datasets');
  if (payload.split !== 'test') fail(`expected final test metrics, got split ${payload.split}`);

  const key = path.basename(metricsPath).replace(/_metrics\.json$/, '');
  const comparison = fs.existsSync(comparisonPath) ? readJson(comparisonPath).results?.[key] : null;
  const pick = (m) => m && {
    accuracy: m.accuracy, macro_f1: m.macro_f1, log_loss: m.log_loss, ece_15_bins: m.ece_15_bins,
    sick_called_healthy: m.sick_called_healthy, per_class_recall: m.per_class_recall,
  };
  const metrics = {
    ...payload.metrics,
    split: 'test',
    test_rows: payload.metrics.confusion_matrix.flat().reduce((s, n) => s + n, 0),
    head: meta.artifact_type,
    ann: pick(comparison?.metrics?.ann),
    baselines: comparison ? Object.fromEntries(Object.entries(comparison.metrics)
      .filter(([k]) => !['ann', 'hybrid'].includes(k)).map(([k, m]) => [k, pick(m)])) : undefined,
    source_file: rel(metricsPath),
    source_sha256: sha256(metricsPath),
  };

  const comparisonNotes = fs.existsSync(comparisonPath) ? readJson(comparisonPath).limitations || [] : [];
  const holdout = fs.existsSync(holdoutPath) ? summarizeHoldout(readJson(holdoutPath), holdoutPath) : null;
  const limitations = {
    source_holdout: holdout,
    notes: [
      ...comparisonNotes,
      'Single public-data composite with one supplied random split; not validated on data from unseen labs.',
      'Screening support only; confidence scores are not diagnoses and need doctor confirmation.',
    ],
  };

  const provenance = {
    artifact_dir: rel(bundle),
    artifact_type: meta.artifact_type,
    origin: meta.origin,
    schema_version: meta.schema_version,
    data_sha256: meta.data_sha256,
    provenance_sha256: meta.provenance_sha256,
    manifest_sha256: sha256(path.join(bundle, 'manifest.json')),
    temperature: meta.temperature,
    ann_temperature: meta.ann_temperature,
    training: meta.training,
    selection: meta.selection,
    preprocessor_fit_rows: meta.preprocessor_fit_rows,
    validation_rows: meta.validation_rows,
    environment: meta.environment?.packages,
    git_commit: meta.environment?.git_commit,
    intended_use: meta.intended_use,
    units: meta.units,
  };

  const model = await MlModels.register({
    name: meta.model_name,
    version: meta.version,
    diseaseScope: `CBC screening support: ${CLASSES.join(', ')}. ${meta.intended_use}`,
    classes: meta.classes,
    metrics,
    calibration: 'temperature_scaling',
    provenance,
    limitations,
    trainingData: trainingData(provenanceCsv),
  });
  const active = activate ? await MlModels.setActive(model.id) : model;
  console.log(`[register-model] ${active.name} ${active.version} (id ${active.id}) active=${active.is_active}`);
  console.log(`[register-model] test accuracy ${metrics.accuracy.toFixed(4)}, macro-F1 ${metrics.macro_f1.toFixed(4)}, `
    + `source-holdout ANN accuracy ${holdout ? holdout.ann_accuracy_range.map((x) => x.toFixed(2)).join('-') : 'n/a'}`);
  if (contract.model_name !== meta.model_name) console.warn('[register-model] note: not the contract model name');
}

main()
  .catch((e) => fail(e.stack || e.message))
  .finally(() => pool.end());
