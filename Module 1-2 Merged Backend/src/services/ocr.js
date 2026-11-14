// backend/src/services/ocr.js
// ---------------------------------------------------------------------------
// Module 6.2.1 — reading a paper/PDF CBC report.
//   * recognize()        preprocesses an uploaded image with sharp and runs the
//                        `tesseract` binary (TESSERACT_PATH; 501 if missing)
//   * parseCbcFromText() extracts the 10 model features AND the unit string
//                        printed next to each value, e.g. WBC 9,010 "/mm3".
// Units are returned as printed (only a leading multiplication sign and
// OCR-confusable glyphs are tidied, see repairUnit); the API converts them with
// the exported normalize_units table and rejects anything it does not accept, so
// the doctor must confirm or pick a unit instead of the parser guessing one.
//
// Two report layouts are supported, and may be mixed line by line:
//   result-first   "WBC Count   9,010   4000 - 11,000   /mm3"   (IDC)
//   range-first    "Hb   13 - 18   g/dl   14.6"                 (Chughtai: the normal
//                  value and unit columns come BEFORE the result column)
// A "low - high" pair is always a reference range, never the result.
// ---------------------------------------------------------------------------
const fs = require('fs');
const { execFile } = require('child_process');
const sharp = require('sharp'); // image processing lib: used below to resize/grayscale/contrast a scan before OCR
const { HttpError } = require('../middleware/errors');
const { ocr: ocrConfig } = require('../config');
const { FEATURES, unitFactor, inRange, normalizeUnit } = require('../contract');

const TARGET_WIDTH = 3300; // ~2x a 150-dpi A4 scan; phone photos are already this wide
// Low-res web renders (~700px) need ~4.5x to reach TARGET_WIDTH; at 3x Tesseract
// misreads digits and units (Hct 44 read as 34, g/dl read as "afdi").
const MAX_UPSCALE = 5;

// Label patterns per feature. Longer/more specific labels come first so that
// "Mean corpuscular haemoglobin concentration" is MCHC, not MCH or HGB.
const FEATURE_LABELS = [
  ['MCHC', [/\bmchc\b/i, /mean\s+corpuscular\s+h(?:a)?emoglobin\s+conc(?:entration)?\.?/i]],
  ['MCH', [/\bmch\b/i, /mean\s+corpuscular\s+h(?:a)?emoglobin\b/i]],
  ['MCV', [/\bmcv\b/i, /mean\s+corpuscular\s+volume/i]],
  // "ROW-CV": Tesseract often reads the D of RDW as O; only accepted with the -CV/-SD suffix.
  ['RDW', [/\brdw(?:[\s-]*(?:cv|sd))?\b/i, /\br[o0]w[\s-]*(?:cv|sd)\b/i, /red\s+cell\s+distribution\s+width/i]],
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

// Unit strings as printed on CBC reports. Whether a match is ACCEPTED is decided by
// the contract (unitFactor), not here. The "garbled" alternatives exist only for
// glyphs Tesseract commonly confuses inside a printed unit (never for guessing a unit
// from the value): ^ read as * ° or 7; "/l" read as "/1", "/I" or "A"; the l of g/dl and
// fl read as 1/I/i; the leading "/" of /mm3 read as é or f. repairUnit() maps them back.
const VOL = '(?:[uµμ]\\s*l|c?mm\\s*\\^?\\s*3|c?mm³|cmm|cumm|l)';
const UNIT_RE = new RegExp([
  `[x×]?\\s*10\\s*[\\^*]?\\s*(?:12|3|6|9|³|⁶|⁹)\\s*\\/\\s*${VOL}`,
  // garbled x10^9/L and x10^12/L (per litre is the only denominator these powers use)
  '[x×]?\\s*10\\s*[\\^*°º˚\'7]?\\s*(?:12|9)\\s*(?:[\\/\\\\](?:[lL1I!|](?![\\d.]))?|A\\b)',
  `(?:mil(?:lion)?s?|thou(?:sand)?s?|m|k)\\s*\\/\\s*${VOL}`,
  `cells\\s*\\/\\s*${VOL}`,
  `\\/\\s*${VOL}`,
  '[éÉf]\\s*c?mm\\s*\\^?\\s*3',
  'g(?:m|ms)?\\s*\\/\\s*d\\s*[l1I|]',
  'g\\s*\\/\\s*l\\b',
  'l\\s*\\/\\s*l\\b',
  '(?<![a-z])f\\s*[lI1i]\\b',
  'pg\\b',
  '%',
].join('|'), 'i');

// A reference range ("13 - 18", "4.5-6.5", "(4000 - 11,000)"). Tokens tolerate the digit
// look-alikes Tesseract produces (S/$ for 5, O for 0) so "38 - S2" is still recognised as
// a range instead of leaving "38" behind to be mistaken for the result.
const RANGE_TOKEN = '(?=[\\dSsOo$.,]*\\d)[\\dSsOo$][\\dSsOo$.,]*';
const RANGE_RE = new RegExp(`(?<![\\w.,])${RANGE_TOKEN}\\s*(?:-|–|—|\\bto\\b)\\s*${RANGE_TOKEN}(?![\\w.,]*\\d)`, 'gi');
const RANGE_MARK = ' \u0001 '; // stands in for a removed range so the text around it keeps its order
const MASK = '\u0002'; // overwrites a located unit while the value is searched for
const UNIT_G = new RegExp(UNIT_RE.source, 'gi');
// Not preceded by $/S/s: Tesseract's misread of 5/8, where the digit after it is only half the number.
const NUMBER_RE = /(?<![\d.,$Ss])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d,])/;

