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

const { resolveHdBundle, validateBundleDirectory } = hdBundle;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const course = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'hd-course', 'course.json'), 'utf8'));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// Compile + publish a real bundle for `course` into <dataDir>/hd-courses/<name>.
async function publishFixture(dataDir, name = 'bandon') {
  const staging = tmp('hd-stage-');
  const snapped = { minX: 0, minY: 0, maxX: 30, maxY: 30, cellM: 3, nx: 11, ny: 11 };
  const terrainHeights = new Float32Array(11 * 11);
  for (let i = 0; i < terrainHeights.length; i += 1) terrainHeights[i] = i * 0.01;
  const surfacesRgba = Buffer.alloc(11 * 11 * 4);
  const coverageRgba = Buffer.alloc(11 * 11 * 4);
  for (let i = 0; i < 11 * 11; i += 1) { coverageRgba[i * 4] = 255; coverageRgba[i * 4 + 3] = 255; }
  await writeBundle({
    stagingDir: staging, course: course.name, hole: 1, snapped, baseM: course.elevation.baseM,
    terrainHeights, rgb: Buffer.alloc(8 * 8 * 3, 90), imgW: 8, imgH: 8,
    surfacesRgba, coverageRgba, maskW: 11, maskH: 11,
    fingerprint: canonicalCourseFingerprint(course), compilerVersion: '0.1.0', provenance: { source: 't' },
  });
  const courseDir = path.join(dataDir, 'hd-courses', name);
  await publishBundle({ stagedDir: staging, courseDir, validate: validateBundleDirectory });
  return { snapped, terrainHeights };
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

test('rejected when two bundles match the same course (duplicate)', async () => {
  const dataDir = tmp('hd-data-');
  await publishFixture(dataDir, 'one');
  await publishFixture(dataDir, 'two');
  const r = resolveHdBundle(course, { dataDir });
  assert.equal(r.status, 'rejected');
  assert.equal(r.code, 'HD_DUPLICATE');
});
