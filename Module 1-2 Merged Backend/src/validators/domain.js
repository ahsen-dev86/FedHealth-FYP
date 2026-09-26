// backend/src/validators/domain.js
// ---------------------------------------------------------------------------
// Request schemas for the Module 6 domain routes. Class names and feature keys
// come from the generated contract, never from literals. Shape/type checks
// live here; unit conversion and range checks live in services/cbc.js so the
// messages match the Python service. Unknown top-level keys are rejected.
// ---------------------------------------------------------------------------
const { z } = require('zod');
const { CLASSES, contract } = require('../contract');

const classEnum = z.enum(CLASSES);
const dateString = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), 'must be a date');

// CBC values are numbers (null = not measured); keys are checked against the
// ten features by prepareCbc so every layer gives the same "Unknown CBC field" error.
const cbcValues = z.record(z.string(), z.number().finite().nullable());
const cbcUnits = z.record(z.string(), z.string().trim().min(1).max(32));

const reportBody = z.object({
  patientRef: z.string().trim().min(1).max(128),
  sex: z.enum(['M', 'F', 'O']).nullable().optional(),        // context only, not a model input
  ageYears: z.number().int().min(0).max(130).nullable().optional(), // context only
  cbc: cbcValues,
  units: cbcUnits.optional(),
  canonicalUnits: z.boolean().optional(),
  source: z.enum(['manual', 'ocr', 'lims']).optional(),
  symptomsText: z.string().max(2000).optional(),              // context only
  district: z.string().trim().max(80).optional(),
  province: z.string().trim().max(80).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  collectedAt: dateString.optional(),
  labId: z.string().uuid().optional(),
  model: z.literal(contract.model_name).optional(),
}).strict();

const predictExistingBody = z.object({
  model: z.literal(contract.model_name).optional(),
}).strict();

const confirmBody = z.object({
  confirmedCondition: classEnum,
  notes: z.string().max(2000).nullable().optional(),
}).strict();

const clusterQuery = z.object({
  province: z.string().max(80).optional(),
  condition: classEnum.optional(),
});

const alertQuery = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const registerModelBody = z.object({
  name: z.string().trim().min(1).max(80),
  version: z.string().trim().min(1).max(120),
  diseaseScope: z.string().max(300).optional(),
  classes: z.array(z.string().min(1)).min(2),
  metrics: z.record(z.string(), z.any()).optional(),
  calibration: z.enum(['temperature_scaling', 'platt']).nullable().optional(),
  activate: z.boolean().optional(),
}).strict().refine(
  (b) => b.name !== contract.model_name || JSON.stringify(b.classes) === JSON.stringify(CLASSES),
  { message: `${contract.model_name} must use classes ${CLASSES.join(', ')} in this order`, path: ['classes'] },
);

const labBody = z.object({
  name: z.string().trim().min(1).max(120),
  limsType: z.string().max(60).optional(),
  district: z.string().trim().min(1).max(80),
  province: z.string().trim().min(1).max(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  flClientId: z.string().max(40).optional(),
}).strict();

const symptomsBody = z.object({ text: z.string().trim().min(1).max(2000) }).strict();

module.exports = {
  reportBody, predictExistingBody, confirmBody, clusterQuery, alertQuery,
  registerModelBody, labBody, symptomsBody,
};
