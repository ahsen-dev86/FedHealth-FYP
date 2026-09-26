// frontend/src/lib/contract.js
// The four-class CBC contract for the UI. cbcContract.json is GENERATED from
// Module 3 ML/schema.py and fedhealth_ml.preprocess by tools/export_contract.py
// (never edit it by hand); the backend loads an identical copy. Validation here
// follows the same rules and wording as the API (services/cbc.js) and the
// Python normalize_units, so the form rejects what the API and DB reject.
// tests/test_integration_contract.py and frontend/tests/contract.test.mjs
// cross-check all three.
import contract from './cbcContract.json' with { type: 'json' };

export { contract };
export const MODEL_NAME = contract.model_name;
export const FEATURES = contract.features;
export const CLASSES = contract.classes;
export const CLASS_LABELS = contract.class_labels;
export const FEATURE_LABELS = contract.feature_labels;
export const CANONICAL_UNITS = contract.canonical_units;
export const RANGES = contract.plausible_ranges;
export const UNIT_OPTIONS = contract.unit_options;
export const NOT_MODEL_INPUTS = contract.not_model_inputs;

// One colour per class, from the theme's chart tokens (charts, bars, badges).
export const CLASS_COLORS = {
  healthy: 'var(--chart-2)',
  anemia: 'var(--chart-3)',
  thalassemia: 'var(--chart-5)',
  leukemia: 'var(--chart-4)',
};
// Leaflet paths cannot read CSS variables; same hues as the light theme tokens.
export const CLASS_HEX = {
  healthy: '#2f8a62',
  anemia: '#b07a1f',
  thalassemia: '#1f5d62',
  leukemia: '#b4453c',
};

/** Same normalization as fedhealth_ml.preprocess._unit and the backend. */
export function normalizeUnit(value) {
  const text = String(value).trim()
    .replace(/[µμ]/g, 'u').replace(/³/g, '^3').replace(/⁶/g, '^6')
    .replace(/ /g, '')
    .toLowerCase();
  return text.replace(/mm3/g, 'mm^3');
}

/** Factor to the canonical unit, or null when normalize_units would reject the unit. */
export function unitFactor(feature, unit) {
  if (unit == null || String(unit).trim() === '') return null;
  const factor = contract.accepted_units[feature]?.[normalizeUnit(unit)];
  return factor === undefined ? null : factor;
}

/** The form's unit option equivalent to `unit` (same factor), or null. */
export function unitOptionFor(feature, unit) {
  const factor = unitFactor(feature, unit);
  if (factor === null) return null;
  return UNIT_OPTIONS[feature].find((o) => unitFactor(feature, o.value) === factor) || null;
}

/** Parse a typed value: "147,000" (thousands) -> 147000; blank -> null; junk -> NaN. */
export function parseValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  const text = String(raw).trim();
  if (text === '') return null;
  const plain = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) ? text.replace(/,/g, '') : text;
  return /^-?\d+(\.\d+)?$/.test(plain) ? Number(plain) : NaN;
}

/**
 * Validate the CBC form.
 * @param values  {FEATURE: string|number} as typed (blank = not measured)
 * @param units   {FEATURE: unit string} as chosen or printed
 * @returns { values, units, canonical, errors }: numbers to send, units to send,
 *          converted canonical values, and per-feature error messages.
 */
export function validateCbc(values = {}, units = {}) {
  const out = { values: {}, units: {}, canonical: {}, errors: {} };
  for (const feature of FEATURES) {
    const value = parseValue(values[feature]);
    if (value === null) continue;
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      out.errors[feature] = `${feature} must be a number`;
      continue;
    }
    const unit = units[feature];
    if (unit == null || String(unit).trim() === '') {
      out.errors[feature] = `Declare the unit for ${feature}`;
      continue;
    }
    const factor = unitFactor(feature, unit);
    if (factor === null) {
      out.errors[feature] = `Unsupported unit for ${feature}: ${unit}`;
      continue;
    }
    const converted = value * factor;
    const [lo, hi] = RANGES[feature];
    if (!(converted >= lo && converted <= hi)) {
      out.errors[feature] = `${feature} outside supported range ${lo}..${hi} ${CANONICAL_UNITS[feature]} `
        + `(got ${converted} after converting from ${unit}); verify units/value`;
      continue;
    }
    out.values[feature] = value;
    out.units[feature] = String(unit);
    out.canonical[feature] = converted;
  }
  return out;
}
