// Exercise model-version registration without a database or live API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const canonical = ['healthy', 'anemia', 'thalassemia', 'leukemia'];
let active = { id: 1, version: 'old', classes: ['healthy', 'leukemia'] };
let registered = null;
const models = {
  getActive: async () => active,
  register: async value => { registered = value; return { id: 2 }; },
  setActive: async () => {},
};
const moduleStub = { exports: {} };
const requireStub = name => {
  if (name.endsWith('mlModels')) return models;
  if (name.endsWith('audit')) return { logEvent: async () => {} };
  return {};
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Module 6 Domain API/predictionService.js'), 'utf8'),
                   { require: requireStub, module: moduleStub });
(async () => {
  const resolve = moduleStub.exports.resolveModelId;
  assert.equal(await resolve('cbc_multiclass', 'new', canonical), 2);
  assert.deepEqual(registered.classes, canonical);
  active = { id: 3, version: 'new', classes: canonical };
  registered = null;
  assert.equal(await resolve('cbc_multiclass', 'new', canonical), 3);
  assert.equal(registered, null);
  active.classes = [...canonical].reverse();
  assert.equal(await resolve('cbc_multiclass', 'new', canonical), 2);
  console.log('Registry version/class-order checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
