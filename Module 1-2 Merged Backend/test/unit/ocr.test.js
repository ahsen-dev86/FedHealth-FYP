// Unit tests: OCR text parser returns the 10 features plus printed units.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCbcFromText } = require('../../src/services/ocr');
const { FEATURES } = require('../../src/contract');

const SIMPLE = `WBC 9,010 /mm3
RBC 4.47 mil/mm3
HGB 12.4 g/dL
HCT 38 %
MCV 85 fl
MCH 28 pg
MCHC 33 g/dL
RDW-CV 13 %
PLT 147,000 /mm3
Neutrophils 69 %`;

test('simple report: all 10 features with their printed units', () => {
  const r = parseCbcFromText(SIMPLE);
  assert.deepEqual(Object.keys(r.cbc), FEATURES);
  assert.deepEqual(r.cbc, { WBC: 9010, RBC: 4.47, HGB: 12.4, HCT: 38, MCV: 85, MCH: 28, MCHC: 33, RDW: 13, PLT: 147000, NEUTp: 69 });
  assert.deepEqual(r.units, { WBC: '/mm3', RBC: 'mil/mm3', HGB: 'g/dL', HCT: '%', MCV: 'fl', MCH: 'pg', MCHC: 'g/dL', RDW: '%', PLT: '/mm3', NEUTp: '%' });
  assert.ok(FEATURES.every((f) => r.unitStatus[f] === 'accepted'));
  assert.equal(r.canonical.WBC, 9.01);
  assert.equal(r.canonical.PLT, 147);
  assert.deepEqual(r.missing, []);
});

test('lab layout: long labels, flags, reference ranges, bracketed units', () => {
  const r = parseCbcFromText(`Total Leucocyte Count (TLC)   9,010   /mm3   4,000 - 11,000
Haemoglobin   12.4  L  g/dL   13.0 - 17.0
Mean Corpuscular Haemoglobin Concentration   33   g/dL
Mean corpuscular haemoglobin   28 pg
Packed cell volume  0.38  L/L
Platelet Count   147,000  L  /mm3   150,000 - 400,000
WBC (x10^3/uL): 9.01`);
  assert.equal(r.cbc.WBC, 9010); // first reading with an accepted unit wins
  assert.equal(r.units.WBC, '/mm3');
  assert.equal(r.cbc.HGB, 12.4);
  assert.equal(r.units.HGB, 'g/dL');
  assert.equal(r.cbc.MCHC, 33);
  assert.equal(r.cbc.MCH, 28);
  assert.equal(r.units.HCT, 'L/L');
  assert.equal(r.canonical.HCT, 38);
  assert.equal(r.cbc.PLT, 147000);
});

test('bracketed unit before the value is used when nothing follows', () => {
  const r = parseCbcFromText('WBC (x10^3/uL): 9.01');
  assert.equal(r.cbc.WBC, 9.01);
  assert.equal(r.units.WBC, 'x10^3/uL');
  assert.equal(r.unitStatus.WBC, 'accepted');
});

test('two features on one line are split at the second label', () => {
  const r = parseCbcFromText('MCV 85 fl    MCH 28 pg    MCHC 33 g/dL');
  assert.deepEqual([r.cbc.MCV, r.cbc.MCH, r.cbc.MCHC], [85, 28, 33]);
  assert.deepEqual([r.units.MCV, r.units.MCH, r.units.MCHC], ['fl', 'pg', 'g/dL']);
});

test('RDW-CV (%) preferred over RDW-SD (fL); percent neutrophils over absolute', () => {
  const r = parseCbcFromText(`RDW-SD 42 fL
RDW-CV 13 %
Neutrophils 6.2 10^3/uL
Neutrophils 69 %`);
  assert.equal(r.cbc.RDW, 13);
  assert.equal(r.cbc.NEUTp, 69);
});

test('MPV/PDW lines are not read as platelet count', () => {
  const r = parseCbcFromText(`Mean Platelet Volume 10.2 fL
Platelet distribution width 16 %
Platelets 250 x10^3/uL`);
  assert.equal(r.cbc.PLT, 250);
  assert.equal(r.units.PLT, 'x10^3/uL');
});

test('unsupported or missing units are reported, not guessed', () => {
  const r = parseCbcFromText(`TLC 9010 /cmm
Hb 12.4`);
  assert.equal(r.units.WBC, '/cmm');
  assert.equal(r.unitStatus.WBC, 'unsupported');
  assert.equal(r.units.HGB, null);
  assert.equal(r.unitStatus.HGB, 'no_unit_printed');
  assert.ok(!('WBC' in r.canonical) && !('HGB' in r.canonical));
  assert.deepEqual(r.missing, ['RBC', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW', 'PLT', 'NEUTp']);
});

test('common OCR misread "ROW-CV" is read as RDW; a bare word "row" is not', () => {
  assert.equal(parseCbcFromText('ROW-CV 13 %').cbc.RDW, 13);
  assert.equal(parseCbcFromText('row 5 of 12 %').extractedCount, 0);
});

test('image OCR on the rendered example report (tesseract installed)', async (t) => {
  const { ocr: cfg } = require('../../src/config');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  if (cfg.tesseractPath !== 'tesseract' && !fs.existsSync(cfg.tesseractPath)) return t.skip('tesseract not installed');
  const { recognize } = require('../../src/services/ocr');
  const copy = path.join(os.tmpdir(), `fedhealth-ocr-test-${process.pid}.png`);
  fs.copyFileSync(path.join(__dirname, '../fixtures/cbc_report.png'), copy);
  try {
    const r = parseCbcFromText(await recognize(copy));
    assert.deepEqual(r.cbc, { WBC: 9010, RBC: 4.47, HGB: 12.4, HCT: 38, MCV: 85, MCH: 28, MCHC: 33, RDW: 13, PLT: 147000, NEUTp: 69 });
    assert.ok(FEATURES.every((f) => r.unitStatus[f] === 'accepted'));
  } finally {
    fs.unlinkSync(copy);
  }
});

test('HbA2 and lymphocytes are not model features', () => {
  const r = parseCbcFromText(`HbA2 3.1 %
Lymphocytes 25 %`);
  assert.equal(r.extractedCount, 0);
});
