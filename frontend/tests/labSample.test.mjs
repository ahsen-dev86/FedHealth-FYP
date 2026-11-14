// The mock API's Lab Node sample (src/api/labSample.js) must equal what the real
// backend route generates (backend/src/services/labTelemetry.js), so mock mode shows
// what the deployed dashboard will. Also covers the time-label helpers it relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sampleLabTelemetry, STATES } from '../src/api/labSample.js';
import { relativeTime, spanBetween } from '../src/lib/format.js';

const require = createRequire(import.meta.url);
const backendPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Module 1-2 Merged Backend/src/services/labTelemetry.js');
const backend = require(backendPath);

const LAB = { id: '5a1b0000-0000-4000-8000-000000000001', name: 'Aga Khan Lab - Karachi', fl_client_id: 'lab-khi-01' };
const NOW = Date.parse('2026-10-04T12:00:00Z');

test('mock and backend generators agree for every simulated state', () => {
  assert.deepEqual(STATES, backend.STATES);
  for (const simulate of [undefined, ...STATES]) {
    assert.deepEqual(sampleLabTelemetry(LAB, { now: NOW, simulate }), backend.sampleLabTelemetry(LAB, { now: NOW, simulate }), String(simulate));
  }
});

test('relative time labels', () => {
  const t = (secondsAgo) => new Date(NOW - secondsAgo * 1000).toISOString();
  assert.equal(relativeTime(t(2), NOW), 'just now');
  assert.equal(relativeTime(t(12), NOW), '12 s ago');
  assert.equal(relativeTime(t(300), NOW), '5 min ago');
  assert.equal(relativeTime(t(3 * 3600 + 50), NOW), '3 h ago');
  assert.equal(relativeTime(t(2 * 86400), NOW), '2 d ago');
  assert.equal(relativeTime(null, NOW), '—');
  assert.equal(spanBetween(t(5 * 3600 + 12 * 60), NOW), '5 h 12 min');
  assert.equal(spanBetween(t(40 * 60), NOW), '40 min');
});
