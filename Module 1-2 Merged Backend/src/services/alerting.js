// backend/src/services/alerting.js
// ---------------------------------------------------------------------------
// Module 6.5.2 — NIH alerting, run after a prediction is stored.
//
// (a) High-risk case: the inference service sets risk_flag when the LEUKEMIA
//     score reaches its configurable demo threshold (RISK_THRESHOLD, default
//     0.30). The alert is therefore always condition 'leukemia' with the
//     leukemia confidence, even when another class has the top score.
// (b) Cluster: when the top condition is anemia, thalassemia or leukemia, count
//     that condition's predictions in the district within the window (leukemia
//     also counts risk-flagged cases). At >= clusterMinCases one outbreak_cluster
//     alert is raised per district/condition/ISO week (dedup_key). 'healthy'
//     never forms a cluster.
// Alerts carry aggregate context only (no patient_ref, no raw CBC). Scores are
// screening support; alert text says so rather than asserting a diagnosis.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');
const Alerts = require('../models/alerts');
const { alerting } = require('../config');
const { classLabel } = require('../contract');

const RISK_CONDITION = 'leukemia';
const CLUSTER_CONDITIONS = ['anemia', 'thalassemia', 'leukemia'];

function severityFor(confidence) {
  if (confidence >= 0.75) return 'critical';
  if (confidence >= 0.5) return 'high';
  if (confidence >= 0.3) return 'medium';
  return 'low';
}

/** ISO-8601 week label, e.g. 2026-W39, for per-week alert de-duplication. */
function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Cases of `condition` in `district` within the window (leukemia also counts risk flags). */
async function clusterCount(district, condition, windowDays, db) {
  const run = db ? db.query.bind(db) : query;
  const { rows } = await run(
    `SELECT count(*)::int AS n
       FROM predictions p JOIN lab_reports lr ON lr.id = p.lab_report_id
      WHERE lr.district = $1
        AND (p.top_condition = $2 OR ($2 = 'leukemia' AND p.risk_flag))
        AND p.created_at >= now() - ($3 || ' days')::interval`,
    [district, condition, windowDays]);
  return rows[0].n;
}

/**
 * @param report      lab_reports row (district/province/lat/lng)
 * @param prediction  predictions row (scores, top_condition, risk_flag)
 * @param context     { riskThreshold, modelVersion } from the inference response
 * @returns alerts created (may be empty)
 */
async function evaluate(report, prediction, context = {}, db = null) {
  const created = [];
  const scores = prediction.scores || {};
  const geo = {
    district: report.district, province: report.province,
    latitude: report.latitude, longitude: report.longitude,
  };

  if (prediction.risk_flag) {
    const confidence = Number(scores[RISK_CONDITION]) || 0;
    const pct = `${Math.round(confidence * 100)}%`;
    created.push(await Alerts.createHighRiskCase({
      predictionId: prediction.id,
      severity: severityFor(confidence),
      title: `High ${classLabel(RISK_CONDITION).toLowerCase()} screening score (${pct})`,
      description: `Model ${RISK_CONDITION} confidence ${pct} reached the screening threshold `
        + `${context.riskThreshold ?? ''}. Screening flag only; doctor confirmation required.`,
      condition: RISK_CONDITION,
      ...geo,
      payload: {
        confidence, threshold: context.riskThreshold ?? null,
        top_condition: prediction.top_condition, model_version: context.modelVersion ?? null,
      },
    }, db));
  }

  const condition = prediction.top_condition;
  if (report.district && CLUSTER_CONDITIONS.includes(condition)) {
    const n = await clusterCount(report.district, condition, alerting.clusterWindowDays, db);
    if (n >= alerting.clusterMinCases) {
      const alert = await Alerts.createOutbreakCluster({
        severity: condition === RISK_CONDITION ? 'high' : 'medium',
        title: `Possible ${classLabel(condition).toLowerCase()} cluster in ${report.district}`,
        description: `${n} screening results with ${condition} as the top score in ${report.district} `
          + `within ${alerting.clusterWindowDays} days (threshold ${alerting.clusterMinCases}).`,
        condition,
        ...geo,
        payload: { case_count: n, window_days: alerting.clusterWindowDays, threshold: alerting.clusterMinCases },
        dedupKey: `outbreak:${report.district}:${condition}:${isoWeek()}`,
      }, db);
      if (alert) created.push(alert);
    }
  }
  return created;
}

module.exports = { evaluate, clusterCount, severityFor, isoWeek, RISK_CONDITION, CLUSTER_CONDITIONS };
