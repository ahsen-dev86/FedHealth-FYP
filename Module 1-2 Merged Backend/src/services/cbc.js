// backend/src/services/cbc.js
// ---------------------------------------------------------------------------
// Validates a CBC payload against the four-class contract and converts each
// value from its declared unit to the canonical unit, with the same rules as
// fedhealth_ml.preprocess.normalize_units: every supplied value needs a unit
// (or canonicalUnits: true), units are never guessed from magnitude, and the
// converted value must lie inside schema.PLAUSIBLE_RANGES. Errors are 400s
// whose wording follows the Python service so UI, API and DB reject alike.
// ---------------------------------------------------------------------------
const { HttpError } = require('../middleware/errors');
const {
  FEATURES, CANONICAL_UNITS, RANGES, unitFactor, inRange, plausibleUnits, consistencyWarnings,
} = require('../contract');

/**
 * @param {object}  args.cbc             {FEATURE: number|null} as entered/printed
 * @param {object} [args.units]          {FEATURE: unit string} as declared/printed
 * @param {boolean}[args.canonicalUnits] true when every value is already canonical
 * @returns {{ canonical, reported, units, warnings }} canonical values (model
 *          input), the values as given, the declared unit strings, and
 *          non-blocking data-quality warnings (inconsistent red-cell indices)
 */
function prepareCbc({ cbc, units, canonicalUnits } = {}) {
  if (!cbc || typeof cbc !== 'object' || Array.isArray(cbc)) {
    throw new HttpError(400, 'cbc object is required');
  }
  const unknown = Object.keys(cbc).filter((k) => !FEATURES.includes(k));
  if (unknown.length) {
    throw new HttpError(400, `Unknown CBC field(s): ${unknown.join(', ')}; the model uses only ${FEATURES.join(', ')}`);
  }
  let declared = units;
  if (declared == null && canonicalUnits === true) declared = CANONICAL_UNITS;
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    throw new HttpError(400, 'Provide CBC values and declared units, or canonicalUnits: true');
  }
  const unknownUnits = Object.keys(declared).filter((k) => !FEATURES.includes(k));
  if (unknownUnits.length) {
    throw new HttpError(400, `Units given for unknown field(s): ${unknownUnits.join(', ')}`);
  }

  const canonical = {};
  const reported = {};
  const usedUnits = {};
  for (const feature of FEATURES) {
    const value = cbc[feature];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) continue;
    const unit = declared[feature];
    if (unit == null || !String(unit).trim()) throw new HttpError(400, `Declare the unit for ${feature}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new HttpError(400, `${feature} must be a finite number`);
    }
    const factor = unitFactor(feature, unit);
    if (factor === null) throw new HttpError(400, `Unsupported unit for ${feature}: ${unit}`);
    const converted = value * factor;
    if (!inRange(feature, converted)) {
      const [lo, hi] = RANGES[feature];
      const fits = plausibleUnits(feature, value);
      throw new HttpError(400, `${feature} outside supported range ${lo}..${hi} ${CANONICAL_UNITS[feature]} `
        + `(got ${converted} after converting from ${unit}); verify units/value`
        + (fits.length ? ` — ${value} would fit if the unit is ${fits.join(' or ')}` : ''));
    }
    canonical[feature] = converted;
    reported[feature] = value;
    usedUnits[feature] = String(unit);
  }
  if (Object.keys(canonical).length === 0) {
    throw new HttpError(400, 'At least one recognized CBC value is required');
  }
  return { canonical, reported, units: usedUnits, warnings: consistencyWarnings(canonical) };
}

module.exports = { prepareCbc };
