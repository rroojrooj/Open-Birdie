import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const require = createRequire(import.meta.url);
const { canonicalizeWithMissing, resolveTask0Output } = require('./output-path.cjs');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROLES = ['address', 'close-green', 'close-bunker', 'landing', 'hole-overview', 'high-overview', 'horizon', 'ui'];
export const BANDS = ['address', 'feature', 'hole', 'overview', 'horizon', 'ui'];
const ID_PATTERN = '^[a-z0-9][a-z0-9-]{0,63}$';
const finiteNumber = { type: 'number', minimum: -20000, maximum: 20000 };

export function canonicalizePath(input) {
  return canonicalizeWithMissing(input);
}
const poseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tx', 'ty', 'dist', 'pitch', 'yaw', 'hOff'],
  properties: {
    tx: finiteNumber,
    ty: finiteNumber,
    dist: { type: 'number', minimum: 4, maximum: 12000 },
    pitch: { type: 'number', minimum: -88, maximum: -4 },
    yaw: { type: 'number' },
    hOff: finiteNumber,
  },
};
const suiteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'capture', 'courses'],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: 'string', pattern: ID_PATTERN },
    capture: {
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height', 'deviceScaleFactor'],
      properties: {
        width: { type: 'integer', minimum: 320, maximum: 7680 },
        height: { type: 'integer', minimum: 320, maximum: 4320 },
        deviceScaleFactor: { const: 1 },
        qualityProfile: { type: 'string', minLength: 1, maxLength: 64 },
        readinessTimeoutMs: { type: 'integer', minimum: 1000, maximum: 120000 },
        settleFrames: { type: 'integer', minimum: 2, maximum: 10 },
        fixedTimeSeconds: { type: 'number', minimum: 0, maximum: 86400 },
      },
    },
    courses: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'cacheFile', 'expectedName', 'frames'],
        properties: {
          id: { type: 'string', pattern: ID_PATTERN },
          cacheFile: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*[.]json$' },
          expectedName: { type: 'string', minLength: 1, maxLength: 256 },
          hdPolicy: { enum: ['required', 'optional', 'forbidden'] },
          frames: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'role', 'mode', 'band', 'judges'],
              properties: {
                id: { type: 'string', pattern: ID_PATTERN },
                role: { enum: ROLES },
                target: { enum: ['canvas', 'page'] },
                mode: { enum: ['idle', 'free'] },
                band: { enum: BANDS },
                pose: poseSchema,
                judges: {
                  type: 'array',
                  minItems: 1,
                  items: { type: 'string', minLength: 1, maxLength: 160 },
                },
              },
              allOf: [{
                if: { properties: { mode: { const: 'free' } }, required: ['mode'] },
                then: { properties: { pose: poseSchema }, required: ['pose'] },
              }],
            },
          },
        },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true, strict: true });
const validateShape = ajv.compile(suiteSchema);

export class VisualCaptureError extends Error {
  constructor(code, message, { stage = 'configuration', recovery, details = {}, cause } = {}) {
    super(`${code}: ${message}`, cause ? { cause } : undefined);
    this.name = 'VisualCaptureError';
    this.code = code;
    this.stage = stage;
    this.recovery = recovery;
    this.details = details;
  }

  toJSON() {
    return {
      ok: false,
      code: this.code,
      stage: this.stage,
      message: this.message.replace(`${this.code}: `, ''),
      ...(this.recovery ? { recovery: this.recovery } : {}),
      details: this.details,
    };
  }
}

function ajvIssue(error) {
  let issuePath = error.instancePath || '';
  if (error.keyword === 'additionalProperties') issuePath += `/${error.params.additionalProperty}`;
  if (error.keyword === 'required') issuePath += `/${error.params.missingProperty}`;
  return { path: issuePath || '/', message: error.message, keyword: error.keyword };
}

function addIssue(issues, issuePath, message, keyword = 'contract') {
  issues.push({ path: issuePath, message, keyword });
}

