import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalCourseFingerprint,
  courseFingerprintFor,
  courseFingerprintV1,
  courseFingerprintV2,
  loadCourseFile,
} from '../tools/hd-course/course-source.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const course = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'hd-course', 'course.json'), 'utf8'));

test('fingerprint is a 64-char sha256 hex', () => {
  assert.match(canonicalCourseFingerprint(course), /^[a-f0-9]{64}$/);
});

test('v1 golden hash remains byte-compatible', () => {
  assert.equal(courseFingerprintV1(course), '8c74b221f5ad5ddd737d293f932b537cf0285cc31e084f5fd6852f8007d7cec2');
  assert.equal(canonicalCourseFingerprint(course), courseFingerprintV1(course));
  assert.equal(courseFingerprintFor(course, { version: 1 }), courseFingerprintV1(course));
});

test('v2 ignores display and presentation-only fields', () => {
  const expected = courseFingerprintV2(course, course.source.courseId);
  const changed = {
    ...course,
    name: 'Renamed Course',
    presentation: { palette: 'links' },
    aerial: { file: 'renamed.aerial.jpg' },
    classMap: { file: 'renamed.classmap.png' },
    buildings: [{ poly: [[0, 0], [1, 0], [1, 1]] }],
    holes: course.holes.map((hole) => ({ ...hole, name: 'Renamed Hole' })),
    elevation: {
      ...course.elevation,
      patches: [{ minX: 1, minY: 2, cellM: 1, nx: 2, ny: 2, heights: [4, 3, 2, 1] }],
    },
  };
  assert.equal(courseFingerprintV2(changed, course.source.courseId), expected);
  assert.equal(courseFingerprintFor(changed, { version: 2, courseId: course.source.courseId }), expected);
});

test('v2 changes for source, geometry, routing, and coarse elevation', () => {
  const expected = courseFingerprintV2(course, course.source.courseId);
  const variants = [
    [{ ...course, source: { courseId: 'osm:way:91002', osmType: 'way', osmId: 91002 } }, 'osm:way:91002'],
    [{ ...course, boundary: course.boundary.map(([x, y], i) => i === 0 ? [x + 1, y] : [x, y]) }, course.source.courseId],
    [{ ...course, holes: [{ ...course.holes[0], line: [[0, 15], [60, 20], [100, 17]] }] }, course.source.courseId],
    [{ ...course, elevation: { ...course.elevation, heights: course.elevation.heights.map((h, i) => i === 0 ? h + 1 : h) } }, course.source.courseId],
  ];
  for (const [variant, courseId] of variants) {
    assert.notEqual(courseFingerprintV2(variant, courseId), expected);
  }
});

test('v2 rejects missing, mismatched, and unsupported identities/versions', () => {
  const sourceLess = { ...course }; delete sourceLess.source;
  assert.throws(() => courseFingerprintV2(sourceLess), (error) => error.code === 'HD_SOURCE_ID_REQUIRED');
  assert.throws(
    () => courseFingerprintV2(course, 'osm:way:91002'),
    (error) => error.code === 'HD_SOURCE_ID_MISMATCH',
  );
  assert.throws(
    () => courseFingerprintFor(course, { version: 99, courseId: course.source.courseId }),
    (error) => error.code === 'HD_FINGERPRINT_VERSION_UNSUPPORTED',
  );
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

test('loadCourseFile accepts cache v3 and v4, rejects others', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-course-version-'));
  try {
    const write = (version) => {
      const f = path.join(dir, `course-v${version}.json`);
      fs.writeFileSync(f, JSON.stringify({ ...course, version }));
      return f;
    };
    for (const version of [3, 4]) {
      assert.equal(loadCourseFile(write(version)).version, version);
    }
    for (const version of [2, 5]) {
      assert.throws(() => loadCourseFile(write(version)), (e) => e.code === 'HD_COURSE_VERSION');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
