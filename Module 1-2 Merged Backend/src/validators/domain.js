// backend/src/validators/domain.js
// ---------------------------------------------------------------------------
// Request schemas for the Module 6 domain routes. Class names and feature keys
// come from the generated contract, never from literals. Shape/type checks
// live here; unit conversion and range checks live in services/cbc.js so the
// messages match the Python service. Unknown top-level keys are rejected, and
// each message says what to fix (the error handler reports the first issue).
// ---------------------------------------------------------------------------
const { z } = require('zod');
const { CLASSES, contract } = require('../contract');

const classEnum = z.enum(CLASSES);

// A pseudonymous token (e.g. the HMAC patient_ref or a lab's opaque code): letters,
// digits and . _ : - only. Anything that looks like a direct identifier (CNIC,
// phone number, email) is refused so it can never be stored as the patient key.
const PATIENT_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOOKS_LIKE_IDENTIFIER = [
  [/^\d{5}-?\d{7}-?\d$/, 'a CNIC number'],
  [/^(\+?92|0)3\d{2}-?\d{7}$/, 'a phone number'],
  [/^\d{10,}$/, 'a long ID/phone number'],
];
const patientRef = z.string().trim()
  .min(1, 'Enter the pseudonymous patient reference')
  .max(128, 'Patient reference is too long (max 128 characters)')
  .refine((s) => !s.includes('@'), 'Use the pseudonymous patient reference, not an email address')
  .superRefine((s, ctx) => {
    for (const [re, what] of LOOKS_LIKE_IDENTIFIER) {
      if (re.test(s)) {
        ctx.addIssue({ code: 'custom', message: `This looks like ${what}; use the pseudonymous patient reference instead` });
        return;
      }
    }
    if (!PATIENT_REF.test(s)) {
      ctx.addIssue({ code: 'custom', message: 'Patient reference may contain only letters, digits and . _ : -' });
    }
  });

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

const describe = (x) => (typeof x === 'string' ? `the text "${x.slice(0, 20)}"`
  : Array.isArray(x) ? 'a list' : x === null ? 'null' : typeof x === 'number' ? String(x) : `a ${typeof x}`);

// z.record would silently drop a "__proto__" key; checking the object as sent
// keeps every key, so services/cbc.js sees and rejects anything unknown. Each
// bad entry is reported by name (e.g. "cbc.HGB: HGB must be a number ...").
function objectOf(what, example, checkValue) {
  return z.any().superRefine((v, ctx) => {
    if (v === undefined) return ctx.addIssue({ code: 'custom', message: `${what} is required, e.g. ${example}` });
    if (!isPlainObject(v)) return ctx.addIssue({ code: 'custom', message: `${what} must be an object, e.g. ${example}` });
    for (const [key, value] of Object.entries(v)) {
      const problem = checkValue(key, value);
      if (problem) ctx.addIssue({ code: 'custom', path: [key], message: problem });
    }
    return undefined;
  });
}
const cbcValues = objectOf('cbc', '{"HGB": 12.4}', (key, x) => {
  if (x === null) return null; // not measured
  if (typeof x !== 'number') return `${key} must be a number, not ${describe(x)}`;
  return Number.isFinite(x) ? null : `${key} must be a finite number`;
});
const cbcUnits = objectOf('units', '{"HGB": "g/dL"}', (key, x) => {
  if (typeof x !== 'string' || !x.trim()) return `the unit for ${key} must be text such as "g/dL", not ${describe(x)}`;
  return x.length > 32 ? `the unit for ${key} is too long` : null;
});

const MIN_DATE = Date.parse('1900-01-01');
const collectedAt = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), 'collectedAt must be a date')
  .refine((s) => Date.parse(s) >= MIN_DATE, 'collectedAt is before 1900')
  .refine((s) => Date.parse(s) <= Date.now() + 86400000, 'collectedAt is in the future');

const place = z.string().trim().min(1).max(80)
  .regex(/^[\p{L}\p{M} .'()-]+$/u, 'Use letters only for district/province names');

const reportBody = z.object({
  patientRef,
  sex: z.enum(['M', 'F', 'O'], { message: "sex must be 'M', 'F' or 'O'" }).nullable().optional(), // context only
  ageYears: z.number({ message: 'ageYears must be a whole number' }).int('ageYears must be a whole number')
    .min(0, 'ageYears cannot be negative').max(130, 'ageYears must be 130 or less').nullable().optional(), // context only
  cbc: cbcValues,
  units: cbcUnits.optional(),
  canonicalUnits: z.boolean().optional(),
  source: z.enum(['manual', 'ocr', 'lims']).optional(),
  symptomsText: z.string().max(2000, 'Symptom text is too long (max 2000 characters)').optional(), // context only
  district: place.optional(),
  province: place.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  collectedAt: collectedAt.optional(),
  labId: z.string().uuid('labId must be a UUID').optional(),
  model: z.literal(contract.model_name).optional(),
}).strict().refine((b) => (b.latitude == null) === (b.longitude == null),
  { message: 'Send latitude and longitude together', path: ['latitude'] });

const predictExistingBody = z.object({
  model: z.literal(contract.model_name).optional(),
}).strict();

const confirmBody = z.object({
  confirmedCondition: classEnum,
  notes: z.string().max(2000, 'Notes are too long (max 2000 characters)').nullable().optional(),
}).strict();

const clusterQuery = z.object({
  province: z.string().max(80).optional(),
  condition: classEnum.optional(),
});

const alertQuery = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved']).optional(),
  limit: z.coerce.number({ message: 'limit must be a whole number from 1 to 500' })
    .int('limit must be a whole number from 1 to 500').min(1, 'limit must be a whole number from 1 to 500')
    .max(500, 'limit must be a whole number from 1 to 500').optional(),
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
  district: place,
  province: place,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  flClientId: z.string().max(40).optional(),
}).strict();

const symptomsBody = z.object({ text: z.string().trim().min(1, 'text is required').max(2000) }).strict();

module.exports = {
  reportBody, predictExistingBody, confirmBody, clusterQuery, alertQuery,
  registerModelBody, labBody, symptomsBody, patientRef, PATIENT_REF,
};