export function validateSuite(input) {
  const value = structuredClone(input);
  const shapeOk = validateShape(value);
  const issues = shapeOk ? [] : validateShape.errors.map(ajvIssue);
  if (shapeOk) {
    value.capture.qualityProfile ??= 'current-default';
    value.capture.readinessTimeoutMs ??= 45000;
    value.capture.settleFrames ??= 3;
    value.capture.fixedTimeSeconds ??= 12;
    const courseIds = new Set();
    value.courses.forEach((course, courseIndex) => {
      const coursePath = `/courses/${courseIndex}`;
      if (courseIds.has(course.id)) addIssue(issues, `${coursePath}/id`, `duplicate course id "${course.id}"`, 'unique');
      courseIds.add(course.id);
      course.hdPolicy ??= 'optional';
      const frameIds = new Set();
      const roleCounts = new Map();
      course.frames.forEach((frameValue, frameIndex) => {
        const framePath = `${coursePath}/frames/${frameIndex}`;
        if (frameIds.has(frameValue.id)) addIssue(issues, `${framePath}/id`, `duplicate frame id "${frameValue.id}"`, 'unique');
        frameIds.add(frameValue.id);
        roleCounts.set(frameValue.role, (roleCounts.get(frameValue.role) || 0) + 1);
        frameValue.target ??= frameValue.role === 'ui' ? 'page' : 'canvas';
        if (frameValue.role === 'ui' && frameValue.target !== 'page') {
          addIssue(issues, `${framePath}/target`, 'ui role must target page');
        }
      });
      if (value.id === 'baseline') {
        const invalidRoles = ROLES.filter((role) => roleCounts.get(role) !== 1);
        if (invalidRoles.length) {
          addIssue(issues, `${coursePath}/frames`, `baseline requires each proof role exactly once; invalid: ${invalidRoles.join(', ')}`, 'proofRoles');
        }
        const presentBands = new Set(course.frames.map((frameValue) => frameValue.band));
        const missingBands = BANDS.filter((band) => !presentBands.has(band));
        if (missingBands.length) {
          addIssue(issues, `${coursePath}/frames`, `baseline requires all viewing bands; missing: ${missingBands.join(', ')}`, 'viewingBands');
        }
      }
    });
  }
  if (issues.length) {
    throw new VisualCaptureError('SUITE_INVALID', 'Suite configuration failed validation', {
      details: { issues },
      recovery: 'Fix the listed JSON paths and rerun.',
    });
  }
  return value;
}

export function resolveSuite(specifier, { root = ROOT, existsSync = fs.existsSync } = {}) {
  if (!specifier || typeof specifier !== 'string') {
    throw new VisualCaptureError('ARGS_INVALID', 'A suite ID or path is required');
  }
  const isExplicit = path.isAbsolute(specifier) || specifier.includes('/') || specifier.includes('\\') || specifier.endsWith('.json');
  const suitePath = isExplicit
    ? path.resolve(root, specifier)
    : path.join(root, 'tools', 'visual-capture', 'suites', `${specifier}.json`);
  if (!existsSync(suitePath)) {
    throw new VisualCaptureError('SUITE_NOT_FOUND', `Suite not found: ${specifier}`, {
      details: { specifier, expectedPath: suitePath },
    });
  }
  return { kind: isExplicit ? 'explicit' : 'built-in', path: suitePath };
}

function valueAfter(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new VisualCaptureError('ARGS_INVALID', `${flag} requires a value`);
  return value;
}

export function parseCliArgs(argv) {
  const mode = argv[0];
  if (!['capture', 'smoke', 'perf', 'compare'].includes(mode)) {
    throw new VisualCaptureError('ARGS_INVALID', `Mode must be capture, smoke, perf, or compare; got ${mode || '<missing>'}`);
  }
  if (mode === 'compare') {
    const comparison = { mode, threshold: 2 };
    for (let index = 1; index < argv.length; index += 1) {
      const flag = argv[index];
      if (!['--before', '--after', '--output', '--threshold'].includes(flag)) {
        throw new VisualCaptureError('ARGS_INVALID', `Unknown argument: ${flag}`);
      }
      const value = valueAfter(argv, index, flag);
      index += 1;
      if (flag === '--before') comparison.before = value;
      else if (flag === '--after') comparison.after = value;
      else if (flag === '--output') comparison.output = value;
      else comparison.threshold = Number(value);
    }
    if (!comparison.before || !comparison.after) {
      throw new VisualCaptureError('ARGS_INVALID', 'compare requires both --before and --after run directories');
    }
    if (!Number.isInteger(comparison.threshold) || comparison.threshold < 0 || comparison.threshold > 255) {
      throw new VisualCaptureError('ARGS_INVALID', '--threshold must be an integer from 0 to 255');
    }
    return comparison;
  }
  const output = {
    mode,
    suite: mode === 'smoke' ? 'synthetic-smoke' : 'baseline',
    port: 0,
    courseTimeoutMs: mode === 'perf' ? 900000 : 180000,
    requireClean: false,
    showWindow: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--require-clean') output.requireClean = true;
    else if (flag === '--show-window') output.showWindow = true;
    else if (['--suite', '--data-dir', '--output', '--port', '--course-timeout-ms'].includes(flag)) {
      const value = valueAfter(argv, index, flag);
      index += 1;
      if (flag === '--suite') output.suite = value;
      else if (flag === '--data-dir') output.dataDir = value;
      else if (flag === '--output') output.output = value;
      else if (flag === '--port') output.port = Number(value);
      else output.courseTimeoutMs = Number(value);
    } else {
      throw new VisualCaptureError('ARGS_INVALID', `Unknown argument: ${flag}`);
    }
  }
  if (!Number.isInteger(output.port) || output.port < 0 || output.port > 65535) {
    throw new VisualCaptureError('ARGS_INVALID', '--port must be an integer from 0 to 65535');
  }
  if (!Number.isInteger(output.courseTimeoutMs) || output.courseTimeoutMs < 1000) {
    throw new VisualCaptureError('ARGS_INVALID', '--course-timeout-ms must be an integer of at least 1000');
  }
  return output;
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function directoryContentHash(root) {
  const entries = [];
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.join(prefix, entry.name).replaceAll('\\', '/');
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) entries.push(`${relative}\0${sha256(fs.readFileSync(absolute))}`);
    }
  }
  visit(root);
  return sha256(entries.join('\n'));
}

