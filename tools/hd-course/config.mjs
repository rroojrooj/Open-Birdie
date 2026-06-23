// Build-manifest loading and validation.
//
// A manifest is rejected (fail closed) on byte limits, unknown keys, bad enums,
// out-of-range numbers, or invalid bounds. A "pending" manifest loads for
// inspection but is not buildable — its discovery-derived fields (snapped bounds,
// per-asset content-length/ETag, course fingerprint) are filled by Plan 2's
// discovery command, which rewrites discovered.state to "resolved".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { HdCompileError } from './errors.mjs';
import { canonicalCourseFingerprint } from './course-source.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(HERE, 'schemas', 'build-manifest.schema.json'), 'utf8'));
const MAX_MANIFEST_BYTES = 256 * 1024;

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(SCHEMA);

export function parseManifest(manifest) {
  if (!validate(manifest)) {
    throw new HdCompileError('config', 'HD_MANIFEST_INVALID', { errors: ajv.errorsText(validate.errors) });
  }
  return manifest;
}

export function loadManifest(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (cause) { throw new HdCompileError('config', 'HD_MANIFEST_READ', { path: filePath }, cause); }
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > MAX_MANIFEST_BYTES) {
    throw new HdCompileError('config', 'HD_MANIFEST_TOO_LARGE', { bytes, max: MAX_MANIFEST_BYTES });
  }
  let json;
  try { json = JSON.parse(raw); }
  catch (cause) { throw new HdCompileError('config', 'HD_MANIFEST_JSON', { path: filePath }, cause); }
  return parseManifest(json);
}

export function isBuildable(manifest) {
  return manifest.discovered?.state === 'resolved' && manifest.course?.fingerprint !== 'pending';
}

export function assertBuildable(manifest) {
  if (manifest.discovered?.state !== 'resolved') {
    throw new HdCompileError('config', 'HD_MANIFEST_PENDING', { state: manifest.discovered?.state });
  }
  if (manifest.course?.fingerprint === 'pending') {
    throw new HdCompileError('config', 'HD_MANIFEST_PENDING', { reason: 'fingerprint-unpinned' });
  }
  return manifest;
}

// Cross-check a buildable manifest against the actual cached course (build time).
export function assertCourseMatches(manifest, course) {
  const actual = canonicalCourseFingerprint(course);
  if (actual !== manifest.course.fingerprint) {
    throw new HdCompileError('config', 'HD_FINGERPRINT_MISMATCH', {
      expected: manifest.course.fingerprint, actual,
    });
  }
  return manifest;
}
