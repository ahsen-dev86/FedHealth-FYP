// frontend/src/lib/format.js
// Presentation helpers shared across the portal. Keeps snake_case model keys and
// raw numbers out of the UI code.

// Model class keys (snake_case) -> human labels for the confidence readout.
export const CONDITION_LABELS = {
  healthy: 'Healthy',
  iron_deficiency_anemia: 'Iron deficiency anemia',
  normocytic_hypochromic_anemia: 'Normocytic hypochromic anemia',
  normocytic_normochromic_anemia: 'Normocytic normochromic anemia',
  other_microcytic_anemia: 'Other microcytic anemia',
  macrocytic_anemia: 'Macrocytic anemia',
  thrombocytopenia: 'Thrombocytopenia',
  leukemia: 'Leukemia',
  leukemia_with_thrombocytopenia: 'Leukemia + thrombocytopenia',
  normal: 'Normal',
  iron_deficiency: 'Iron deficiency',
  beta_thal_trait: 'Beta-thalassemia trait',
};

export function conditionLabel(key) {
  return CONDITION_LABELS[key] || String(key).replace(/_/g, ' ');
}

export function pct(x) {
  if (x == null || Number.isNaN(x)) return '—';
  return `${Math.round(x * 100)}%`;
}

// Confidence -> a teal intensity step, blended from the brand primary token.
export function confColor(x) {
  const step = Math.min(5, Math.max(1, Math.ceil((x || 0) * 5)));
  const opacityByStep = { 1: 28, 2: 45, 3: 62, 4: 80, 5: 100 };
  return `color-mix(in oklch, var(--primary) ${opacityByStep[step]}%, var(--background))`;
}

// The 14 CBC fields Model A uses, with units + a reasonable numeric step.
// Order mirrors a lab report so entry feels natural.
export const CBC_FIELDS = [
  { key: 'WBC', label: 'WBC', unit: '10³/µL' },
  { key: 'RBC', label: 'RBC', unit: '10⁶/µL' },
  { key: 'HGB', label: 'HGB', unit: 'g/dL' },
  { key: 'HCT', label: 'HCT', unit: '%' },
  { key: 'MCV', label: 'MCV', unit: 'fL' },
  { key: 'MCH', label: 'MCH', unit: 'pg' },
  { key: 'MCHC', label: 'MCHC', unit: 'g/dL' },
  { key: 'PLT', label: 'PLT', unit: '10³/µL' },
  { key: 'PDW', label: 'PDW', unit: 'fL' },
  { key: 'PCT', label: 'PCT', unit: '%' },
  { key: 'LYMp', label: 'LYM%', unit: '%' },
  { key: 'NEUTp', label: 'NEUT%', unit: '%' },
  { key: 'LYMn', label: 'LYM#', unit: '10³/µL' },
  { key: 'NEUTn', label: 'NEUT#', unit: '10³/µL' },
];

// Symptom tag -> readable chip label.
export function symptomLabel(tag) {
  return String(tag).replace(/_/g, ' ');
}
