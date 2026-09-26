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

function inRange(feature, value) {
  const [lo, hi] = RANGES[feature];
  return Number.isFinite(value) && value >= lo && value <= hi;
}

function classLabel(key) {
  return contract.class_labels[key] || key;
}

module.exports = {
  contract, FEATURES, CLASSES, CANONICAL_UNITS, RANGES, ACCEPTED_UNITS,
  normalizeUnit, unitFactor, inRange, classLabel,
};
