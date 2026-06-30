import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBundle } from '../tools/hd-course/encode.mjs';
import { publishBundle } from '../tools/hd-course/publisher.mjs';
import { canonicalCourseFingerprint } from '../tools/hd-course/course-source.mjs';
import hdBundle from '../lib/hd-bundle.js';

const { resolveHdBundle, resolveHdBundles, validateBundleDirectory } = hdBundle;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const course = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'hd-course', 'course.json'), 'utf8'));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// Compile + publish a real bundle for `course` into <dataDir>/hd-courses/<name>.
// `hole` sets the manifest hole; `seed` nudges the terrain so re-publishing the
// same hole yields a distinct bundleId (a real rebuild does the same).
async function publishFixture(dataDir, { name = 'bandon', hole = 1, seed = 0 } = {}) {
  const staging = tmp('hd-stage-');
  const snapped = { minX: 0, minY: 0, maxX: 30, maxY: 30, cellM: 3, nx: 11, ny: 11 };
  const terrainHeights = new Float32Array(11 * 11);
  for (let i = 0; i < terrainHeights.length; i += 1) terrainHeights[i] = i * 0.01 + seed;
  const surfacesRgba = Buffer.alloc(11 * 11 * 4);
  const coverageRgba = Buffer.alloc(11 * 11 * 4);
  for (let i = 0; i < 11 * 11; i += 1) { coverageRgba[i * 4] = 255; coverageRgba[i * 4 + 3] = 255; }
  await writeBundle({
    stagingDir: staging, course: course.name, hole, snapped, baseM: course.elevation.baseM,
    terrainHeights, rgb: Buffer.alloc(8 * 8 * 3, 90), imgW: 8, imgH: 8,
    surfacesRgba, coverageRgba, maskW: 11, maskH: 11,
    fingerprint: canonicalCourseFingerprint(course), compilerVersion: '0.1.0', provenance: { source: 't' },
  });
  const courseDir = path.join(dataDir, 'hd-courses', name);
  const published = await publishBundle({ stagedDir: staging, courseDir, validate: validateBundleDirectory });
  return { snapped, terrainHeights, bundleId: published.bundleId };
}

test('resolveHdBundle returns an injectable, fingerprint-matched terrain grid', async () => {
  const dataDir = tmp('hd-data-');
  const { terrainHeights } = await publishFixture(dataDir);
  const r = resolveHdBundle(course, { dataDir });
  assert.equal(r.status, 'valid');
  assert.equal(r.descriptor.hole, 1);
  assert.equal(r.descriptor.grid.nx, 11);
  assert.equal(r.descriptor.grid.edgeBlendM, 0);
  assert.equal(r.descriptor.grid.kind, 'hd-hole');
  // baseM matches the course, so heights inject unchanged
  assert.ok(Math.abs(r.descriptor.grid.heights[5] - terrainHeights[5]) < 1e-4);
});

test('resolveHdBundle metadata leaks no absolute path or height arrays', async () => {
  const dataDir = tmp('hd-data-');
  await publishFixture(dataDir);
  const meta = resolveHdBundle(course, { dataDir }).descriptor.metadata;
  const s = JSON.stringify(meta);
  assert.ok(!s.includes(dataDir), 'no absolute path in client metadata');
  assert.ok(!s.includes('heights'), 'no terrain heights in client metadata');
  assert.deepEqual(meta.assetKeys, ['terrain', 'orthophoto', 'surfaces', 'coverage']);
});

test('absent when no hd-courses dir', () => {
  assert.equal(resolveHdBundle(course, { dataDir: tmp('hd-empty-') }).status, 'absent');
});

// --- multi-patch: resolveHdBundles returns EVERY built hole's bundle ---

test('resolveHdBundles returns one descriptor per hole in the course', async () => {
  const dataDir = tmp('hd-data-');
  await publishFixture(dataDir, { name: 'chambers', hole: 8 });
  await publishFixture(dataDir, { name: 'chambers', hole: 9 });
  const r = resolveHdBundles(course, { dataDir });
  assert.equal(r.status, 'valid');
  assert.equal(r.descriptors.length, 2);
  assert.deepEqual(r.descriptors.map((d) => d.hole).sort((a, b) => a - b), [8, 9]);
  for (const d of r.descriptors) {
    assert.match(d.bundleId, /^[a-f0-9]{64}$/);
    assert.equal(d.grid.kind, 'hd-hole');
    assert.equal(d.grid.nx, 11);
    assert.equal(d.grid.heights.length, 11 * 11);
    assert.ok(d.metadata.bounds, 'descriptor carries client metadata');
    assert.ok(d.assetPaths.terrain, 'descriptor carries server asset paths');
  }
});

test('resolveHdBundles dedups multiple bundles of the same hole (active wins)', async () => {
  const dataDir = tmp('hd-data-');
  await publishFixture(dataDir, { name: 'chambers', hole: 8, seed: 0 });
  const active = await publishFixture(dataDir, { name: 'chambers', hole: 8, seed: 1 });
  const r = resolveHdBundles(course, { dataDir });
  assert.equal(r.status, 'valid');
  assert.equal(r.descriptors.length, 1);
  assert.equal(r.descriptors[0].hole, 8);
  assert.equal(r.descriptors[0].bundleId, active.bundleId, 'the active.json bundle wins the tie');
});

test('resolveHdBundles excludes bundles whose course fingerprint differs', async () => {
  const dataDir = tmp('hd-data-');
  await publishFixture(dataDir, { name: 'chambers', hole: 8 });
  const otherCourse = { ...course, name: `${course.name}-different` };
  assert.equal(resolveHdBundles(otherCourse, { dataDir }).status, 'absent');
});

test('resolveHdBundles is absent when no hd-courses dir', () => {
  assert.equal(resolveHdBundles(course, { dataDir: tmp('hd-empty-') }).status, 'absent');
});

test('resolveHdBundle (singular) delegates and no longer rejects duplicates', async () => {
  const dataDir = tmp('hd-data-');
  await publishFixture(dataDir, { name: 'one', hole: 1, seed: 0 });
  await publishFixture(dataDir, { name: 'two', hole: 1, seed: 1 });
  const r = resolveHdBundle(course, { dataDir });
  assert.equal(r.status, 'valid');
  assert.equal(r.descriptor.hole, 1);
});
