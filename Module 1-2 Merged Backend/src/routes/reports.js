// backend/src/routes/reports.js
// ---------------------------------------------------------------------------
// Doctor/Lab tier endpoints: create CBC reports (manual / OCR), run predictions,
// longitudinal history, OCR and the multilingual symptom parser. All
// RBAC-gated and audited.
//
// CBC contract: values arrive with the unit declared/printed for each one
// (or canonicalUnits: true). services/cbc.js converts them with the exported
// normalize_units table and rejects unknown fields, unsupported units and
// out-of-range values; the database CHECKs the canonical result again. The
// model uses only the 10 CBC values; sex, age, symptoms and location are
// stored as context. Audited routes place auditAction before requirePermission
// so denied (403) attempts are logged as well.
// ---------------------------------------------------------------------------
const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { auditAction } = require('../middleware/audit');
const { asyncHandler, HttpError } = require('../middleware/errors');
const LabReports = require('../models/labReports');
const Labs = require('../models/labs');
const Inference = require('../services/inferenceClient');
const { prepareCbc } = require('../services/cbc');
const { runPrediction, persistPrediction, presentPrediction } = require('../services/predictionService');
const { withTransaction } = require('../db/pool');
const ocr = require('../services/ocr');
const nlp = require('../services/nlp');
const { reportBody, predictExistingBody, symptomsBody } = require('../validators/domain');
const { contract } = require('../contract');

const router = express.Router();
const OCR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/tiff']);
const upload = multer({
  dest: path.join(os.tmpdir(), 'fedhealth-uploads'),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 }, // 8 MB, one report image
  fileFilter: (req, file, cb) => (OCR_TYPES.has(file.mimetype)
    ? cb(null, true)
    : cb(new HttpError(400, 'Upload a PNG, JPEG, WebP or TIFF image of the report (PDFs: paste the text)'))),
});

// A lab_tech's reports inherit their lab's geo; a doctor may pass
// district/province/lat/lng explicitly (for the NIH map + clustering).
async function locationFor(user, body, db) {
  if (user.lab_id) {
    const lab = await Labs.findById(user.lab_id, db);
    if (lab) {
      return { labId: lab.id, district: lab.district, province: lab.province,
               latitude: lab.latitude, longitude: lab.longitude };
    }
  }
  return {
    labId: body.labId || null,
    district: body.district || null,
    province: body.province || null,
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
  };
}

async function storeReport(user, body, prepared, db) {
  const loc = await locationFor(user, body, db);
  return LabReports.create({
    ...loc,
    createdBy: user.id,
    source: body.source || 'manual',
    patientRef: body.patientRef,
    sex: body.sex || null,
    ageYears: body.ageYears ?? null,
    cbc: prepared.canonical,
    cbcUnits: prepared.units,
    cbcReported: prepared.reported,
    symptoms: body.symptomsText ? nlp.parseSymptoms(body.symptomsText) : {},
    collectedAt: body.collectedAt || null,
  }, db);
}

// --- Create a report (no prediction) ----------------------------------------
router.post('/reports', requireAuth,
  auditAction('CREATE_REPORT', (req, res) => ({ type: 'lab_report', id: res.locals.reportId })),
  requirePermission('report:create'),
  asyncHandler(async (req, res) => {
    const body = reportBody.parse(req.body);
    const prepared = prepareCbc(body);
    const report = await storeReport(req.user, body, prepared);
    res.locals.reportId = report.id;
    res.status(201).json(report);
  }));

// --- Read one report ----------------------------------------------------------
router.get('/reports/:id', requireAuth, requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    const report = await LabReports.findById(req.params.id);
    if (!report) throw new HttpError(404, 'report not found');
    res.json(report);
  }));

// --- Longitudinal history for a pseudonymous patient (6.2.2 trends) ---------
// Array of reports (oldest first); each carries its latest `prediction` or null.
router.get('/patients/:ref/history', requireAuth,
  auditAction('VIEW_PATIENT_HISTORY', (req) => ({ type: 'patient', id: req.params.ref })),
  requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    res.json(await LabReports.listByPatientWithPredictions(req.params.ref));
  }));

// --- Predict on an existing report -----------------------------------------
router.post('/reports/:id/predict', requireAuth,
  auditAction('RUN_PREDICTION', (req) => ({ type: 'lab_report', id: req.params.id })),
  requirePermission('prediction:create'),
  asyncHandler(async (req, res) => {
    const body = predictExistingBody.parse(req.body || {});
    const report = await LabReports.findById(req.params.id);
    if (!report) throw new HttpError(404, 'report not found');
    res.json(await runPrediction({ report, modelName: body.model || contract.model_name, actor: req.user }));
  }));

// --- Combined: create a report AND predict in one call (Doctor Portal flow) --
// The inference service converts the declared units itself; the backend checks
// it converted them exactly as the exported contract does, then stores the
// report and the prediction in one transaction.
router.post('/predict', requireAuth,
  auditAction('CREATE_AND_PREDICT', (req, res) => ({ type: 'lab_report', id: res.locals.reportId })),
  requirePermission('report:create', 'prediction:create'),
  asyncHandler(async (req, res) => {
    const body = reportBody.parse(req.body);
    const prepared = prepareCbc(body);
    const inf = Inference.assertContract(
      await Inference.infer(body.model || contract.model_name, prepared.reported, prepared.units),
      prepared.canonical);
    const stored = await withTransaction(async (db) => {
      const report = await storeReport(req.user, body, prepared, db);
      return { report, ...(await persistPrediction({ report, inf, actor: req.user, db })) };
    });
    res.locals.reportId = stored.report.id;
    res.status(201).json(presentPrediction({ ...stored, inf }));
  }));

// --- OCR: report image or pasted report text -> 10 features + printed units --
// multipart field "image" (needs the tesseract engine) or "text" (JSON or form).
router.post('/ocr', requireAuth,
  auditAction('OCR_INGEST', () => ({ type: 'ocr' })),
  requirePermission('report:create'),
  upload.single('image'),
  asyncHandler(async (req, res) => {
    let text = typeof req.body?.text === 'string' ? req.body.text : null;
    let engine = 'text';
    if (req.file) {
      try {
        text = await ocr.recognize(req.file.path, req.body?.lang || undefined);
        engine = 'tesseract';
      } finally {
        fs.unlink(req.file.path, () => {}); // always clean up the temp upload
      }
    }
    if (!text || !text.trim()) {
      throw new HttpError(400, 'Upload an image (field "image") or send the report text (field "text")');
    }
    if (text.length > 20000) throw new HttpError(400, 'report text is too long');
    res.json({ ...ocr.parseCbcFromText(text), engine, text });
  }));

// --- Multilingual symptom parsing (English / Urdu / Roman-Urdu) -------------
// Context for the doctor only; symptoms are NOT model inputs.
router.post('/symptoms/parse', requireAuth,
  asyncHandler(async (req, res) => {
    const { text } = symptomsBody.parse(req.body);
    res.json({ ...nlp.parseSymptoms(text), usedByModel: false });
  }));

module.exports = router;
