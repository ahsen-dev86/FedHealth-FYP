// backend/src/services/alerting.js
// ---------------------------------------------------------------------------
// Module 6.5.2 — predictive alerting. Called after a prediction is stored. If
// the case is high-risk it (a) raises a per-case alert, and (b) checks whether a
// district+condition CLUSTER has crossed the outbreak threshold within the
// window, raising one (de-duplicated) outbreak alert. All alert data is
// aggregate/anonymized — no patient_ref, consistent with the NIH privacy tier.
// ---------------------------------------------------------------------------
const { query } = require('../db/pool');
const Alerts = require('../models/alerts');
const { alerting } = require('../config');

function severityFor(confidence) {
  if (confidence >= 0.75) return 'critical';
  if (confidence >= 0.5) return 'high';
  if (confidence >= 0.3) return 'medium';
  return 'low';
}

/** Count high-risk cases of a condition in a district within the window. */
async function clusterCount(district, condition, windowDays) {
  const { rows } = await query(
    `SELECT count(*)::int AS n
       FROM predictions p JOIN lab_reports lr ON lr.id = p.lab_report_id
      WHERE lr.district = $1 AND p.top_condition = $2 AND p.risk_flag = TRUE
        AND p.created_at >= now() - ($3 || ' days')::interval`,
    [district, condition, windowDays]);
  return rows[0].n;
}

/** Is there already an open outbreak alert for this district+condition? */
async function hasOpenOutbreak(district, condition, windowDays) {
  const { rows } = await query(
    `SELECT 1 FROM alerts
      WHERE type = 'outbreak_cluster' AND status = 'open'
        AND district = $1 AND condition = $2
        AND created_at >= now() - ($3 || ' days')::interval
      LIMIT 1`,
    [district, condition, windowDays]);
  return rows.length > 0;
}

/**
 * Evaluate a freshly-stored prediction for alerting.
 * @param report      lab_reports row (has district/province/lat/lng)
 * @param prediction  predictions row (top_condition, top_confidence, risk_flag)
 * @returns array of alerts created (may be empty)
 */
async function evaluate(report, prediction) {
  const created = [];
  if (!prediction.risk_flag) return created;

  const condition = prediction.top_condition;
  const confidence = Number(prediction.top_confidence) || 0;

  // (a) Per-case high-risk alert.
  created.push(await Alerts.create({
    type: 'high_risk_case',
    severity: severityFor(confidence),
    title: `High-risk ${condition || 'case'} detected`,
    description: `A CBC prediction flagged elevated risk for ${condition}.`,
    condition,
    district: report.district,
    province: report.province,
    latitude: report.latitude,
    longitude: report.longitude,
    payload: { confidence, prediction_id: prediction.id },
  }));

  // (b) Outbreak-cluster alert (only if a district is known).
  if (report.district && condition) {
    const n = await clusterCount(report.district, condition, alerting.clusterWindowDays);
    if (n >= alerting.clusterMinCases &&
        !(await hasOpenOutbreak(report.district, condition, alerting.clusterWindowDays))) {
      created.push(await Alerts.create({
        type: 'outbreak_cluster',
        severity: 'high',
        title: `Possible ${condition} cluster in ${report.district}`,
        description: `${n} high-risk ${condition} cases in ${report.district} within ` +
                     `${alerting.clusterWindowDays} days.`,
        condition,
        district: report.district,
        province: report.province,
        latitude: report.latitude,
        longitude: report.longitude,
        payload: { case_count: n, window_days: alerting.clusterWindowDays,
                   threshold: alerting.clusterMinCases },
      }));
    }
  }
  return created;
}

module.exports = { evaluate, clusterCount, severityFor };
