// Unit tests for the production-readiness features: patient ID format, proof
// documents, clinical guidance knowledge base, explanation and inference failover.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PatientRef = require('../../src/contract/patientRef');
const proof = require('../../src/auth/proof');
const guidance = require('../../src/services/guidance');
const { buildExplanation, statusOf, referenceFor } = require('../../src/services/explain');
const { CLASSES, FEATURES } = require('../../src/contract');

test('patient ID: generated IDs are valid, unique and carry a check character', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const ref = PatientRef.generate();
    assert.match(ref, PatientRef.FH_REF);
    assert.equal(PatientRef.refError(ref), '', ref);
    seen.add(ref);
  }
  assert.ok(seen.size > 1990, 'random IDs should practically never repeat');
});

test('patient ID: every single-character typo is caught', () => {
  const ref = PatientRef.format('7K3M9QA');
  const chars = ref.replace(/^FH-/, '').replace('-', '');
  for (let i = 0; i < 8; i += 1) {
    for (const c of PatientRef.ALPHABET) {
      if (c === chars[i]) continue;
      const typo = chars.slice(0, i) + c + chars.slice(i + 1);
      assert.notEqual(PatientRef.refError(`FH-${typo.slice(0, 4)}-${typo.slice(4)}`), '', `${typo} should fail`);
    }
  }
});

test('patient ID: typed forms normalise; look-alike letters are read as digits', () => {
  const ref = PatientRef.format('1010ABC'); // contains 1 and 0
  const typed = ref.toLowerCase().replace(/1/g, 'l').replace(/0/g, 'o').replace(/-/g, '');
  assert.equal(PatientRef.normalize(typed), ref);
  assert.equal(PatientRef.normalize(`  ${ref}  `), ref);
  const lims = 'ab12'.repeat(16);
  assert.equal(PatientRef.normalize(lims), lims, 'a LIMS token is left as it is');
  assert.equal(PatientRef.refError(lims), '');
});

test('proof document: type comes from the file bytes, not the declared name', () => {
  const pdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
  assert.equal(proof.sniff(pdf), 'application/pdf');
  assert.equal(proof.sniff(png), 'image/png');
  assert.equal(proof.sniff(jpg), 'image/jpeg');
  assert.equal(proof.sniff(webp), 'image/webp');
  for (const junk of [Buffer.from('MZ\x90\x00 executable bytes here'), Buffer.from('<html><script>alert(1)</script>'), Buffer.alloc(4)]) {
    assert.equal(proof.sniff(junk), null);
  }
  assert.throws(() => proof.readProof(undefined, 'doctor'), /medical licence/);
  assert.throws(() => proof.readProof({ buffer: Buffer.from('MZ not a document at all'), originalname: 'licence.pdf' }, 'doctor'), /PDF, PNG, JPEG or WebP/);
  const doc = proof.readProof({ buffer: pdf, originalname: '..\\..\\etc/pass<wd>.exe' }, 'ngo');
  assert.equal(doc.docType, 'ngo_registration');
  assert.equal(doc.mimeType, 'application/pdf');
  assert.match(doc.filename, /^[^\\/<>]+\.pdf$/, 'stored name has no path or markup and the real extension');
  assert.match(doc.sha256, /^[0-9a-f]{64}$/);
});

test('each registrable role has its own proof type', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(proof.PROOF_BY_ROLE).map(([role, p]) => [role, p.docType])), {
    doctor: 'medical_license', nih_official: 'employee_card', lab_tech: 'lab_employee_card', ngo: 'ngo_registration',
  });
});

