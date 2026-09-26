// backend/src/services/predictionService.js
// ---------------------------------------------------------------------------
// Orchestrates a prediction end-to-end: call the inference service, resolve the
// model registry row (auto-registering the served version if none is active so
// the FK is always valid), persist the confidence scores + rule flags, and run
// alerting. Shared by POST /reports/:id/predict and the combined POST /predict.
// ---------------------------------------------------------------------------
const Inference = require('./inferenceClient');
const MlModels = require('../models/mlModels');
const Predictions = require('../models/predictions');
const alerting = require('./alerting');
const { logEvent } = require('../middleware/audit');

/** Ensure an ml_models row exists+active for the served model; return its id. */
async function resolveModelId(name, version, classes, actor) {
  const active = await MlModels.getActive(name);
  if (active && active.version === version && JSON.stringify(active.classes) === JSON.stringify(classes)) return active.id;

  // No active version registered yet — register the one the inference service is
  // actually serving, so predictions reference a real model row. (Auto-register
  // is a demo convenience; in production you register deliberately via the API.)
  const reg = await MlModels.register({
    name,
    version: version || 'v0-auto',
    diseaseScope: 'auto-registered from inference service',
    classes: classes || [],
  });
  await MlModels.setActive(reg.id);
  await logEvent({
    actorUserId: actor?.id || null, actorRole: actor?.role_name || null,
    action: 'MODEL_AUTOREGISTER', resourceType: 'ml_model', resourceId: reg.id,
    metadata: { name, version },
  });
  return reg.id;
}

/**
 * Run + persist a prediction for a stored report.
 * @returns { persisted, inference, prediction, rule_flags, alerts }
 */
async function runPrediction({ report, modelName = 'cbc_multiclass', actor }) {
  const inf = await Inference.infer(modelName, report.cbc, report.cbc_units || report.cbc?.units || null);
  const ruleFlags = inf.rule_flags || {};

  // A response without verified ML scores must not create a prediction.
  if (!inf.scores) {
    return { persisted: false, inference: inf, prediction: null,
             rule_flags: ruleFlags, alerts: [] };
  }

  const modelId = await resolveModelId(
    inf.model_name, inf.model_version, inf.classes, actor);

  const prediction = await Predictions.create({
    labReportId: report.id,
    modelId,
    scores: inf.scores,
    topCondition: inf.top_condition,
    topConfidence: inf.top_confidence,
    riskFlag: !!inf.risk_flag,
    inferenceMs: inf.inference_ms,
    ruleFlags,
  });

  const alerts = await alerting.evaluate(report, prediction);
  return { persisted: true, inference: inf, prediction, rule_flags: ruleFlags, alerts };
}

module.exports = { runPrediction, resolveModelId };
