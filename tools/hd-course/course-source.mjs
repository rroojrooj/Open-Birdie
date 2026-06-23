// Cached-course resolution and the canonical course fingerprint.
//
// The fingerprint pins the exact cached OSM course a bundle was built against so
// a stale bundle (built from an older parse) is rejected at load time. It is
// order-independent for unordered collections (surfaces, holes, trees, woods) but
// sensitive to any geometry/height change, and it EXCLUDES elevation.patches —
// those generated HD greens are replaced by the bundle and would otherwise make
// the fingerprint unstable.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { HdCompileError } from './errors.mjs';

// Deterministic stringify: object keys sorted; array order preserved because
// coordinate and height order is semantically meaningful.
function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
      .join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

// Sort an unordered collection by each element's canonical form, keeping each
// element's internal (coordinate) order intact.
function sortedByCanonical(arr) {
  return [...(arr || [])]
    .map((el) => [stableStringify(el), el])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map((pair) => pair[1]);
}

function canonicalCourse(course) {
  const e = course.elevation;
  return {
    version: course.version ?? null,
    name: course.name ?? null,
    origin: course.origin ? { lat: course.origin.lat, lon: course.origin.lon } : null,
    boundary: course.boundary ?? null,
    surfaces: sortedByCanonical((course.surfaces || []).map((s) => ({ kind: s.kind, poly: s.poly }))),
    holes: sortedByCanonical((course.holes || []).map((h) => ({
      ref: h.ref ?? null, par: h.par ?? null, name: h.name ?? null,
      tee: h.tee ?? null, pin: h.pin ?? null, line: h.line ?? null, lengthYd: h.lengthYd ?? null,
    }))),
    trees: sortedByCanonical(course.trees || []),
    woods: sortedByCanonical(course.woods || []),
    // Coarse grid only — elevation.patches is deliberately omitted.
    elevation: e
      ? { minX: e.minX, minY: e.minY, cellM: e.cellM, nx: e.nx, ny: e.ny, baseM: e.baseM, heights: e.heights }
      : null,
  };
}

export function canonicalCourseFingerprint(course) {
  return crypto.createHash('sha256').update(stableStringify(canonicalCourse(course))).digest('hex');
}

export function loadCourseFile(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (cause) { throw new HdCompileError('resolve-course', 'HD_COURSE_READ', { path: filePath }, cause); }
  let course;
  try { course = JSON.parse(raw); }
  catch (cause) { throw new HdCompileError('resolve-course', 'HD_COURSE_JSON', { path: filePath }, cause); }
  if (course.version !== 3) {
    throw new HdCompileError('resolve-course', 'HD_COURSE_VERSION', { version: course.version });
  }
  if (!Array.isArray(course.holes) || course.holes.length === 0) {
    throw new HdCompileError('resolve-course', 'HD_COURSE_NO_HOLES', {});
  }
  return course;
}
