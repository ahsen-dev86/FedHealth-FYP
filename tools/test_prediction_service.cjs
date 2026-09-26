// Exercise model-version registration without a database or live API.
// predictionService must reference the exact served (name, version), never
// invent metrics for an unregistered version, and refuse a class order that
// differs from the four-class contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const backend = path.join(__dirname, '../Module 1-2 Merged Backend/src');
const canonical = ['healthy', 'anemia', 'thalassemia', 'leukemia'];
let rows = {};
let registered = null;
let activated = null;
let audited = null;
const models = {
  findByNameVersion: async (name, version) => rows[`${name}@${version}`] || null,
  register: async (value) => { registered = value; return { id: 2 }; },
  setActive: async (id) => { activated = id; },
};
const moduleStub = { exports: {} };
const requireStub = (name) => {
  if (name.endsWith('mlModels')) return models;
  if (name.endsWith('audit')) return { logEvent: async (e) => { audited = e; } };
  if (name.endsWith('errors')) return require(path.join(backend, 'middleware/errors'));
  if (name.endsWith('contract')) return require(path.join(backend, 'contract'));
  return {};
};
vm.runInNewContext(fs.readFileSync(path.join(backend, 'services/predictionService.js'), 'utf8'),
                   { require: requireStub, module: moduleStub, JSON });
(async () => {
  const resolve = moduleStub.exports.resolveModelId;

  rows = { 'cbc_multiclass@v-real': { id: 3, classes: canonical, is_active: true } };
  assert.equal(await resolve('cbc_multiclass', 'v-real', canonical), 3);
  assert.equal(registered, null);

  assert.equal(await resolve('cbc_multiclass', 'v-new', canonical), 2);
  assert.deepEqual(registered.classes, canonical);
  assert.equal(registered.metrics, undefined); // no invented scores
  assert.equal(activated, 2);
  assert.equal(audited.action, 'MODEL_AUTOREGISTER');

  registered = null;
  await assert.rejects(resolve('cbc_multiclass', 'v-real', [...canonical].reverse()), (e) => e.status === 502);
  rows['cbc_multiclass@v-odd'] = { id: 4, classes: [...canonical].reverse() };
  await assert.rejects(resolve('cbc_multiclass', 'v-odd', canonical), (e) => e.status === 502);
  assert.equal(registered, null);
  console.log('Registry version/class-order checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
