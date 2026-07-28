'use strict';
// Offline tests for the classmap wiring in loadCourse's cache-MISS path.
// loadCourse itself does real network (Nominatim/Overpass/elevation/aerial) and
// is not unit-tested end-to-end, so the classify block is factored into a small
// pure helper `maybeClassify(course, name, deps)` with injected fetchBands /
// classify / writeFile. These tests prove the observable wiring contract:
//   (a) on success  -> course.aerial.{classFile,classBounds,classStats} are set,
//   (b) on NIR-null  -> no classFile, and it does not throw,
//   (c) on abort     -> no classFile, and it does not throw,
//   (d) never throws even when a dep throws (best-effort: degrade to OSM-only).
// The classify pipeline itself is covered by test/classify-surfaces.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maybeClassify } = require('../lib/course');

// A course with an aerial already attached (classmap is gated on course.aerial).
const withAerial = () => ({
  name: 'Test Links',
  origin: { lat: 47.2, lon: -122.57 },
  boundary: null,
  surfaces: [{ kind: 'fairway', poly: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
  holes: [{ ref: 1, line: [[0, 0], [10, 10]] }],
  aerial: { file: 'test-links.aerial.jpg', bounds: { minX: -60, minY: -60, maxX: 60, maxY: 60 } },
});

test('no aerial => no fetch, no classFile (classmap gated on course.aerial)', async () => {
  const course = { name: 'Test Links', origin: { lat: 47.2, lon: -122.57 }, surfaces: [], holes: [] };
  let fetched = false;
  await maybeClassify(course, 'Test Links', {
    fetchBands: async () => { fetched = true; return null; },
    classify: () => ({ pngBuffer: Buffer.from('x'), stats: { mownPct: 0.2, sandPct: 0.1 }, aborted: false }),
    writeFile: () => {},
  });
  assert.equal(fetched, false, 'fetchBands not called without an aerial');
  assert.equal(course.aerial, undefined);
});

test('success: writes the classmap and sets classFile/classBounds/classStats', async () => {
  const course = withAerial();
  let wrotePath = null, wroteBuf = null;
  const png = Buffer.from('PNGDATA');
  const stats = { mownPct: 0.228, sandPct: 0.11 };
  await maybeClassify(course, 'Test Links', {
    fetchBands: async () => ({ bands: new Uint8ClampedArray(4), width: 1, height: 1 }),
    classify: () => ({ pngBuffer: png, stats, aborted: false }),
    writeFile: (p, buf) => { wrotePath = p; wroteBuf = buf; },
  });
  assert.equal(course.aerial.classFile, 'test-links.classmap.png');
  assert.deepEqual(course.aerial.classBounds, course.aerial.bounds, 'classBounds == aerial bounds (staleness key)');
  assert.deepEqual(course.aerial.classStats, stats);
  assert.ok(wrotePath.endsWith('test-links.classmap.png'), 'wrote to the classmap path');
  assert.equal(wroteBuf, png, 'wrote the classify PNG buffer');
});

test('source-identified course writes a stable source-keyed classmap filename', async () => {
  const course = withAerial();
  course.source = { courseId: 'osm:way:92001', osmType: 'way', osmId: 92001 };
  let wrotePath = null;
  await maybeClassify(course, 'Renamed Links', {
    fetchBands: async () => ({ bands: new Uint8ClampedArray(4), width: 1, height: 1 }),
    classify: () => ({
      pngBuffer: Buffer.from('x'),
      stats: { mownPct: 0.2, sandPct: 0.1 },
      aborted: false,
    }),
    writeFile: (file) => { wrotePath = file; },
  });
  assert.equal(course.aerial.classFile, 'osm-way-92001.classmap.png');
  assert.ok(wrotePath.endsWith('osm-way-92001.classmap.png'));
});

test('classify passes aerial.bounds + boundary + surfaces through unchanged', async () => {
  const course = withAerial();
  let seen = null;
  await maybeClassify(course, 'Test Links', {
    fetchBands: async () => ({ bands: new Uint8ClampedArray(4), width: 2, height: 3 }),
    classify: (args) => { seen = args; return { pngBuffer: Buffer.from('x'), stats: { mownPct: 0.2, sandPct: 0.1 }, aborted: false }; },
    writeFile: () => {},
  });
  assert.equal(seen.width, 2);
  assert.equal(seen.height, 3);
  assert.equal(seen.bounds, course.aerial.bounds, 'classify sees the aerial bounds');
  assert.equal(seen.boundary, course.boundary);
  assert.equal(seen.surfaces, course.surfaces);
});

test('NIR fetch null: no classFile set, no write, does not throw', async () => {
  const course = withAerial();
  let wrote = false, classified = false;
  await maybeClassify(course, 'Test Links', {
    fetchBands: async () => null,
    classify: () => { classified = true; return { pngBuffer: null, stats: {}, aborted: true }; },
    writeFile: () => { wrote = true; },
  });
  assert.equal(course.aerial.classFile, undefined, 'no classFile on NIR-null');
  assert.equal(classified, false, 'classify not called when bands are null');
  assert.equal(wrote, false, 'nothing written');
});

test('safeguard abort (pngBuffer null, aborted true): no classFile, no write, does not throw', async () => {
  const course = withAerial();
  let wrote = false;
  await maybeClassify(course, 'Test Links', {
    fetchBands: async () => ({ bands: new Uint8ClampedArray(4), width: 1, height: 1 }),
    classify: () => ({ pngBuffer: null, stats: { mownPct: 0.0, sandPct: 0.7 }, aborted: true }),
    writeFile: () => { wrote = true; },
  });
  assert.equal(course.aerial.classFile, undefined, 'no classFile on abort');
  assert.equal(wrote, false, 'nothing written on abort');
});

test('best-effort: a throwing fetchBands never escapes maybeClassify', async () => {
  const course = withAerial();
  await assert.doesNotReject(() => maybeClassify(course, 'Test Links', {
    fetchBands: async () => { throw new Error('network down'); },
    classify: () => { throw new Error('should not reach'); },
    writeFile: () => {},
  }));
  assert.equal(course.aerial.classFile, undefined);
});

test('best-effort: a throwing writeFile never escapes maybeClassify', async () => {
  const course = withAerial();
  await assert.doesNotReject(() => maybeClassify(course, 'Test Links', {
    fetchBands: async () => ({ bands: new Uint8ClampedArray(4), width: 1, height: 1 }),
    classify: () => ({ pngBuffer: Buffer.from('x'), stats: { mownPct: 0.2, sandPct: 0.1 }, aborted: false }),
    writeFile: () => { throw new Error('disk full'); },
  }));
  // write threw AFTER we chose the name but the aerial mutation happens post-write,
  // so a failed write must not leave a dangling classFile pointing at a missing file.
  assert.equal(course.aerial.classFile, undefined, 'failed write leaves no classFile');
});
