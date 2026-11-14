// backend/src/services/explain.js
// ---------------------------------------------------------------------------
// Explainable AI for one screening result. Two independent layers, kept apart
// on purpose so the doctor can tell what is medicine and what is the model:
//
//   1. READING  — each CBC value against a typical adult reference interval
//      (low / within / high) with the textbook meaning of that finding. This
//      does not involve the model at all.
//   2. ATTRIBUTION — how much each measured value moved each class score, as
//      exact Shapley values computed by the inference service (predictors.py:
//      every present/absent combination of the measured values, absent = the
//      training median). Contributions add up to (score - reference score).
//      They describe THIS model's behaviour, not disease biology.
//
// Reference intervals are typical adult values. The haemoglobin lower limits
// are the WHO anaemia cut-offs (men 13.0 g/dL, non-pregnant women 12.0 g/dL;
// WHO 2024 guideline on haemoglobin cutoffs). Laboratories validate their own
// intervals, and children and pregnancy differ: the UI says so.
// ---------------------------------------------------------------------------
const { FEATURES, CLASSES, contract } = require('../contract');

// [low, high] in canonical units; per-sex where it matters, `any` when sex is not recorded.
const REFERENCE = {
  WBC: { any: [4.0, 11.0] },
  RBC: { M: [4.5, 5.9], F: [4.1, 5.1], any: [4.1, 5.9] },
  HGB: { M: [13.0, 17.5], F: [12.0, 15.5], any: [12.0, 17.5] },
  HCT: { M: [40, 52], F: [36, 46], any: [36, 52] },
  MCV: { any: [80, 100] },
  MCH: { any: [27, 33] },
  MCHC: { any: [32, 36] },
  RDW: { any: [11.5, 14.5] },
  PLT: { any: [150, 450] },
  NEUTp: { any: [40, 75] },
};

// What a low / high value of each index commonly indicates (general haematology).
const MEANING = {
  WBC: {
    what: 'Total white cell count: the immune cells in the blood.',
    low: 'Leukopenia: seen with viral infection, marrow suppression or marrow infiltration.',
    high: 'Leukocytosis: most often infection or inflammation; a very high or rising count needs a blood film to exclude leukaemia.',
  },
  RBC: {
    what: 'Red cell count: the number of oxygen-carrying cells.',
    low: 'Fewer red cells, in keeping with anaemia from blood loss, deficiency or reduced production.',
    high: 'A raised count with small cells (low MCV) is typical of thalassaemia trait; also dehydration or polycythaemia.',
  },
  HGB: {
    what: 'Haemoglobin: the oxygen-carrying protein; the measure that defines anaemia.',
    low: 'Below the WHO anaemia cut-off. The red cell indices (MCV, MCH, RDW) point to the type.',
    high: 'Raised haemoglobin: dehydration, smoking, altitude or polycythaemia.',
  },
  HCT: {
    what: 'Haematocrit: the share of blood volume made up of red cells.',
    low: 'Low red cell volume, moving with haemoglobin in anaemia.',
    high: 'Concentrated blood: dehydration or polycythaemia.',
  },
  MCV: {
    what: 'Mean cell volume: the average size of a red cell.',
    low: 'Microcytosis: iron deficiency or thalassaemia trait are the usual causes.',
    high: 'Macrocytosis: vitamin B12 or folate deficiency, liver disease, alcohol, some drugs.',
  },
  MCH: {
    what: 'Mean cell haemoglobin: the haemoglobin content of an average red cell.',
    low: 'Hypochromia: less haemoglobin per cell, as in iron deficiency and thalassaemia.',
    high: 'Usually accompanies macrocytosis (large cells).',
  },
  MCHC: {
    what: 'Mean cell haemoglobin concentration: haemoglobin relative to cell size.',
    low: 'Hypochromic cells, typically established iron deficiency.',
    high: 'Uncommon: spherocytosis, or a sample/analyser artefact worth re-checking.',
  },
  RDW: {
    what: 'Red cell distribution width: how much red cell size varies.',
    low: 'Rarely of clinical significance.',
    high: 'Mixed cell sizes (anisocytosis): common in iron deficiency; often normal in thalassaemia trait.',
  },
  PLT: {
    what: 'Platelet count: the cells that start clotting.',
    low: 'Thrombocytopenia: bleeding risk; together with abnormal white cells it raises concern for marrow disease.',
    high: 'Thrombocytosis: reactive (iron deficiency, inflammation) far more often than a marrow disorder.',
  },
  NEUTp: {
    what: 'Neutrophil percentage: the share of white cells that are neutrophils.',
    low: 'Relative neutropenia: lymphocytes or abnormal cells make up more of the count.',
    high: 'Neutrophilia: bacterial infection, inflammation, steroid effect.',
  },
};

