'use strict';
// loadSurfaceOverride falls back to the committed curated fixture
// (stable-keyed, or identity-bound legacy slug file) when no machine-local
// override exists, so
// a reconstructed course's surfaces travel with the branch. Local file wins.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSurfaceOverride, slug } = require('../lib/course');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ob-ovr-'));
const course = {
  name: 'Test Links',
  source: { courseId: 'osm:way:41', osmType: 'way', osmId: 41 },
};
const fname = slug(course.name) + '.surfaces.json';
const legacy = (gameplay) => JSON.stringify({
  courseId: course.source.courseId,
  ...gameplay,
});

test('falls back to the curated fixture when no data-dir override exists', () => {
  const dataDir = tmp(), curatedDir = tmp();
  fs.writeFileSync(path.join(curatedDir, fname), legacy({ pins: { 1: [1, 2] } }));
  assert.deepEqual(loadSurfaceOverride(course, dataDir, curatedDir).pins['1'], [1, 2]);
});

test('the machine-local override wins over the curated fixture', () => {
  const dataDir = tmp(), curatedDir = tmp();
  fs.writeFileSync(path.join(dataDir, fname), legacy({ pins: { 1: [3, 4] } }));
  fs.writeFileSync(path.join(curatedDir, fname), legacy({ pins: { 1: [1, 2] } }));
  assert.deepEqual(loadSurfaceOverride(course, dataDir, curatedDir).pins['1'], [3, 4]);
});

test('returns null when neither exists', () => {
  assert.equal(loadSurfaceOverride(course, tmp(), tmp()), null);
});

test('legacy gameplay adapter clones returned data and exposes no file path', () => {
  const { loadLegacyGameplayOverlay } = require('../lib/course');
  const dataDir = tmp();
  fs.writeFileSync(path.join(dataDir, fname), legacy({ pins: { 1: [5, 6] } }));
  const first = loadLegacyGameplayOverlay({ course, dataDir, curatedDir: tmp() });
  first.pins['1'][0] = 999;
  const second = loadLegacyGameplayOverlay({ course, dataDir, curatedDir: tmp() });
  assert.deepEqual(second, { pins: { 1: [5, 6] } });
  assert.doesNotMatch(JSON.stringify(second), /ob-ovr-|[A-Za-z]:\\/);
});

test('same-name courses cannot share a legacy sidecar across stable identities', () => {
  const dataDir = tmp();
  const sameNameOtherId = {
    ...course,
    source: { courseId: 'osm:way:42', osmType: 'way', osmId: 42 },
  };
  fs.writeFileSync(
    path.join(dataDir, fname),
    legacy({ pins: { 1: [7, 8] } }),
  );

  assert.deepEqual(loadSurfaceOverride(course, dataDir, tmp()).pins['1'], [7, 8]);
  assert.equal(loadSurfaceOverride(sameNameOtherId, dataDir, tmp()), null);

  fs.writeFileSync(
    path.join(dataDir, 'osm-way-42.surfaces.json'),
    JSON.stringify({ pins: { 1: [9, 10] } }),
  );
  assert.deepEqual(
    loadSurfaceOverride(sameNameOtherId, dataDir, tmp()).pins['1'],
    [9, 10],
  );
});
