'use strict';
// test/run_layer_tests.js
// Run: PGDATABASE=fedhealth PGUSER=fedhealth_app PGPASSWORD=... node test/run_layer_tests.js
// (or just `node test/run_layer_tests.js` if a .env file is present)

require('dotenv').config();
process.env.PATIENT_REF_HMAC_KEY = process.env.PATIENT_REF_HMAC_KEY || 'test-only-hmac-key';

const { pool } = require('../src/db/pool');
const Roles = require('../src/models/roles');
const Users = require('../src/models/users');
const Labs = require('../src/models/labs');
const LabReports = require('../src/models/labReports');
const MlModels = require('../src/models/mlModels');
const Predictions = require('../src/models/predictions');
const AuditLogs = require('../src/models/auditLogs');
const NihClusters = require('../src/models/nihClusters');
const { derivePatientRef } = require('../src/models/pseudonymize');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  ok   - ${label}`); }
  else { failed++; console.log(`  FAIL - ${label}`); }
}

async function main() {
  console.log('=== roles / permissions ===');
  const doctorRole = await Roles.getByName('doctor');
  const nihRole = await Roles.getByName('nih_official');
  const nihPerms = await Roles.permissionsFor(nihRole.id);
  check('nih_official has exactly 3 permissions', nihPerms.length === 3);
  check('nih_official lacks report:read', !nihPerms.includes('report:read'));
  check('nih_official lacks prediction:read', !nihPerms.includes('prediction:read'));

  console.log('=== pseudonymize ===');
  const ref1 = derivePatientRef('LAB-INTERNAL-0042');
  const ref2 = derivePatientRef('LAB-INTERNAL-0042');
  check('deterministic per input', ref1 === derivePatientRef('LAB-INTERNAL-0042') && ref1 === ref2);
  check('unrecognizable from source id', !ref1.includes('0042'));

  console.log('=== labs / lab_reports (geo auto-default) ===');
  const lab = await Labs.create({
    name: `Layer Test Lab ${Date.now()}`, district: 'Peshawar', province: 'KP',
    latitude: 34.0151, longitude: 71.5249,
  });
  const labTechRole = await Roles.getByName('lab_tech');
  const labTech = await Users.create({ email: `tech-${Date.now()}@example.com`, fullName: 'Tech', roleId: labTechRole.id });
  const patientRef = derivePatientRef('LAYER-TEST-PATIENT-1');
  const report = await LabReports.create({
    labId: lab.id, createdBy: labTech.id, source: 'manual', patientRef, cbc: { hb: 9.8 },
  });
  check('report inherited district from lab', report.district === 'Peshawar');
  check('report inherited coordinates from lab', Number(report.latitude) === 34.0151);

  console.log('=== ml_models / predictions / confirmation guard ===');
  const model = await MlModels.register({
    name: 'layer_test_model', version: `v_${Date.now()}`, classes: ['healthy', 'anemia'], isActive: true,
  });
  const prediction = await Predictions.create({
    labReportId: report.id, modelId: model.id, scores: { healthy: 0.05, anemia: 0.95 },
    topCondition: 'anemia', topConfidence: 0.95, riskFlag: true,
  });
  check('prediction stored with null confirmed_condition', prediction.confirmed_condition === null);

  const doctor = await Users.create({ email: `doc-${Date.now()}@example.com`, fullName: 'Doctor', roleId: doctorRole.id });
  const confirmed = await Predictions.confirmByDoctor({ predictionId: prediction.id, doctorId: doctor.id, confirmedCondition: 'anemia' });
  check('doctor confirmation succeeds', confirmed.confirmed_condition === 'anemia');
  check('confirmed_at auto-stamped', confirmed.confirmed_at !== null);

  let techBlocked = false;
  try {
    await Predictions.confirmByDoctor({ predictionId: prediction.id, doctorId: labTech.id, confirmedCondition: 'healthy' });
  } catch (e) { techBlocked = e.code === '23514'; }
  check('lab_tech is blocked from confirming (23514)', techBlocked);

  console.log('=== audit log ===');
  await AuditLogs.append({ actorUserId: doctor.id, actorRole: 'doctor', action: 'PREDICTION_CONFIRM', resourceType: 'prediction', resourceId: prediction.id });
  const chain = await AuditLogs.verifyChain();
  check('audit chain intact (ok:true, broken_at:null)', chain.ok === true && chain.broken_at === null);

  console.log('=== NIH clusters (aggregate only) ===');
  const clusters = await NihClusters.getClusters({ province: 'KP' });
  const cluster = clusters.find((c) => c.district === 'Peshawar');
  check('cluster found, numeric types coerced', cluster && typeof cluster.case_count === 'number');
  check('no patient_ref/cbc field on the cluster row', cluster && !('patient_ref' in cluster) && !('cbc' in cluster));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Test run crashed:', e); process.exit(1); });
