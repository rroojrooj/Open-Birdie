'use strict';
// Per-course surface override (data/courses/<slug>.surfaces.json): vector
// polygons + relocated pins applied ONCE at load time, before makeSurfaceLookup
// and before the geometry is served to the browser. Absent sidecar = no change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applySurfaceOverride, loadSurfaceOverride, makeSurfaceLookup, slug } = require('../lib/course');

const baseCourse = () => ({
  name: 'Test Links',
  holes: [{ ref: 1, tee: [0, 0], pin: [200, 200] }],
  surfaces: [],
  boundary: null,
});

test('override relocates the pin onto a new green: surfaceAt(pin) === green', () => {
  const course = baseCourse();
  assert.equal(makeSurfaceLookup(course)(200, 200), 'rough'); // before: nothing at the pin
  applySurfaceOverride(course, {
    pins: { 1: [10, 10] },
    surfaces: [{ kind: 'green', poly: [[0, 0], [20, 0], [20, 20], [0, 20]] }],
  });
  assert.deepEqual(course.holes[0].pin, [10, 10]);
  assert.equal(makeSurfaceLookup(course)(10, 10), 'green'); // pin now sits on a real green
});

test('appended green wins over rough but leaves far points alone', () => {
  const course = baseCourse();
  applySurfaceOverride(course, { surfaces: [{ kind: 'green', poly: [[0, 0], [20, 0], [20, 20], [0, 20]] }] });
  const at = makeSurfaceLookup(course);
  assert.equal(at(10, 10), 'green');
  assert.equal(at(500, 500), 'rough');
});

test('null / empty override is a no-op', () => {
  const course = baseCourse();
  applySurfaceOverride(course, null);
  applySurfaceOverride(course, {});
  assert.deepEqual(course.holes[0].pin, [200, 200]);
  assert.equal(course.surfaces.length, 0);
});

test('malformed override entries are ignored, not thrown', () => {
  const course = baseCourse();
  applySurfaceOverride(course, {
    pins: { 1: [1] },                                      // wrong arity -> ignored
    surfaces: [{ kind: 'green', poly: [[0, 0], [1, 1]] }], // < 3 points -> ignored
  });
  assert.deepEqual(course.holes[0].pin, [200, 200]);
  assert.equal(course.surfaces.length, 0);
});

test('loadSurfaceOverride: null when no sidecar, parsed object when present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-ovr-'));
  const course = { name: 'Test Links' };
  assert.equal(loadSurfaceOverride(course, dir), null);
  fs.writeFileSync(path.join(dir, slug('Test Links') + '.surfaces.json'), JSON.stringify({ pins: { 1: [5, 6] } }));
  assert.deepEqual(loadSurfaceOverride(course, dir).pins['1'], [5, 6]);
});
