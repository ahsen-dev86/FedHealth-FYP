// frontend/src/model-health/sampleData.js
// ILLUSTRATIVE data for Model Health charts that have no real source yet. Every
// chart that uses it shows a visible "Sample data" badge (see SampleBadge.jsx):
//   * live node status / heartbeat — the federation ran as a batch simulation,
//     so no FL node reports liveness
//   * the intake trend while this deployment has fewer than two days of reports
// Site names are neutral placeholders; no real institution is implied.
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

const SAMPLE_SITES = [
  { name: 'Sample site A', district: 'Karachi', province: 'Sindh', freshnessDays: 1 },
  { name: 'Sample site B', district: 'Lahore', province: 'Punjab', freshnessDays: 0 },
  { name: 'Sample site C', district: 'Islamabad', province: 'Islamabad', freshnessDays: 12 },
  { name: 'Sample site D', district: 'Peshawar', province: 'KPK', freshnessDays: 45 },
];

export function sampleNodeStatus() {
  const now = Date.now();
  return SAMPLE_SITES.map((n, i) => {
    const status = n.freshnessDays <= 7 ? 'up' : n.freshnessDays <= 30 ? 'stale' : 'down';
    return {
      id: `sample-${i + 1}`, name: n.name, district: n.district, province: n.province,
      last_report_at: new Date(now - n.freshnessDays * 86400000).toISOString(),
      reports_7d: status === 'up' ? 20 + i * 6 : status === 'stale' ? 2 : 0,
      reports_total: 300 + i * 120,
      status,
    };
  });
}

// Deterministic (no Math.random) so the sample looks the same on every load.
export function sampleIntake(days = 30) {
  const span = Math.min(days, 21);
  const byDay = Array.from({ length: span }).map((_, i) => ({
    day: ago(span - 1 - i).slice(0, 10),
    count: 12 + ((i * 7) % 17) + (i % 7 === 0 ? 15 : 0),
  }));
  return {
    days,
    byDay,
    bySource: [{ source: 'lims', count: 640 }, { source: 'manual', count: 210 }, { source: 'ocr', count: 95 }],
    byCondition: [
      { condition: 'healthy', count: 410 }, { condition: 'anemia', count: 260 },
      { condition: 'thalassemia', count: 118 }, { condition: 'leukemia', count: 46 },
    ],
    bySite: [],
  };
}