export function buildSharedRootManifest(root, { sourceKind = 'explicit' } = {}) {
  const absoluteRoot = path.resolve(root);
  return {
    sourceKind,
    rootBasename: path.basename(absoluteRoot),
    contentHash: directoryContentHash(absoluteRoot),
  };
}

export function hydrationCommand(course) {
  return `npm start # search for "${course.expectedName}" and select it once to create ${course.cacheFile}`;
}

export function checkCourseCache(dataDir, course) {
  const expectedPath = path.join(path.resolve(dataDir), 'courses', course.cacheFile);
  if (!fs.existsSync(expectedPath) || !fs.statSync(expectedPath).isFile()) {
    throw new VisualCaptureError('COURSE_CACHE_MISSING', `Required cache is missing: ${course.cacheFile}`, {
      stage: 'course-cache',
      recovery: hydrationCommand(course),
      details: {
        expectedPath,
        expectedCourse: course.expectedName,
        cacheFile: course.cacheFile,
      },
    });
  }
  return expectedPath;
}

export function assertCourseIdentity(cache, course) {
  if (cache?.name !== course.expectedName) {
    throw new VisualCaptureError('COURSE_IDENTITY_MISMATCH', `Expected "${course.expectedName}", got "${cache?.name || '<missing>'}"`, {
      stage: 'course-cache',
      recovery: `Remove or replace ${course.cacheFile}; do not rename a different course cache.`,
      details: { cacheFile: course.cacheFile, expectedName: course.expectedName, actualName: cache?.name },
    });
  }
  return cache;
}

export function buildCourseInputManifest(dataDir, course) {
  const cachePath = checkCourseCache(dataDir, course);
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (cause) {
    throw new VisualCaptureError('COURSE_CACHE_INVALID', `Cannot parse ${course.cacheFile}`, { stage: 'course-cache', cause });
  }
  assertCourseIdentity(cache, course);
  const coursesRoot = path.dirname(cachePath);
  const inputs = [{ kind: 'cache', basename: course.cacheFile, absolute: cachePath }];
  for (const [kind, property] of [['aerial', 'file'], ['classmap', 'classFile']]) {
    if (!cache.aerial?.[property]) continue;
    const basename = path.basename(cache.aerial[property]);
    const absolute = path.join(coursesRoot, basename);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new VisualCaptureError('COURSE_ASSET_MISSING', `Referenced ${kind} file is missing: ${basename}`, {
        stage: 'course-cache',
        recovery: `Restore ${basename} beside ${course.cacheFile}, or rehydrate ${course.expectedName}.`,
        details: { kind, basename, cacheFile: course.cacheFile, expectedPath: absolute },
      });
    }
    inputs.push({ kind, basename, absolute });
  }
  const files = inputs.map(({ kind, basename, absolute }) => ({
    kind,
    basename,
    sha256: sha256(fs.readFileSync(absolute)),
  }));
  return {
    courseId: course.id,
    cacheFile: course.cacheFile,
    expectedName: course.expectedName,
    files,
    contentHash: sha256(files.map((item) => `${item.kind}\0${item.basename}\0${item.sha256}`).join('\n')),
  };
}

export function validateJobPaths(job, { actor = 'cli' } = {}) {
  if (!job || typeof job !== 'object') throw new VisualCaptureError('JOB_INVALID', `${actor} job must be an object`);
  const root = path.resolve(job.stagingRoot || '');
  try {
    const courseOutputDir = resolveTask0Output(root, job.courseOutputDir);
    const resultFile = resolveTask0Output(root, job.resultFile);
    return { ...job, stagingRoot: root, courseOutputDir, resultFile };
  } catch (cause) {
    throw new VisualCaptureError('OUTPUT_PATH_ESCAPE', `${actor} rejected a path outside its staging root`, {
      stage: 'output',
      details: { stagingRoot: root, courseOutputDir: job.courseOutputDir, resultFile: job.resultFile },
      cause,
    });
  }
}
