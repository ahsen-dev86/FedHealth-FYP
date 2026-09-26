// backend/src/services/predictionService.js
// ---------------------------------------------------------------------------
// Orchestrates a prediction: check the inference response against the
// four-class contract, resolve the registry row for the EXACT served model
// version, persist the confidence scores, and run NIH alerting. Shared by
// POST /predict (create + predict) and POST /reports/:id/predict.
//
// Registry rule: a prediction must reference the model that produced it. The
// served version is looked up by (name, version). If it was never registered
// (scripts/register-model.js registers the real bundle with its measured test
// metrics), it is auto-registered with EMPTY metrics and activated, and an
// audit event records that; no scores are ever invented for it.
// ---------------------------------------------------------------------------
const Inference = require('./inferenceClient');
const MlModels = require('../models/mlModels');
const Predictions = require('../models/predictions');
const alerting = require('./alerting');
const { logEvent } = require('../middleware/audit');
const { withTransaction } = require('../db/pool');
const { HttpError } = require('../middleware/errors');
const { CLASSES, FEATURES, contract } = require('../contract');

const DISCLAIMER = 'Screening support only, not a diagnosis. The model scores the 10 CBC values only; '
  + 'sex, age, symptoms and location are stored for context and are not model inputs. '
  + 'A doctor must confirm any condition.';

/** Registry row id for the served (name, version); auto-registers an unknown version. */
async function resolveModelId(name, version, classes, actor, db) {
  if (JSON.stringify(classes) !== JSON.stringify(CLASSES)) {
    throw new HttpError(502, `served classes ${JSON.stringify(classes)} do not match ${JSON.stringify(CLASSES)}`);
  }
  const existing = await MlModels.findByNameVersion(name, version, db);
  if (existing) {
    if (JSON.stringify(existing.classes) !== JSON.stringify(classes)) {
      throw new HttpError(502, `registry row ${name} ${version} has a different class order`);
    }
    return existing.id;
  }
  const reg = await MlModels.register({
    name,
    version,
    diseaseScope: 'auto-registered from the inference service; no measured metrics recorded',
    classes,
  }, db);
  await MlModels.setActive(reg.id, db);
  await logEvent({
    actorUserId: actor?.id || null, actorRole: actor?.role_name || null,
    action: 'MODEL_AUTOREGISTER', resourceType: 'ml_model', resourceId: reg.id,
    metadata: { name, version },
  });
  return reg.id;
}

/** Persist a contract-checked inference result for a stored report (inside `db`). */
async function persistPrediction({ report, inf, actor, db }) {
  const modelId = await resolveModelId(inf.model_name, inf.model_version, inf.classes, actor, db);
  const prediction = await Predictions.create({
    labReportId: report.id,
    modelId,
    scores: inf.scores,
    topCondition: inf.top_condition,
    topConfidence: inf.top_confidence,
    riskFlag: !!inf.risk_flag,
    inferenceMs: inf.inference_ms,
    ruleFlags: inf.rule_flags || {},
    imputedFeatures: inf.imputed_features || [],
  }, db);
  const alerts = await alerting.evaluate(report, prediction, {
    riskThreshold: inf.risk_threshold, modelVersion: inf.model_version,
  }, db);
  const model = await MlModels.findById(modelId, db);
  return { prediction, alerts, model };
}

/** The response body shared by both prediction routes. */
function presentPrediction({ report, prediction, alerts, model, inf }) {
  return {
    persisted: true,
    report,
    prediction,
    inference: inf,
    model: model && {
      id: model.id, name: model.name, version: model.version, active: model.is_active,
      calibration: model.calibration, mode: inf.mode,
    },
    screening: {
      disclaimer: DISCLAIMER,
      modelInputs: FEATURES,
      imputedFeatures: inf.imputed_features || [],
      notModelInputs: contract.not_model_inputs,
      riskRule: inf.risk_rule,
      riskThreshold: inf.risk_threshold,
    },
    rule_flags: inf.rule_flags || {},
    alerts,
  };
}

/** Predict on an already-stored report (its cbc is canonical). */
async function runPrediction({ report, modelName = contract.model_name, actor }) {
  const inf = Inference.assertContract(await Inference.infer(modelName, report.cbc, null), report.cbc);
  const stored = await withTransaction((db) => persistPrediction({ report, inf, actor, db }));
  return presentPrediction({ report, inf, ...stored });
}

module.exports = { runPrediction, persistPrediction, presentPrediction, resolveModelId, DISCLAIMER };
