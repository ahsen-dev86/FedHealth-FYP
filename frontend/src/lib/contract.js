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

/** The form's unit option for `unit`: the same spelling if offered, else an equivalent (same factor), else null. */
export function unitOptionFor(feature, unit) {
  const factor = unitFactor(feature, unit);
  if (factor === null) return null;
  const options = UNIT_OPTIONS[feature];
  return options.find((o) => normalizeUnit(o.value) === normalizeUnit(unit))
    || options.find((o) => unitFactor(feature, o.value) === factor) || null;
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
      const fits = plausibleUnits(feature, value);
      out.errors[feature] = `${feature} outside supported range ${lo}..${hi} ${CANONICAL_UNITS[feature]} `
        + `(got ${converted} after converting from ${unit}); verify units/value`
        + (fits.length ? ` — ${value} would fit if the unit is ${fits.join(' or ')}` : '');
      continue;
    }
    out.values[feature] = value;
    out.units[feature] = String(unit);
    out.canonical[feature] = converted;
  }
  out.warnings = consistencyWarnings(out.canonical);
  return out;
}

// True when `value` falls inside the feature's plausible canonical range.
function inRange(feature, value) {
  const [lo, hi] = RANGES[feature];
  return Number.isFinite(value) && value >= lo && value <= hi;
}

/** Unit options under which a value would be plausible: a hint only, never applied automatically. */
export function plausibleUnits(feature, value) {
  return (UNIT_OPTIONS[feature] || [])
    .filter((o) => inRange(feature, value * unitFactor(feature, o.value)))
    .map((o) => o.label);
}

// Same check as the backend (src/contract/index.js): red-cell indices derived
// from HGB, HCT and RBC must roughly match the reported ones, else a typo is likely.
export const INDEX_TOLERANCE = 0.2;
const INDEX_CHECKS = [
  ['MCHC', 'HGB / HCT x 100', (c) => (c.HCT ? (c.HGB / c.HCT) * 100 : null), ['HGB', 'HCT']],
  ['MCV', 'HCT / RBC x 10', (c) => (c.RBC ? (c.HCT / c.RBC) * 10 : null), ['HCT', 'RBC']],
  ['MCH', 'HGB / RBC x 10', (c) => (c.RBC ? (c.HGB / c.RBC) * 10 : null), ['HGB', 'RBC']],
];

/** Non-blocking data-quality warnings for canonical values (identical wording to the API). */
export function consistencyWarnings(canonical) {
  const warnings = [];
  for (const [index, formula, derive, inputs] of INDEX_CHECKS) {
    const reported = canonical[index];
    if (reported == null || inputs.some((f) => canonical[f] == null)) continue;
    const derived = derive(canonical);
    if (derived == null || !Number.isFinite(derived)) continue;
    if (Math.abs(reported - derived) / reported > INDEX_TOLERANCE) {
      warnings.push(`${index} is ${reported} but ${formula} gives ${+derived.toFixed(1)}; check ${[index, ...inputs].join(', ')} for a typo or wrong unit`);
    }
  }
  return warnings;
}

// Patient reference: a pseudonymous token, never a direct identifier (same rules as the API).
// Allows letters/digits/._:- , up to 128 chars, must start with a letter or digit.
const PATIENT_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
// Heuristics that catch a real identifier typed in by mistake, so the form can
// warn instead of silently accepting a de-anonymizing value as the "pseudonym".
const LOOKS_LIKE_IDENTIFIER = [
  [/^\d{5}-?\d{7}-?\d$/, 'a CNIC number'], // Pakistani CNIC: 5-7-1 digits, optional dashes
  [/^(\+?92|0)3\d{2}-?\d{7}$/, 'a phone number'], // Pakistani mobile number
  [/^\d{10,}$/, 'a long ID/phone number'],
];

/** Error message for a patient reference, or '' when it is acceptable. */
export function patientRefError(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'Enter the pseudonymous patient reference';
  if (s.length > 128) return 'Patient reference is too long (max 128 characters)';
  if (s.includes('@')) return 'Use the pseudonymous patient reference, not an email address';
  for (const [re, what] of LOOKS_LIKE_IDENTIFIER) {
    if (re.test(s)) return `This looks like ${what}; use the pseudonymous patient reference instead`;
  }
  if (!PATIENT_REF.test(s)) return 'Patient reference may contain only letters, digits and . _ : -';
  return '';
}

/** Error message for an age entry ('' = blank or valid). */
export function ageError(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (!/^\d+$/.test(s)) return 'Age must be a whole number of years';
  if (Number(s) > 130) return 'Age must be 130 or less';
  return '';
}
