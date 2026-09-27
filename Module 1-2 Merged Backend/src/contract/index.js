// backend/src/contract/index.js
// ---------------------------------------------------------------------------
// The four-class CBC contract, loaded from cbcContract.json. That file is
// GENERATED from Module 3 ML/schema.py and fedhealth_ml.preprocess by
// `python tools/export_contract.py`; never edit it by hand. Unit conversion
// here reproduces normalize_units exactly (same aliases, same factors, same
// string normalization) and tests/test_integration_contract.py proves it.
// ---------------------------------------------------------------------------
const contract = require('./cbcContract.json');

const FEATURES = contract.features;
const CLASSES = contract.classes;
const CANONICAL_UNITS = contract.canonical_units;
const RANGES = contract.plausible_ranges;
const ACCEPTED_UNITS = contract.accepted_units;
const UNIT_OPTIONS = contract.unit_options;

/** Same normalization as fedhealth_ml.preprocess._unit. */
function normalizeUnit(value) {
  const text = String(value).trim()
    .replace(/[µμ]/g, 'u').replace(/³/g, '^3').replace(/⁶/g, '^6')
    .replace(/ /g, '')
    .toLowerCase();
  return text.replace(/mm3/g, 'mm^3');
}

/** Conversion factor to the canonical unit, or null when the unit is not accepted. */
function unitFactor(feature, unit) {
  if (unit == null) return null;
  const factor = ACCEPTED_UNITS[feature]?.[normalizeUnit(unit)];
  return factor === undefined ? null : factor;
}

/** Whether a (already-canonical-unit) value falls within the contract's plausible range for the feature. */
function inRange(feature, value) {
  const [lo, hi] = RANGES[feature];
  return Number.isFinite(value) && value >= lo && value <= hi;
}

/**
 * Unit options under which a value would be plausible — a hint for an error
 * message, never applied automatically (units are not guessed from magnitude).
 */
function plausibleUnits(feature, value) {
  return (UNIT_OPTIONS[feature] || [])
    .filter((o) => inRange(feature, value * unitFactor(feature, o.value)))
    .map((o) => o.label);
}

// Red-cell indices are derived from HGB, HCT and RBC, so a typo in one field
// usually breaks the arithmetic. Reported vs derived beyond this relative gap
// is flagged as a data-quality warning (the model still runs; the doctor checks).
const INDEX_TOLERANCE = 0.2;
const INDEX_CHECKS = [
  ['MCHC', 'HGB / HCT x 100', (c) => (c.HCT ? (c.HGB / c.HCT) * 100 : null), ['HGB', 'HCT']],
  ['MCV', 'HCT / RBC x 10', (c) => (c.RBC ? (c.HCT / c.RBC) * 10 : null), ['HCT', 'RBC']],
  ['MCH', 'HGB / RBC x 10', (c) => (c.RBC ? (c.HGB / c.RBC) * 10 : null), ['HGB', 'RBC']],
];

/** Data-quality warnings for canonical CBC values (empty when consistent or incomplete). */
function consistencyWarnings(canonical) {
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

/** Human-readable label for a class key, falling back to the raw key if unmapped. */
function classLabel(key) {
  return contract.class_labels[key] || key;
}

module.exports = {
  contract, FEATURES, CLASSES, CANONICAL_UNITS, RANGES, ACCEPTED_UNITS, UNIT_OPTIONS,
  normalizeUnit, unitFactor, inRange, classLabel, plausibleUnits, consistencyWarnings, INDEX_TOLERANCE,
};
