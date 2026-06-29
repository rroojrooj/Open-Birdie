'use strict';
// Per-hole playing-corridor boundary applied from the override sidecar
// (`holeBoundaries: { ref: ring }`). Sets `holes[].boundary`, distinct from the
// course-wide OB `boundary`. Malformed rings are ignored, never thrown.
const test = require('node:test');
const assert = require('node:assert/strict');
const { applySurfaceOverride } = require('../lib/course');

const course = () => ({ name: 'T', holes: [{ ref: 9, tee: [0, 0], pin: [10, 10] }], surfaces: [], boundary: null });

test('holeBoundaries sets the per-hole boundary on the matching hole', () => {
  const c = course();
  applySurfaceOverride(c, { holeBoundaries: { 9: [[0, 0], [50, 0], [50, 50], [0, 50]] } });
  assert.deepEqual(c.holes[0].boundary, [[0, 0], [50, 0], [50, 50], [0, 50]]);
});

test('a boundary with < 3 points is ignored (no throw)', () => {
  const c = course();
  applySurfaceOverride(c, { holeBoundaries: { 9: [[0, 0], [1, 1]] } });
  assert.equal(c.holes[0].boundary, undefined);
});

test('holeBoundaries does not disturb the course-wide boundary', () => {
  const c = course();
  c.boundary = [[0, 0], [9, 0], [9, 9]];
  applySurfaceOverride(c, { holeBoundaries: { 9: [[0, 0], [5, 0], [5, 5]] } });
  assert.deepEqual(c.boundary, [[0, 0], [9, 0], [9, 9]]);
});

test('a boundary for an unknown hole ref is a no-op', () => {
  const c = course();
  applySurfaceOverride(c, { holeBoundaries: { 14: [[0, 0], [5, 0], [5, 5]] } });
  assert.equal(c.holes[0].boundary, undefined);
});
