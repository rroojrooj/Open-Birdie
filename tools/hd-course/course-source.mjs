// Cached-course resolution and the canonical course fingerprints.
//
// Runtime and compiler share one CommonJS implementation so v1 compatibility
// and v2 identity/geometry hashing cannot drift between module systems.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { HdCompileError } from './errors.mjs';

const require = createRequire(import.meta.url);
const fingerprints = require('../../lib/course-fingerprint.js');

export const courseFingerprintV1 = fingerprints.courseFingerprintV1;
export const courseFingerprintV2 = fingerprints.courseFingerprintV2;
export const courseFingerprintFor = fingerprints.courseFingerprintFor;

// Compatibility name retained for extensions that explicitly use legacy v1.
// New discover/build paths call courseFingerprintV2.
export const canonicalCourseFingerprint = courseFingerprintV1;

export function loadCourseFile(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (cause) { throw new HdCompileError('resolve-course', 'HD_COURSE_READ', { path: filePath }, cause); }
  let course;
  try { course = JSON.parse(raw); }
  catch (cause) { throw new HdCompileError('resolve-course', 'HD_COURSE_JSON', { path: filePath }, cause); }
  // v3 (coarse terrarium base) and v4 (course-wide 1 m 3DEP base — CACHE_VERSION
  // in lib/course.js) have the same shape everywhere the compiler reads.
  if (course.version !== 3 && course.version !== 4) {
    throw new HdCompileError('resolve-course', 'HD_COURSE_VERSION', { version: course.version });
  }
  if (!Array.isArray(course.holes) || course.holes.length === 0) {
    throw new HdCompileError('resolve-course', 'HD_COURSE_NO_HOLES', {});
  }
  return course;
}