/**
 * Prepare an uploaded photo/scan for Tesseract: honour EXIF rotation, grayscale,
 * stretch contrast, and upscale small images (Tesseract drops decimal points
 * when glyphs are small: 4.47 read as 447 at report-scan size, correct at 2x).
 */
async function preprocess(inputPath) {
  const image = sharp(inputPath, { failOn: 'error' }).rotate();
  const { width } = await image.metadata();
  const scale = width ? Math.min(MAX_UPSCALE, Math.max(1, TARGET_WIDTH / width)) : 1;
  const out = `${inputPath}.ocr.png`;
  await image
    .resize({ width: Math.round((width || TARGET_WIDTH) * scale), kernel: 'lanczos3' })
    .grayscale()
    .normalise()
    .png()
    .toFile(out);
  return out;
}

/** Run the tesseract OCR engine on one prepared image and resolve its raw recognized text. */
function runTesseract(imagePath, lang) {
  return new Promise((resolve, reject) => {
    // execFile with an argument list: no shell, so nothing from the request reaches a command line.
    execFile(ocrConfig.tesseractPath,
      [imagePath, 'stdout', '-l', lang, '--oem', '1', '--psm', '6', '-c', 'preserve_interword_spaces=1'],
      { timeout: ocrConfig.timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Run Tesseract on an uploaded image file and return the recognized text. */
async function recognize(imagePath, lang = ocrConfig.lang) {
  if (!/^[a-z]{3}(?:\+[a-z]{3})*$/.test(lang)) throw new HttpError(400, 'lang must be like "eng" or "eng+urd"');
  let prepared;
  try {
    prepared = await preprocess(imagePath);
  } catch (e) {
    throw new HttpError(400, `Could not read the image (${e.message}); upload a PNG, JPEG, WebP or TIFF`);
  }
  try {
    return await runTesseract(prepared, lang);
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new HttpError(501, 'Image OCR needs the tesseract engine (set TESSERACT_PATH); paste the report text instead');
    }
    throw new HttpError(422, `OCR failed: ${String(e.message).split('\n')[0]}`);
  } finally {
    fs.unlink(prepared, () => {});
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
  // Reference ranges are never the result. Taking them out first makes both column
  // orders work: "9,010 4000 - 11,000 /mm3" (result first) and "13 - 18 g/dl 14.6"
  // (range and unit first). A segment holding only a range has no result on this
  // line (it sits on another OCR line), so it yields nothing rather than the range's low end.
  text = text.replace(RANGE_RE, RANGE_MARK);
  // Locate the units, then mask them so digits inside a unit ("x10^12/L", "/mm3")
  // can't be read as the result when the unit column comes first.
  const units = [...text.matchAll(UNIT_G)].map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
  let masked = text;
  for (const u of units) masked = masked.slice(0, u.start) + MASK.repeat(u.end - u.start) + masked.slice(u.end);
  const num = masked.match(NUMBER_RE);
  if (!num) return null;
  const value = parseFloat(num[1].replace(/,/g, ''));
  const numEnd = num.index + num[0].length;
  // Unit right after the value (optionally past an H/L/* flag), else the nearest one
  // printed before it (range-first layouts), else the first one later on the segment
  // (after a reference range), else the bracketed one.
  const next = units.find((u) => u.start >= numEnd);
  const direct = next && /^s*(?:[HL*]s+)?$/.test(masked.slice(numEnd, next.start)) ? next : null;
  const earlier = direct ? null : units.filter((u) => u.end <= num.index).pop();
  const unit = (direct || earlier || next)?.text ?? bracketUnit;
  return { value, unit: unit ? repairUnit(unit.trim().replace(/s+/g, ' ')) : null };
}

/**
 * Tidy a printed unit that is otherwise unambiguous: drop the multiplication sign of
 * "x10^9/L" (the contract's spelling is 10^9/L) and undo glyph confusions Tesseract makes
 * in units. Anything else is returned untouched.
 */
function repairUnit(unit) {
  const t = unit.toLowerCase().replace(/\s+/g, '');
  const power = t.match(/^[x×]?10(?:[^\d/\\a-z]|7)?(9|12)(?:[/\\][l1i!|]?|a)$/);
  if (power) return `10^${power[1]}/L`;
  if (/^g(?:m|ms)?\/d[1i|]$/.test(t)) return `${t.slice(0, -1)}l`;
  if (/^f[1i]$/.test(t)) return 'fl';
  if (/^[éf]c?mm\^?3$/.test(t)) return `/${t.slice(1)}`;
  return unit;
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
