// backend/src/routes/reports.js
// ---------------------------------------------------------------------------
// Doctor/Lab tier endpoints: create CBC reports (manual / OCR), run predictions,
// longitudinal history, and the multilingual symptom parser. All RBAC-gated and
// audited. The CBC model is CBC-only; parsed symptoms are stored as context.
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
const { runPrediction } = require('../services/predictionService');
const ocr = require('../services/ocr');
const nlp = require('../services/nlp');

const router = express.Router();
const upload = multer({
  dest: path.join(os.tmpdir(), 'fedhealth-uploads'),
  limits: { fileSize: 8 * 1024 * 1024 },  // 8 MB
});

// Derive report location: a lab_tech's reports inherit their lab's geo; a doctor
// may pass district/province/lat/lng explicitly (for the NIH map + clustering).
async function locationFor(user, body) {
  if (user.lab_id) {
    const lab = await Labs.findById(user.lab_id);
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

async function buildReport(user, body, source) {
  if (!body.patientRef) throw new HttpError(400, 'patientRef is required');
  if (!body.cbc || typeof body.cbc !== 'object') throw new HttpError(400, 'cbc object is required');
  const loc = await locationFor(user, body);
  const symptoms = body.symptomsText ? nlp.parseSymptoms(body.symptomsText) : {};
  return LabReports.create({
    ...loc,
    createdBy: user.id,
    source: source || body.source || 'manual',
    patientRef: body.patientRef,
    sex: body.sex || null,
    ageYears: body.ageYears ?? null,
    cbc: body.cbc,
    collectedAt: body.collectedAt || null,
    symptoms,
  });
}

// --- Create a report --------------------------------------------------------
router.post('/reports', requireAuth, requirePermission('report:create'),
  auditAction('CREATE_REPORT', () => ({ type: 'lab_report' })),
  asyncHandler(async (req, res) => {
    const report = await buildReport(req.user, req.body);
    res.status(201).json(report);
  }));

// --- Read one report --------------------------------------------------------
router.get('/reports/:id', requireAuth, requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    const report = await LabReports.findById(req.params.id);
    if (!report) throw new HttpError(404, 'report not found');
    res.json(report);
  }));

// --- Longitudinal history for a pseudonymous patient (6.2.2 trends) ---------
router.get('/patients/:ref/history', requireAuth, requirePermission('report:read'),
  auditAction('VIEW_PATIENT_HISTORY', (req) => ({ type: 'patient', id: req.params.ref })),
  asyncHandler(async (req, res) => {
    const reports = await LabReports.listByPatient(req.params.ref);
    res.json(reports);
  }));

// --- Predict on an existing report -----------------------------------------
router.post('/reports/:id/predict', requireAuth, requirePermission('prediction:create'),
  auditAction('RUN_PREDICTION', (req) => ({ type: 'lab_report', id: req.params.id })),
  asyncHandler(async (req, res) => {
    const report = await LabReports.findById(req.params.id);
    if (!report) throw new HttpError(404, 'report not found');
    const result = await runPrediction({
      report, modelName: req.body.model || 'cbc_multiclass', actor: req.user });
    res.json(result);
  }));

// --- Combined: create a report AND predict in one call (Doctor Portal flow) --
router.post('/predict', requireAuth,
  requirePermission('report:create', 'prediction:create'),
  auditAction('CREATE_AND_PREDICT', () => ({ type: 'lab_report' })),
  asyncHandler(async (req, res) => {
    const report = await buildReport(req.user, req.body);
    const result = await runPrediction({
      report, modelName: req.body.model || 'cbc_multiclass', actor: req.user });
    res.status(201).json({ report, ...result });
  }));

// --- OCR: image of a paper CBC report -> extracted CBC values ---------------
router.post('/ocr', requireAuth, requirePermission('report:create'),
  upload.single('image'),
  auditAction('OCR_INGEST', () => ({ type: 'ocr' })),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'image file (field "image") is required');
    try {
      const text = await ocr.recognize(req.file.path, req.body.lang || 'eng');
      const cbc = ocr.parseCbcFromText(text);
      res.json({ cbc, extractedCount: Object.keys(cbc).length, text });
    } finally {
      fs.unlink(req.file.path, () => {});  // always clean up the temp upload
    }
  }));

// --- Multilingual symptom parsing (English / Urdu / Roman-Urdu) -------------
router.post('/symptoms/parse', requireAuth,
  asyncHandler(async (req, res) => {
    const { text } = req.body;
    if (!text) throw new HttpError(400, 'text is required');
    res.json(nlp.parseSymptoms(text));
  }));

module.exports = router;
