'use strict';

const crypto = require('node:crypto');
const { normalizeCourseSource } = require('./course-identity');

const SUPPORTED_FINGERPRINT_VERSIONS = Object.freeze([1, 2]);
const COURSE_ID = /^osm:(node|way|relation):([1-9][0-9]*)$/;

function fingerprintError(code, message) {
  const error = new Error(message);
  error.name = 'CourseFingerprintError';
  error.code = code;
  return error;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function sortedByCanonical(values) {
  return [...(values || [])]
    .map((value) => [stableStringify(value), value])
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map((entry) => entry[1]);
}

// This is the original production canonical form. Already-built manifests
// depend on these exact bytes.
function canonicalCourseV1(course) {
  const elevation = course.elevation;
  return {
    version: course.version ?? null,
    name: course.name ?? null,
    origin: course.origin ? { lat: course.origin.lat, lon: course.origin.lon } : null,
    boundary: course.boundary ?? null,
    surfaces: sortedByCanonical((course.surfaces || []).map((surface) => ({
      kind: surface.kind,
      poly: surface.poly,
    }))),
    holes: sortedByCanonical((course.holes || []).map((hole) => ({
      ref: hole.ref ?? null,
      par: hole.par ?? null,
      name: hole.name ?? null,
      tee: hole.tee ?? null,
      pin: hole.pin ?? null,
      line: hole.line ?? null,
      lengthYd: hole.lengthYd ?? null,
    }))),
    trees: sortedByCanonical(course.trees || []),
    woods: sortedByCanonical(course.woods || []),
    elevation: elevation
      ? {
          minX: elevation.minX,
          minY: elevation.minY,
          cellM: elevation.cellM,
          nx: elevation.nx,
          ny: elevation.ny,
          baseM: elevation.baseM,
          heights: elevation.heights,
        }
      : null,
  };
}

function parseCourseId(courseId) {
  const match = typeof courseId === 'string' ? COURSE_ID.exec(courseId) : null;
  if (!match || !Number.isSafeInteger(Number(match[2]))) {
    throw fingerprintError('HD_SOURCE_ID_REQUIRED', 'A valid OpenStreetMap courseId is required');
  }
  return normalizeCourseSource({
    courseId,
    osmType: match[1],
    osmId: Number(match[2]),
  }).courseId;
}

function resolveCourseId(course, requestedCourseId) {
  let cached;
  try {
    cached = normalizeCourseSource(course?.source);
  } catch {
    throw fingerprintError('HD_SOURCE_ID_REQUIRED', 'The cached course has no valid stable source identity');
  }
  const requested = requestedCourseId == null ? cached.courseId : parseCourseId(requestedCourseId);
  if (requested !== cached.courseId) {
    throw fingerprintError('HD_SOURCE_ID_MISMATCH', 'Requested and cached course identities do not match');
  }
  return cached.courseId;
}

function canonicalCourseV2(course, requestedCourseId) {
  const courseId = resolveCourseId(course, requestedCourseId);
  const elevation = course.elevation;
  return {
    schema: 2,
    courseId,
    origin: course.origin ? { lat: course.origin.lat, lon: course.origin.lon } : null,
    boundary: course.boundary ?? null,
    surfaces: sortedByCanonical((course.surfaces || []).map((surface) => ({
      kind: surface.kind,
      poly: surface.poly,
    }))),
    holes: sortedByCanonical((course.holes || []).map((hole) => ({
      ref: hole.ref ?? null,
      par: hole.par ?? null,
      tee: hole.tee ?? null,
      pin: hole.pin ?? null,
      line: hole.line ?? null,
      lengthYd: hole.lengthYd ?? null,
    }))),
    trees: sortedByCanonical(course.trees || []),
    woods: sortedByCanonical(course.woods || []),
    elevation: elevation
      ? {
          minX: elevation.minX,
          minY: elevation.minY,
          cellM: elevation.cellM,
          nx: elevation.nx,
          ny: elevation.ny,
          baseM: elevation.baseM,
          heights: elevation.heights,
        }
      : null,
  };
}

function hashCanonical(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function courseFingerprintV1(course) {
  return hashCanonical(canonicalCourseV1(course));
}

function courseFingerprintV2(course, courseId) {
  return hashCanonical(canonicalCourseV2(course, courseId));
}

function courseFingerprintFor(course, { version = 1, courseId } = {}) {
  if (version === 1) return courseFingerprintV1(course);
  if (version === 2) return courseFingerprintV2(course, courseId);
  throw fingerprintError(
    'HD_FINGERPRINT_VERSION_UNSUPPORTED',
    `Unsupported course fingerprint version ${version}`,
  );
}

module.exports = {
  SUPPORTED_FINGERPRINT_VERSIONS,
  canonicalCourseV1,
  canonicalCourseV2,
  courseFingerprintFor,
  courseFingerprintV1,
  courseFingerprintV2,
  parseCourseId,
  stableStringify,
};
