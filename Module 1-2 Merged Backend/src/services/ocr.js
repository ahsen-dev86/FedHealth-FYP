// backend/src/services/ocr.js
// ---------------------------------------------------------------------------
// Module 6.2.1 — reading a paper/PDF CBC report.
//   * recognize()        runs Tesseract on an uploaded image (optional engine:
//                        the node-tesseract-ocr package plus the `tesseract`
//                        binary; without them image OCR answers 501)
//   * parseCbcFromText() extracts the 10 model features AND the unit string
//                        printed next to each value, e.g. WBC 9,010 "/mm3".
// Units are returned exactly as printed; the API converts them with the
// exported normalize_units table and rejects anything it does not accept, so
// the doctor must confirm or pick a unit instead of the parser guessing one.
// ---------------------------------------------------------------------------
const { HttpError } = require('../middleware/errors');
const { FEATURES, unitFactor, inRange, normalizeUnit } = require('../contract');

// Label patterns per feature. Longer/more specific labels come first so that
// "Mean corpuscular haemoglobin concentration" is MCHC, not MCH or HGB.
const FEATURE_LABELS = [
  ['MCHC', [/\bmchc\b/i, /mean\s+corpuscular\s+h(?:a)?emoglobin\s+conc(?:entration)?\.?/i]],
  ['MCH', [/\bmch\b/i, /mean\s+corpuscular\s+h(?:a)?emoglobin\b/i]],
  ['MCV', [/\bmcv\b/i, /mean\s+corpuscular\s+volume/i]],
  ['RDW', [/\brdw(?:[\s-]*(?:cv|sd))?\b/i, /red\s+cell\s+distribution\s+width/i]],
  ['HCT', [/\bhct\b/i, /\bh(?:a)?ematocrit\b/i, /\bpcv\b/i, /packed\s+cell\s+volume/i]],
  ['HGB', [/\bh(?:a)?emoglobin\b/i, /\bhgb\b/i, /\bhb\b/i]],
  ['RBC', [/\btotal\s+rbc(?:\s+count)?\b/i, /\br\.?b\.?c\.?(?:\s+count)?\b/i, /red\s+blood\s+cells?(?:\s+count)?/i, /red\s+cell\s+count/i]],
  ['WBC', [/total\s+leu[ck]ocyte\s+count/i, /\btlc\b/i, /\bw\.?b\.?c\.?(?:\s+count)?\b/i, /white\s+blood\s+cells?(?:\s+count)?/i, /\bleu[ck]ocytes?\b/i]],
  ['PLT', [/\bplatelets?(?:\s+count)?\b/i, /\bplt\b/i]],
  ['NEUTp', [/\bneutrophils?\b/i, /\bneut\b\.?/i, /\bpolymorphs?\b/i]],
];

// Lines that mention a feature's label but report something else.
const LINE_EXCLUSIONS = {
  PLT: /mean\s+platelet|platelet\s+distribution|plateletcrit|\bmpv\b|\bpdw\b|\bpct\b/i,
  RBC: /nucleated|\bnrbc\b/i,
};

// Unit strings as printed on CBC reports. Anything matched is returned verbatim;
// whether it is ACCEPTED is decided by the contract (unitFactor), not here.
const VOL = '(?:[uµμ]\\s*l|c?mm\\s*\\^?\\s*3|c?mm³|cmm|cumm|l)';
const UNIT_RE = new RegExp([
  `x?\\s*10\\s*[\\^*]?\\s*(?:12|3|6|9|³|⁶|⁹)\\s*\\/\\s*${VOL}`,
  `(?:mil(?:lion)?s?|thou(?:sand)?s?|m|k)\\s*\\/\\s*${VOL}`,
  `cells\\s*\\/\\s*${VOL}`,
  `\\/\\s*${VOL}`,
  'g(?:m|ms)?\\s*\\/\\s*dl',
  'g\\s*\\/\\s*l\\b',
  'l\\s*\\/\\s*l\\b',
  'f\\s*l\\b',
  'pg\\b',
  '%',
].join('|'), 'i');
const NUMBER_RE = /(?<![\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d,])/;

