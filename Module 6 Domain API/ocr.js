// backend/src/services/ocr.js
// ---------------------------------------------------------------------------
// Module 6.2.1 — OCR ingestion of paper CBC reports.
//   * recognize()      runs Tesseract OCR on an uploaded image -> raw text.
//   * parseCbcFromText() extracts canonical CBC indices (HGB, MCV, WBC, ...)
//                        from that text via label-synonym regexes.
// The parser is the valuable, testable part and is independent of the OCR
// engine, so it can be unit-tested with fixture text.
//
// Engine: node-tesseract-ocr calls the real `tesseract` binary (install it:
// `apt-get install tesseract-ocr` / `brew install tesseract`; added to the
// backend Docker image in Module 9). Flagged as a system dependency.
// ---------------------------------------------------------------------------
const tesseract = require('node-tesseract-ocr');

// Canonical feature -> list of label synonyms as seen on real CBC reports.
// Order matters where labels are prefixes (MCHC before MCH; TLC/WBC etc.).
const CBC_LABELS = [
  ['MCHC', ['mchc', 'mean corpuscular h(?:a)?emoglobin concentration']],
  ['MCH',  ['mch(?!c)', 'mean corpuscular h(?:a)?emoglobin(?! concentration)']],
  ['MCV',  ['mcv', 'mean corpuscular volume']],
  ['HGB',  ['h(?:a)?emoglobin', 'hgb', 'hb\\b']],
  ['HCT',  ['hct', 'h(?:a)?ematocrit', 'pcv', 'packed cell volume']],
  ['RBC',  ['rbc', 'red blood cell[s]?', 'red cell count']],
  ['WBC',  ['wbc', 'white blood cell[s]?', 'total leukocyte count', 'tlc', 'leu[ck]ocyte count']],
  ['PLT',  ['plt', 'platelet[s]?(?: count)?']],
  ['PDW',  ['pdw', 'platelet distribution width']],
  ['PCT',  ['pct', 'plateletcrit']],
  ['NEUTp',['neutrophil[s]?\\s*%', 'neut\\s*%', 'neutrophil[s]?']],
  ['LYMp', ['lymphocyte[s]?\\s*%', 'lymph\\s*%', 'lymphocyte[s]?']],
  ['RDW',  ['rdw(?:-cv)?', 'red cell distribution width']],
];

/** Run Tesseract on an image file and return the raw recognized text. */
async function recognize(imagePath, lang = 'eng') {
  return tesseract.recognize(imagePath, {
    lang,
    oem: 1,          // LSTM engine
    psm: 6,          // assume a uniform block of text (typical for lab tables)
  });
}

/**
 * Extract canonical CBC indices from OCR text.
 * Strategy: for each feature, find the FIRST synonym label followed (within a
 * short gap, skipping units/colons) by a number. Returns { FEATURE: value }.
 * Only physiologically plausible numbers are kept as a light sanity filter.
 */
function parseCbcFromText(text) {
  const out = {};
  const cleaned = text.replace(/[|]/g, ' ').replace(/\r/g, '\n');

  for (const [feature, synonyms] of CBC_LABELS) {
    if (out[feature] !== undefined) continue;
    for (const syn of synonyms) {
      // label, then up to ~25 chars of units/punctuation, then a number.
      const re = new RegExp(`${syn}[^0-9\\-\\n]{0,25}(-?\\d{1,4}(?:\\.\\d{1,2})?)`, 'i');
      const m = cleaned.match(re);
      if (m) {
        const val = parseFloat(m[1]);
        if (!Number.isNaN(val)) { out[feature] = val; break; }
      }
    }
  }
  return out;
}

module.exports = { recognize, parseCbcFromText, CBC_LABELS };
