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
const multer = require('multer'); // middleware that parses multipart/form-data uploads (the report image)
const os = require('os');
const path = require('path');
const fs = require('fs');

const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { auditAction } = require('../middleware/audit');
const { asyncHandler, HttpError, uuidParam } = require('../middleware/errors');
const LabReports = require('../models/labReports');
const Labs = require('../models/labs');
const Inference = require('../services/inferenceClient');
const { prepareCbc } = require('../services/cbc');
const { runPrediction, persistPrediction, presentPrediction } = require('../services/predictionService');
const { withTransaction } = require('../db/pool');
const ocr = require('../services/ocr');
const nlp = require('../services/nlp');
const { reportBody, predictExistingBody, symptomsBody, patientRefLookup } = require('../validators/domain');
const { contract, CLASSES } = require('../contract');
const PatientRef = require('../contract/patientRef');
const guidance = require('../services/guidance');
const speech = require('../services/speechClient');
const { query } = require('../db/pool');

const router = express.Router();
router.param('id', uuidParam);
router.param('ref', (req, res, next, value) => {
  // Tidy a typed FH ID (case, dashes); references stored before the FH format still resolve.
  const r = patientRefLookup.safeParse(PatientRef.normalize(value));
  if (!r.success) return next(new HttpError(400, r.error.issues[0].message));
  req.params.ref = r.data;
  return next();
});
// Dictation clips are small (opus); kept in memory and forwarded, never written to disk here.
const AUDIO_TYPES = /^(audio\/(webm|ogg|mp4|mpeg|wav|x-wav|x-m4a|aac)|video\/webm)/;
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (AUDIO_TYPES.test(file.mimetype)
    ? cb(null, true)
    : cb(new HttpError(400, 'Send an audio recording (webm, ogg, mp4, wav)'))),
});
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
    res.status(201).json({ ...report, data_quality_warnings: prepared.warnings });
  }));

// --- Read one report ----------------------------------------------------------
router.get('/reports/:id', requireAuth, requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    const report = await LabReports.findById(req.params.id);
    if (!report) throw new HttpError(404, 'report not found');
    res.json(report);
  }));

// --- Issue a new patient ID (FH-XXXX-XXXX) -----------------------------------
// Random, with a check character, and guaranteed not to be in use already.
router.get('/patients/new-ref', requireAuth, requirePermission('report:create'),
  asyncHandler(async (req, res) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = PatientRef.generate();
      const { rows } = await query('SELECT 1 FROM lab_reports WHERE patient_ref = $1 LIMIT 1', [candidate]);
      if (!rows.length) return res.json({ patientRef: candidate, format: 'FH-XXXX-XXXX' });
    }
    throw new HttpError(503, 'Could not issue a patient ID; try again');
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
    res.status(201).json(presentPrediction({ ...stored, inf, warnings: prepared.warnings }));
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

// --- Voice dictation: English, Urdu or mixed English-Urdu -> text + symptom tags --
// multipart field "audio" + "language" (en | ur | mixed). The clip goes to the
// local Whisper service and is discarded; only the transcript comes back.
router.post('/symptoms/transcribe', requireAuth,
  auditAction('SYMPTOM_DICTATION', () => ({ type: 'speech' })),
  requirePermission('report:create'),
  audioUpload.single('audio'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Send the recording in the form field "audio"');
    const language = ['en', 'ur', 'mixed'].includes(req.body?.language) ? req.body.language : 'mixed';
    const result = await speech.transcribe(req.file.buffer, {
      language, filename: req.file.originalname, mimeType: req.file.mimetype,
    });
    const text = String(result.text || '').slice(0, 2000);
    res.json({
      text,
      requestedLanguage: language,
      detectedLanguage: result.detected_language,
      durationSeconds: result.duration_seconds,
      engine: result.model,
      ms: result.ms,
      ...(text.trim() ? { parsed: { ...nlp.parseSymptoms(text), usedByModel: false } } : {}),
    });
  }));

router.get('/symptoms/speech-status', requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await speech.status());
  }));

// --- Guideline-based next steps for one condition -----------------------------
// The same block a prediction response carries for its top-scoring condition;
// the doctor's reading window loads any of the four from here.
router.get('/recommendations/:condition', requireAuth, requirePermission('prediction:read'),
  asyncHandler(async (req, res) => {
    if (!CLASSES.includes(req.params.condition)) throw new HttpError(404, 'No guidance for that condition');
    res.json(guidance.forCondition(req.params.condition));
  }));

module.exports = router;
