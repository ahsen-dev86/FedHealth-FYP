// The browser's patient ID rules must match the API's exactly: same alphabet,
// same check character, same error wording (src/contract/patientRef.js).
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import {
  ALPHABET, checkChar, formatRef, generateRef, normalizeRef, formatWhileTyping, patientRefError,
} from '../src/lib/patientRef.js';

const require = createRequire(import.meta.url);
const backend = require('../../Module 1-2 Merged Backend/src/contract/patientRef.js');

test('frontend and backend agree on the patient ID format', () => {
  assert.equal(ALPHABET, backend.ALPHABET);
  for (const body of ['0000000', '7K3M9QA', 'ZZZZZZZ', '1A2B3C4']) {
    assert.equal(checkChar(body), backend.checkChar(body));
    assert.equal(formatRef(body), backend.format(body));
  }
  for (let i = 0; i < 500; i += 1) {
    const ref = generateRef();
    assert.equal(backend.refError(ref), '', `${ref} generated in the browser must pass the API`);
    assert.equal(patientRefError(backend.generate()), '');
  }
});

test('the same inputs get the same verdict and wording on both sides', () => {
  const lims = 'ab12'.repeat(16);
  for (const input of ['', '   ', 'FH-0000-0000', 'FH-0000-0001', 'pt-hash-001', '35202-1234567-1', '0300-1234567',
    'ali@example.com', '<script>', lims, 'fh-0000-0000']) {
    assert.equal(patientRefError(input), backend.refError(input.trim()), JSON.stringify(input));
    assert.equal(normalizeRef(input), backend.normalize(input), JSON.stringify(input));
  }
});

test('typing is formatted into FH-XXXX-XXXX and look-alike letters become digits', () => {
  assert.equal(formatWhileTyping('fh7k3m'), 'FH-7K3M');
  assert.equal(formatWhileTyping('fh7k3m9qa'), 'FH-7K3M-9QA');
  assert.equal(formatWhileTyping('FH-7K3M-9QAZ-extra'), 'FH-7K3M-9QAZ');
  assert.equal(formatWhileTyping('fhol1i'), 'FH-0111');
  assert.equal(formatWhileTyping(''), '');
  assert.equal(formatWhileTyping('fh'), 'FH-');
  const lims = 'ab12'.repeat(16);
  assert.equal(formatWhileTyping(lims), lims, 'a pasted LIMS token is left alone');
});