const round = (x, digits = 4) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(digits));

function referenceFor(feature, sex) {
  const ref = REFERENCE[feature];
  return ref[sex] || ref.any;
}

/** 'low' | 'normal' | 'high' | 'not_measured' for one canonical value. */
function statusOf(value, [low, high]) {
  if (value == null) return 'not_measured';
  if (value < low) return 'low';
  if (value > high) return 'high';
  return 'normal';
}

/**
 * The explanation block of a prediction response.
 * @param canonical  {FEATURE: number} canonical CBC values of the report
 * @param inf        the contract-checked inference result (scores, explanation, top_condition)
 * @param sex        'M' | 'F' | 'O' | null — only selects the reference interval
 */
function buildExplanation({ canonical = {}, inf = {}, sex = null }) {
  const shap = inf.explanation && inf.explanation.contributions ? inf.explanation : null;
  const target = inf.top_condition || CLASSES[0];
  const features = FEATURES.map((feature) => {
    const value = canonical[feature] ?? null;
    const reference = referenceFor(feature, sex);
    const status = statusOf(value, reference);
    const m = MEANING[feature];
    return {
      feature,
      label: contract.feature_labels[feature],
      unit: contract.canonical_units[feature],
      value,
      measured: value != null,
      reference: { low: reference[0], high: reference[1], sexSpecific: !!REFERENCE[feature][sex] },
      status,
      about: m.what,
      meaning: status === 'low' ? m.low : status === 'high' ? m.high
        : status === 'normal' ? 'Within the typical adult reference interval.'
          : 'Not on this report; the model used the training median for it.',
      trainingMedian: shap ? round(shap.reference_values?.[feature], 2) : null,
      // Shapley contribution of this value to each class score (probability points, signed).
      contributions: shap
        ? Object.fromEntries(CLASSES.map((c) => [c, round(shap.contributions[c]?.[feature] ?? 0)]))
        : null,
    };
  });

  let attribution = null;
  if (shap) {
    const drivers = features
      .filter((f) => f.measured)
      .map((f) => ({ feature: f.feature, label: f.label, status: f.status, contribution: f.contributions[target] }))
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    attribution = {
      method: shap.method,
      note: shap.note,
      targetClass: target,
      score: round(inf.scores?.[target]),
      baselineScore: round(shap.baseline_scores?.[target]),
      baselineScores: Object.fromEntries(CLASSES.map((c) => [c, round(shap.baseline_scores?.[c])])),
      drivers,
      modelEvaluations: shap.model_evaluations,
      ms: shap.ms,
    };
  }

  const abnormal = features.filter((f) => f.status === 'low' || f.status === 'high');
  return {
    available: !!shap,
    unavailableReason: shap ? null : (inf.explanation?.error || 'The serving model did not return an attribution.'),
    referenceNote: 'Typical adult reference intervals (haemoglobin lower limits are the WHO anaemia cut-offs). '
      + 'Children, pregnancy and each laboratory\'s own intervals differ; use the interval printed on the report when it differs.',
    sexUsedForReference: sex === 'M' || sex === 'F' ? sex : null,
    features,
    abnormal: abnormal.map((f) => ({ feature: f.feature, status: f.status })),
    attribution,
  };
}

module.exports = { buildExplanation, REFERENCE, MEANING, referenceFor, statusOf };
