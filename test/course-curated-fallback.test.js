'use strict';
// loadSurfaceOverride falls back to the committed curated fixture
// (data/curated/<slug>.surfaces.json) when no machine-local override exists, so
// a reconstructed course's surfaces travel with the branch. Local file wins.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSurfaceOverride, slug } = require('../lib/course');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ob-ovr-'));
const course = { name: 'Test Links' };
const fname = slug(course.name) + '.surfaces.json';

test('falls back to the curated fixture when no data-dir override exists', () => {
  const dataDir = tmp(), curatedDir = tmp();
  fs.writeFileSync(path.join(curatedDir, fname), JSON.stringify({ version: 1, source: 'curated' }));
  assert.equal(loadSurfaceOverride(course, dataDir, curatedDir).source, 'curated');
});

test('the machine-local override wins over the curated fixture', () => {
  const dataDir = tmp(), curatedDir = tmp();
  fs.writeFileSync(path.join(dataDir, fname), JSON.stringify({ source: 'local' }));
  fs.writeFileSync(path.join(curatedDir, fname), JSON.stringify({ source: 'curated' }));
  assert.equal(loadSurfaceOverride(course, dataDir, curatedDir).source, 'local');
});

test('returns null when neither exists', () => {
  assert.equal(loadSurfaceOverride(course, tmp(), tmp()), null);
});

test('legacy gameplay adapter clones returned data and exposes no file path', () => {
  const { loadLegacyGameplayOverlay } = require('../lib/course');
  const dataDir = tmp();
  fs.writeFileSync(path.join(dataDir, fname), JSON.stringify({ pins: { 1: [5, 6] } }));
  const first = loadLegacyGameplayOverlay({ course, dataDir, curatedDir: tmp() });
  first.pins['1'][0] = 999;
  const second = loadLegacyGameplayOverlay({ course, dataDir, curatedDir: tmp() });
  assert.deepEqual(second, { pins: { 1: [5, 6] } });
  assert.doesNotMatch(JSON.stringify(second), /ob-ovr-|[A-Za-z]:\\/);
});
