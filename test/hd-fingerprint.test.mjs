import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalCourseFingerprint } from '../tools/hd-course/course-source.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const course = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'hd-course', 'course.json'), 'utf8'));

test('fingerprint is a 64-char sha256 hex', () => {
  assert.match(canonicalCourseFingerprint(course), /^[a-f0-9]{64}$/);
});

test('fingerprint is stable under surface reordering', () => {
  const a = canonicalCourseFingerprint(course);
  const reordered = { ...course, surfaces: [...course.surfaces].reverse() };
  assert.equal(canonicalCourseFingerprint(reordered), a);
});

test('fingerprint is stable under tree reordering', () => {
  const a = canonicalCourseFingerprint(course);
  const reordered = { ...course, trees: [...course.trees].reverse() };
  assert.equal(canonicalCourseFingerprint(reordered), a);
});

test('fingerprint changes when the origin moves', () => {
  const a = canonicalCourseFingerprint(course);
  const moved = { ...course, origin: { ...course.origin, lat: course.origin.lat + 0.001 } };
  assert.notEqual(canonicalCourseFingerprint(moved), a);
});

test('fingerprint changes when coarse terrain heights change', () => {
  const a = canonicalCourseFingerprint(course);
  const heights = [...course.elevation.heights];
  heights[0] += 1;
  const bumped = { ...course, elevation: { ...course.elevation, heights } };
  assert.notEqual(canonicalCourseFingerprint(bumped), a);
});

test('fingerprint ignores generated HD green patches', () => {
  const a = canonicalCourseFingerprint(course);
  const withPatches = {
    ...course,
    elevation: {
      ...course.elevation,
      patches: [{ minX: 9, minY: 9, cellM: 1.5, nx: 2, ny: 2, heights: [1, 2, 3, 4] }],
    },
  };
  assert.equal(canonicalCourseFingerprint(withPatches), a);
});