test('clinical guidance: all four classes, every item cites a known source, no drug doses', () => {
  assert.deepEqual(guidance.conditions(), CLASSES);
  for (const condition of CLASSES) {
    const g = guidance.forCondition(condition);
    assert.ok(g.title && g.summary && g.disclaimer, condition);
    assert.ok(g.confirmatoryTests.length >= 2 && g.management.length >= 2, condition);
    for (const item of [...g.confirmatoryTests, ...g.management]) {
      for (const id of item.sources) assert.ok(guidance.guidance.sources[id], `${condition}: unknown source ${id}`);
    }
    assert.ok(g.sources.every((s) => /^https:\/\//.test(s.url) && s.org && s.title && s.year), condition);
    assert.doesNotMatch(JSON.stringify(g), /\d+\s?(mg|mcg|µg|ml|IU)\b/i, `${condition}: guidance must not state doses`);
  }
  assert.equal(guidance.forCondition('lymphoma'), null);
});

test('clinical guidance: the frontend copy is identical to the backend knowledge base', () => {
  const backend = fs.readFileSync(path.resolve(__dirname, '../../src/knowledge/clinicalGuidance.json'), 'utf8');
  const frontend = fs.readFileSync(path.resolve(__dirname, '../../../frontend/src/lib/clinicalGuidance.json'), 'utf8');
  assert.equal(frontend.replace(/\r\n/g, '\n'), backend.replace(/\r\n/g, '\n'));
});

test('explanation: values are read against sex-specific reference intervals', () => {
  assert.deepEqual(referenceFor('HGB', 'F'), [12.0, 15.5]);
  assert.deepEqual(referenceFor('HGB', 'M'), [13.0, 17.5]);
  assert.equal(statusOf(12.5, referenceFor('HGB', 'F')), 'normal');
  assert.equal(statusOf(12.5, referenceFor('HGB', 'M')), 'low');
  assert.equal(statusOf(null, referenceFor('MCV', null)), 'not_measured');
  const ex = buildExplanation({ canonical: { HGB: 8.9, MCV: 68, PLT: 520 }, inf: { top_condition: 'anemia' }, sex: 'F' });
  assert.equal(ex.available, false, 'no attribution without Shapley values from the model');
  assert.deepEqual(ex.features.map((f) => f.feature), FEATURES);
  assert.deepEqual(ex.abnormal, [{ feature: 'HGB', status: 'low' }, { feature: 'MCV', status: 'low' }, { feature: 'PLT', status: 'high' }]);
  assert.equal(ex.features.find((f) => f.feature === 'WBC').status, 'not_measured');
});

test('explanation: drivers are the measured values ranked by absolute contribution to the top class', () => {
  const zero = Object.fromEntries(FEATURES.map((f) => [f, 0]));
  const contributions = Object.fromEntries(CLASSES.map((c) => [c, { ...zero }]));
  Object.assign(contributions.anemia, { HGB: 0.31, MCV: -0.05, RDW: 0.12 });
  const ex = buildExplanation({
    canonical: { HGB: 8.9, MCV: 90, RDW: 17 },
    inf: {
      top_condition: 'anemia', scores: { healthy: 0.1, anemia: 0.7, thalassemia: 0.15, leukemia: 0.05 },
      explanation: {
        method: 'exact_shapley_median_baseline', note: 'n', contributions,
        baseline_scores: { healthy: 0.6, anemia: 0.32, thalassemia: 0.05, leukemia: 0.03 },
        reference_values: Object.fromEntries(FEATURES.map((f) => [f, 1])), model_evaluations: 8, ms: 3,
      },
    },
  });
  assert.equal(ex.available, true);
  assert.deepEqual(ex.attribution.drivers.map((d) => d.feature), ['HGB', 'RDW', 'MCV']);
  const total = ex.attribution.drivers.reduce((a, d) => a + d.contribution, 0);
  assert.ok(Math.abs(total - (ex.attribution.score - ex.attribution.baselineScore)) < 1e-9, 'contributions add up to score - reference');
});

test('inference failover: a dead primary falls over to the backup replica; input errors are not retried', async () => {
  const config = require('../../src/config');
  const saved = { ...config.inference };
  const realFetch = global.fetch;
  Object.assign(config.inference, { url: 'http://primary.test', fallbackUrl: 'http://backup.test', breakerMs: 60000 });
  delete require.cache[require.resolve('../../src/services/inferenceClient')];
  const Inference = require('../../src/services/inferenceClient');
  const calls = [];
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  try {
    let primary = 'down';
    global.fetch = async (url) => {
      calls.push(url);
      if (url.startsWith('http://primary.test')) {
        if (primary === 'down') throw new Error('connect ECONNREFUSED');
        if (primary === 'bad-input') return reply(400, { error: 'HGB outside supported range' });
        return reply(200, { served_by: 'primary', model_version: 'p1' });
      }
      return reply(200, { served_by: 'backup', model_version: 'b1' });
    };
    const first = await Inference.infer('cbc_multiclass', { HGB: 12 }, null);
    assert.equal(first.served_by, 'backup');
    assert.match(first.failover_reason, /unavailable|unreachable/);
    assert.deepEqual(calls.map((u) => new URL(u).host), ['primary.test', 'backup.test']);

    calls.length = 0;
    await Inference.infer('cbc_multiclass', { HGB: 12 }, null);
    assert.deepEqual(calls.map((u) => new URL(u).host), ['backup.test'], 'open breaker skips the dead primary');

    // A caller's input error from a healthy primary is returned, never sent to the backup.
    delete require.cache[require.resolve('../../src/services/inferenceClient')];
    const Fresh = require('../../src/services/inferenceClient');
    primary = 'bad-input';
    calls.length = 0;
    await assert.rejects(() => Fresh.infer('cbc_multiclass', { HGB: 99 }, null), (e) => e.status === 400);
    assert.deepEqual(calls.map((u) => new URL(u).host), ['primary.test']);

    primary = 'up';
    const ok = await Fresh.infer('cbc_multiclass', { HGB: 12 }, null);
    assert.equal(ok.served_by, 'primary');
    assert.equal(ok.failover_reason, null);
  } finally {
    global.fetch = realFetch;
    Object.assign(config.inference, saved);
    delete require.cache[require.resolve('../../src/services/inferenceClient')];
  }
});
