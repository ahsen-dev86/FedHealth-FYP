// frontend/src/lib/format.js
// Presentation helpers shared across the portal. Class names, feature order and
// units come from the generated contract (lib/contract.js); nothing here may
// introduce a class or CBC field the model does not have.
import {
  CLASS_LABELS, CLASS_COLORS, FEATURES, FEATURE_LABELS, CANONICAL_UNITS, UNIT_OPTIONS, RANGES,
} from './contract.js';

// Model class keys -> human labels (healthy, anemia, thalassemia, leukemia).
export const CONDITION_LABELS = CLASS_LABELS;

export function conditionLabel(key) {
  if (key == null) return '—';
  return CLASS_LABELS[key] || String(key).replace(/_/g, ' ');
}

export function conditionColor(key) {
  return CLASS_COLORS[key] || 'var(--muted-foreground)';
}

export function pct(x) {
  if (x == null || Number.isNaN(x)) return '—';
  return `${Math.round(x * 100)}%`;
}

export function pct1(x) {
  if (x == null || Number.isNaN(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

// Confidence -> a teal intensity step, blended from the brand primary token.
export function confColor(x) {
  const step = Math.min(5, Math.max(1, Math.ceil((x || 0) * 5)));
  const opacityByStep = { 1: 28, 2: 45, 3: 62, 4: 80, 5: 100 };
  return `color-mix(in oklch, var(--primary) ${opacityByStep[step]}%, var(--background))`;
}

const SHORT_LABELS = {
  WBC: 'WBC', RBC: 'RBC', HGB: 'HGB', HCT: 'HCT', MCV: 'MCV',
  MCH: 'MCH', MCHC: 'MCHC', RDW: 'RDW-CV', PLT: 'PLT', NEUTp: 'NEUT%',
};

// The 10 CBC values the model uses, in model order, with the canonical unit
// (as stored and charted), the unit choices the form offers and the plausible range.
export const CBC_FIELDS = FEATURES.map((key) => ({
  key,
  label: SHORT_LABELS[key],
  name: FEATURE_LABELS[key],
  canonicalUnit: CANONICAL_UNITS[key],
  unit: UNIT_OPTIONS[key][0].label,
  unitOptions: UNIT_OPTIONS[key],
  range: RANGES[key],
}));

// Symptom tag -> readable chip label.
export function symptomLabel(tag) {
  return String(tag).replace(/_/g, ' ');
}