async function recognize(imagePath, lang = 'eng') {
  let tesseract;
  try {
    // eslint-disable-next-line global-require
    tesseract = require('node-tesseract-ocr');
  } catch {
    throw new HttpError(501, 'Image OCR needs the node-tesseract-ocr package and the tesseract engine; '
      + 'paste the report text instead (field "text")');
  }
  try {
    return await tesseract.recognize(imagePath, { lang, oem: 1, psm: 6 });
  } catch (e) {
    throw new HttpError(501, `Image OCR failed (is the tesseract binary installed?): ${e.message}`);
  }
}

/** All non-overlapping label matches in one line, leftmost first. */
function labelMatches(line) {
  const found = [];
  FEATURE_LABELS.forEach(([feature, patterns], order) => {
    if (LINE_EXCLUSIONS[feature]?.test(line)) return;
    for (const re of patterns) {
      const g = new RegExp(re.source, 'gi');
      let m;
      while ((m = g.exec(line)) !== null) {
        found.push({ feature, start: m.index, end: m.index + m[0].length, order });
      }
    }
  });
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || a.order - b.order);
  const kept = [];
  for (const f of found) {
    if (!kept.length || f.start >= kept[kept.length - 1].end) kept.push(f);
  }
  return kept;
}

/** Value and printed unit in the text that follows one label. */
function readSegment(segment) {
  let text = segment;
  let bracketUnit = null;
  // "WBC (x10^3/uL) 9.01": a unit printed in brackets before the value.
  const bracket = text.match(/^[\s:=.-]*[([]([^)\]]{1,24})[)\]]/);
  if (bracket) {
    const u = bracket[1].match(UNIT_RE);
    if (u && u[0].trim().length === bracket[1].trim().length) bracketUnit = u[0].trim();
    text = text.slice(bracket[0].length);
  }
  const num = text.match(NUMBER_RE);
  if (!num) return null;
  const value = parseFloat(num[1].replace(/,/g, ''));
  const after = text.slice(num.index + num[0].length);
  // Unit right after the value (optionally past an H/L/* flag), else anywhere
  // later on the segment (after a reference range), else the bracketed one.
  const direct = after.match(new RegExp(`^\\s*(?:[HL*]\\s+)?(${UNIT_RE.source})`, 'i'));
  const later = direct ? null : after.match(UNIT_RE);
  const unit = direct ? direct[1] : later ? later[0] : bracketUnit;
  return { value, unit: unit ? unit.trim().replace(/\s+/g, ' ') : null };
}

/**
 * Extract the model's 10 CBC features and their printed units from report text.
 * When a feature appears more than once (RDW-SD and RDW-CV, absolute and %
 * neutrophils) the first reading whose unit the contract accepts wins.
 */
function parseCbcFromText(text) {
  const candidates = Object.fromEntries(FEATURES.map((f) => [f, []]));
  const lines = String(text || '').replace(/\r/g, '\n').replace(/[|\t]/g, ' ').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const labels = labelMatches(line);
    labels.forEach((label, i) => {
      const segment = line.slice(label.end, i + 1 < labels.length ? labels[i + 1].start : line.length);
      const reading = readSegment(segment);
      if (reading) candidates[label.feature].push({ ...reading, line });
    });
  }

  const cbc = {};
  const units = {};
  const unitStatus = {};
  const canonical = {};
  const outOfRange = [];
  for (const feature of FEATURES) {
    const list = candidates[feature];
    if (!list.length) { unitStatus[feature] = 'missing'; continue; }
    const pick = list.find((c) => unitFactor(feature, c.unit) !== null) || list[0];
    cbc[feature] = pick.value;
    units[feature] = pick.unit;
    const factor = unitFactor(feature, pick.unit);
    if (pick.unit == null) unitStatus[feature] = 'no_unit_printed';
    else if (factor === null) unitStatus[feature] = 'unsupported';
    else {
      unitStatus[feature] = 'accepted';
      const value = pick.value * factor;
      if (inRange(feature, value)) canonical[feature] = value;
      else outOfRange.push(feature);
    }
  }
  const missing = FEATURES.filter((f) => !(f in cbc));
  return {
    cbc, units, unitStatus, canonical, outOfRange, missing,
    extractedCount: Object.keys(cbc).length,
  };
}

module.exports = { recognize, parseCbcFromText, normalizeUnit, FEATURE_LABELS };
