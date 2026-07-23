#!/usr/bin/env node
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  ROOT,
  VisualCaptureError,
  buildCourseInputManifest,
  buildSharedRootManifest,
  canonicalizePath,
  parseCliArgs,
  resolveSuite,
  validateJobPaths,
  validateSuite,
} from './config.mjs';
import {
  comparePngBuffers,
  createComparisonReport,
  inspectComparisonPng,
  inspectNonblankPng,
} from './metrics.mjs';

const execFileAsync = promisify(childProcess.execFile);

function atomicJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

function atomicText(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, file);
}

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

function sameValue(left, right) {
  return stableJson(left) === stableJson(right);
}

function compareMismatch(mismatches, field, before, after) {
  if (!sameValue(before, after)) mismatches.push({ field, before, after });
}

function readSuccessManifest(runDir, side) {
  const manifestFile = path.join(runDir, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (cause) {
    throw new VisualCaptureError('COMPARE_MANIFEST_INVALID', `${side} manifest is missing or malformed`, {
      stage: 'compare',
      details: { side, manifest: manifestFile },
      cause,
    });
  }
  const invalid = (message, details = {}) => {
    throw new VisualCaptureError('COMPARE_MANIFEST_INVALID', `${side} manifest ${message}`, {
      stage: 'compare',
      details: { side, manifest: manifestFile, ...details },
    });
  };
  if (manifest?.ok !== true || manifest.schemaVersion !== 1) {
    invalid('is not a successful schema-v1 capture manifest');
  }
  if (!manifest.suite || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.suite.id || '') ||
      !/^[a-f0-9]{64}$/.test(manifest.suite.sha256 || '')) {
    invalid('has invalid suite identity evidence');
  }
  const capture = manifest.capture;
  if (!capture ||
      !Number.isInteger(capture.width) || capture.width <= 0 ||
      !Number.isInteger(capture.height) || capture.height <= 0 ||
      !Number.isFinite(capture.deviceScaleFactor) || capture.deviceScaleFactor <= 0 ||
      typeof capture.qualityProfile !== 'string' || !capture.qualityProfile.trim() ||
      !['shown', 'hidden'].includes(capture.windowMode)) {
    invalid('has invalid capture configuration evidence');
  }
  if (!Array.isArray(manifest.inputs) || manifest.inputs.length === 0) {
    invalid('has no course input evidence');
  }
  const inputIds = new Set();
  for (const input of manifest.inputs) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input?.courseId || '') ||
        !/^[a-f0-9]{64}$/.test(input?.contentHash || '') ||
        inputIds.has(input.courseId)) {
      invalid('has invalid or duplicate course input evidence', { courseId: input?.courseId });
    }
    inputIds.add(input.courseId);
  }
  if (!Array.isArray(manifest.results) || manifest.results.length === 0) {
    invalid('has no successful course results');
  }
  let totalFrames = 0;
  const resultIds = new Set();
  for (const course of manifest.results) {
    if (course?.ok !== true ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(course?.course || '') ||
        resultIds.has(course.course) ||
        typeof course.expectedName !== 'string' || !course.expectedName.trim() ||
        !Array.isArray(course.frames) || course.frames.length === 0) {
      invalid('has an invalid, duplicate, or empty course result', { courseId: course?.course });
    }
    resultIds.add(course.course);
    totalFrames += course.frames.length;
    const environment = course.environment;
    const gpuDevices = environment?.gpuInfo?.gpuDevice;
    const activeGpu = Array.isArray(gpuDevices)
      ? gpuDevices.find((device) => device.active)
      : null;
    if (!environment ||
        !['platform', 'arch', 'electron', 'chrome'].every((field) =>
          typeof environment[field] === 'string' && environment[field]) ||
        !environment.os ||
        !['platform', 'release', 'version', 'arch'].every((field) =>
          typeof environment.os[field] === 'string' && environment.os[field]) ||
        environment.page?.devicePixelRatio !== capture.deviceScaleFactor ||
        !activeGpu ||
        !Number.isInteger(activeGpu.vendorId) ||
        !Number.isInteger(activeGpu.deviceId) ||
        typeof activeGpu.deviceString !== 'string' || !activeGpu.deviceString ||
        typeof activeGpu.driverVersion !== 'string' || !activeGpu.driverVersion ||
        !environment.webgl ||
        !['webglVersion', 'unmaskedVendor', 'unmaskedRenderer'].every((field) =>
          typeof environment.webgl[field] === 'string' && environment.webgl[field])) {
      invalid('has incomplete OS, GPU, WebGL, or DPR identity evidence', { courseId: course.course });
    }
  }
  if (totalFrames === 0 || !sameValue([...inputIds].sort(), [...resultIds].sort())) {
    invalid('does not match non-empty course inputs to captured results', {
      inputCourseIds: [...inputIds].sort(),
      resultCourseIds: [...resultIds].sort(),
      totalFrames,
    });
  }
  return manifest;
}

function comparisonEnvironment(environment = {}) {
  const gpuDevices = Array.isArray(environment.gpuInfo?.gpuDevice)
    ? environment.gpuInfo.gpuDevice
    : [];
  const activeGpu = gpuDevices.find((device) => device.active) || gpuDevices[0] || null;
  return {
    platform: environment.platform ?? null,
    arch: environment.arch ?? null,
    os: environment.os ?? environment.osRelease ?? null,
    electron: environment.electron ?? null,
    chrome: environment.chrome ?? null,
    gpu: activeGpu && {
      vendorId: activeGpu.vendorId ?? null,
      deviceId: activeGpu.deviceId ?? null,
      deviceString: activeGpu.deviceString ?? null,
      driverVendor: activeGpu.driverVendor ?? null,
      driverVersion: activeGpu.driverVersion ?? null,
    },
    webgl: {
      webglVersion: environment.webgl?.webglVersion ?? null,
      vendor: environment.webgl?.vendor ?? null,
      renderer: environment.webgl?.renderer ?? null,
      unmaskedVendor: environment.webgl?.unmaskedVendor ?? null,
      unmaskedRenderer: environment.webgl?.unmaskedRenderer ?? null,
    },
  };
}

function manifestIndex(manifest, side) {
  const courses = new Map();
  const frames = new Map();
  for (const course of manifest.results) {
    if (!course?.course || courses.has(course.course) || !Array.isArray(course.frames)) {
      throw new VisualCaptureError('COMPARE_MANIFEST_INVALID', `${side} manifest has invalid or duplicate courses`, {
        stage: 'compare',
        details: { side, course: course?.course },
      });
    }
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(course.course)) {
      throw new VisualCaptureError('COMPARE_MANIFEST_INVALID', `${side} manifest has an unsafe course id`, {
        stage: 'compare', details: { side, course: course.course },
      });
    }
    courses.set(course.course, course);
    for (const frame of course.frames) {
      const key = `${course.course}\0${frame?.id}`;
      if (!frame?.id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(frame.id) || frames.has(key)) {
        throw new VisualCaptureError('COMPARE_MANIFEST_INVALID', `${side} manifest has invalid or duplicate frames`, {
          stage: 'compare', details: { side, course: course.course, frame: frame?.id },
        });
      }
      if (!frame.file || path.basename(frame.file) !== frame.file) {
        throw new VisualCaptureError('COMPARE_MANIFEST_INVALID', `${side} manifest has an unsafe frame artifact path`, {
          stage: 'compare', details: { side, course: course.course, frame: frame.id, file: frame.file },
        });
      }
      if (!Number.isInteger(frame.width) || frame.width <= 0 ||
          !Number.isInteger(frame.height) || frame.height <= 0 ||
          !['canvas', 'page'].includes(frame.target) ||
          typeof frame.role !== 'string' ||
          !/^[a-f0-9]{64}$/.test(frame.sha256 || '')) {
        throw new VisualCaptureError('COMPARE_MANIFEST_INVALID', `${side} manifest has incomplete frame evidence`, {
          stage: 'compare', details: { side, course: course.course, frame: frame.id },
        });
      }
      frames.set(key, { course, frame });
    }
  }
  return { courses, frames };
}

function sortedKeys(map) {
  return [...map.keys()].sort();
}

function inputHashes(manifest) {
  return (manifest.inputs || [])
    .map((input) => ({ courseId: input.courseId, contentHash: input.contentHash }))
    .sort((left, right) => String(left.courseId).localeCompare(String(right.courseId)));
}

function collectCompatibility(before, after, beforeIndex, afterIndex) {
  const mismatches = [];
  for (const field of ['id', 'sha256']) {
    compareMismatch(mismatches, `suite.${field}`, before.suite?.[field], after.suite?.[field]);
  }
  for (const field of ['width', 'height', 'deviceScaleFactor', 'qualityProfile', 'windowMode']) {
    compareMismatch(mismatches, `capture.${field}`, before.capture?.[field], after.capture?.[field]);
  }
  compareMismatch(
    mismatches, 'dataRoot.contentHash', before.dataRoot?.contentHash, after.dataRoot?.contentHash,
  );
  compareMismatch(mismatches, 'inputs', inputHashes(before), inputHashes(after));
  compareMismatch(mismatches, 'courses', sortedKeys(beforeIndex.courses), sortedKeys(afterIndex.courses));

  const beforeEnvironment = comparisonEnvironment(before.results[0]?.environment);
  const afterEnvironment = comparisonEnvironment(after.results[0]?.environment);
  for (const field of ['platform', 'arch', 'os', 'electron', 'chrome', 'gpu', 'webgl']) {
    compareMismatch(
      mismatches,
      `environment.${field}`,
      beforeEnvironment[field],
      afterEnvironment[field],
    );
  }

  compareMismatch(mismatches, 'frames', sortedKeys(beforeIndex.frames), sortedKeys(afterIndex.frames));
  for (const courseId of sortedKeys(beforeIndex.courses)) {
    const beforeCourse = beforeIndex.courses.get(courseId);
    const afterCourse = afterIndex.courses.get(courseId);
    if (!afterCourse) continue;
    compareMismatch(
      mismatches,
      'course.environment',
      { courseId, identity: comparisonEnvironment(beforeCourse.environment) },
      { courseId, identity: comparisonEnvironment(afterCourse.environment) },
    );
  }
  for (const key of sortedKeys(beforeIndex.frames)) {
    const beforeRecord = beforeIndex.frames.get(key);
    const afterRecord = afterIndex.frames.get(key);
    if (!afterRecord) continue;
    const beforeFrame = beforeRecord.frame;
    const afterFrame = afterRecord.frame;
    compareMismatch(
      mismatches,
      'frame.dimensions',
      { key, width: beforeFrame.width, height: beforeFrame.height },
      { key, width: afterFrame.width, height: afterFrame.height },
    );
    compareMismatch(
      mismatches,
      'frame.dpr',
      { key, value: beforeRecord.course.environment?.page?.devicePixelRatio },
      { key, value: afterRecord.course.environment?.page?.devicePixelRatio },
    );
    compareMismatch(
      mismatches,
      'frame.target',
      { key, value: beforeFrame.target },
      { key, value: afterFrame.target },
    );
    for (const field of ['role', 'band', 'judges', 'fixedTime', 'renderPath']) {
      compareMismatch(
        mismatches,
        `frame.${field}`,
        { key, value: beforeFrame[field] ?? null },
        { key, value: afterFrame[field] ?? null },
      );
    }
  }
  return { mismatches, environment: beforeEnvironment };
}

function safeArtifact(runDir, courseId, filename) {
  const courseDir = path.join(runDir, courseId);
  const candidate = path.join(courseDir, filename);
  let realCourse;
  let realFile;
  try {
    realCourse = fs.realpathSync(courseDir);
    realFile = fs.realpathSync(candidate);
  } catch (cause) {
    throw new VisualCaptureError('COMPARE_ARTIFACT_INVALID', 'Comparison frame artifact is missing', {
      stage: 'compare',
      details: { courseId, filename },
      cause,
    });
  }
  const relative = path.relative(realCourse, realFile);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || fs.lstatSync(candidate).isSymbolicLink()) {
    throw new VisualCaptureError('COMPARE_ARTIFACT_INVALID', 'Comparison frame artifact escapes its course directory', {
      stage: 'compare',
      details: { courseId, filename },
    });
  }
  return realFile;
}

function readVerifiedArtifact(runDir, courseId, frame) {
  const artifactPath = safeArtifact(runDir, courseId, frame.file);
  const buffer = fs.readFileSync(artifactPath);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(frame.sha256 || '') || frame.sha256 !== sha256) {
    throw new VisualCaptureError('COMPARE_ARTIFACT_INVALID', 'Comparison frame artifact hash does not match its manifest', {
      stage: 'compare',
      details: {
        courseId,
        frameId: frame.id,
        reportedSha256: frame.sha256 ?? null,
        actualSha256: sha256,
      },
    });
  }
  let decoded;
  try {
    decoded = inspectComparisonPng(buffer);
  } catch (cause) {
    throw new VisualCaptureError('COMPARE_ARTIFACT_INVALID', 'Comparison frame artifact cannot be decoded', {
      stage: 'compare',
      details: { courseId, frameId: frame.id },
      cause,
    });
  }
  if (decoded.width !== frame.width || decoded.height !== frame.height) {
    throw new VisualCaptureError('COMPARE_ARTIFACT_INVALID', 'Comparison frame dimensions contradict its manifest', {
      stage: 'compare',
      details: {
        courseId,
        frameId: frame.id,
        expected: `${frame.width}x${frame.height}`,
        actual: `${decoded.width}x${decoded.height}`,
      },
    });
  }
  return { artifactPath, buffer, sha256, ...decoded };
}

function defaultComparisonOutput(beforeDir, afterDir, root = ROOT) {
  const slug = `${path.basename(beforeDir)}--${path.basename(afterDir)}`
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 96) || 'comparison';
  const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
  return path.join(root, '.shots', 'visual', 'comparisons', `${slug}-${timestamp}`);
}

function comparisonPath(input, label) {
  try {
    return canonicalizePath(input);
  } catch (cause) {
    throw new VisualCaptureError('COMPARE_PATH_INVALID', `${label} path cannot be resolved safely`, {
      stage: 'compare',
      details: { label, path: input },
      cause,
    });
  }
}

function pathsOverlap(left, right) {
  return left === right ||
    left.startsWith(`${right}${path.sep}`) ||
    right.startsWith(`${left}${path.sep}`);
}

function assertComparisonOutputSeparated(outputDir, beforeDir, afterDir) {
  for (const [side, inputDir] of [['before', beforeDir], ['after', afterDir]]) {
    if (pathsOverlap(outputDir, inputDir)) {
      throw new VisualCaptureError('COMPARE_OUTPUT_OVERLAP', 'Comparison output must be separate from both input runs', {
        stage: 'compare',
        recovery: 'Choose an --output directory that neither contains nor is contained by an input run.',
        details: { side, input: inputDir, output: outputDir },
      });
    }
  }
}

function cleanupOwnedComparisonStaging(stagingDir, finalParent, expectedBasename) {
  if (!fs.existsSync(stagingDir)) return;
  const parent = fs.realpathSync.native(finalParent);
  const stat = fs.lstatSync(stagingDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new VisualCaptureError('COMPARE_CLEANUP_REFUSED', 'Refusing to clean a replaced comparison staging path', {
      stage: 'compare-cleanup',
      details: { stagingDir },
    });
  }
  const staging = fs.realpathSync.native(stagingDir);
  if (path.dirname(staging) !== parent || path.basename(staging) !== expectedBasename) {
    throw new VisualCaptureError('COMPARE_CLEANUP_REFUSED', 'Refusing to clean staging outside its canonical parent', {
      stage: 'compare-cleanup',
      details: { stagingDir: staging, expectedParent: parent, expectedBasename },
    });
  }
  fs.rmSync(staging, { recursive: true, force: false });
}

export function runComparison(options, {
  root = ROOT,
  stdout = process.stdout,
  stagingNonce = () => crypto.randomBytes(6).toString('hex'),
  beforePublish = () => {},
} = {}) {
  const beforeDir = comparisonPath(path.resolve(root, options.before), 'Before');
  const afterDir = comparisonPath(path.resolve(root, options.after), 'After');
  const requestedOutput = path.resolve(
    root,
    options.output || defaultComparisonOutput(beforeDir, afterDir, root),
  );
  const outputDir = comparisonPath(requestedOutput, 'Output');
  const threshold = options.threshold ?? 2;
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new VisualCaptureError('ARGS_INVALID', '--threshold must be an integer from 0 to 255');
  }
  assertComparisonOutputSeparated(outputDir, beforeDir, afterDir);
  if (fs.existsSync(outputDir)) {
    throw new VisualCaptureError('COMPARE_OUTPUT_EXISTS', 'Comparison output directory already exists', {
      stage: 'compare',
      recovery: 'Choose a new --output directory.',
      details: { output: outputDir },
    });
  }
  const before = readSuccessManifest(beforeDir, 'Before');
  const after = readSuccessManifest(afterDir, 'After');
  const beforeIndex = manifestIndex(before, 'Before');
  const afterIndex = manifestIndex(after, 'After');
  const compatibility = collectCompatibility(before, after, beforeIndex, afterIndex);
  if (compatibility.mismatches.length) {
    throw new VisualCaptureError('COMPARE_INCOMPATIBLE', 'Capture manifests are not compatible', {
      stage: 'compare',
      recovery: 'Capture both runs from the same suite, inputs, dimensions, target, and renderer environment.',
      details: { mismatches: compatibility.mismatches },
    });
  }

  const finalParent = path.dirname(outputDir);
  fs.mkdirSync(finalParent, { recursive: true });
  if (comparisonPath(outputDir, 'Output') !== outputDir) {
    throw new VisualCaptureError('COMPARE_PATH_INVALID', 'Output canonical identity changed while preparing it', {
      stage: 'compare',
      details: { output: outputDir },
    });
  }
  const nonce = stagingNonce();
  if (!/^[a-z0-9-]{1,64}$/.test(nonce)) {
    throw new VisualCaptureError('COMPARE_PATH_INVALID', 'Comparison staging nonce is invalid', {
      stage: 'compare',
    });
  }
  const stagingBasename = `${path.basename(outputDir)}.staging-${process.pid}-${nonce}`;
  const stagingDir = path.join(finalParent, stagingBasename);
  if (fs.existsSync(stagingDir) || comparisonPath(stagingDir, 'Staging') !== stagingDir) {
    throw new VisualCaptureError('COMPARE_OUTPUT_EXISTS', 'Comparison staging directory already exists or is unsafe', {
      stage: 'compare',
      details: { staging: stagingDir },
    });
  }
  fs.mkdirSync(stagingDir);
  const frames = [];
  const artifacts = [];
  try {
    fs.mkdirSync(path.join(stagingDir, 'diffs'));
    for (const key of sortedKeys(beforeIndex.frames)) {
      const beforeRecord = beforeIndex.frames.get(key);
      const afterRecord = afterIndex.frames.get(key);
      const courseId = beforeRecord.course.course;
      const beforeFrame = beforeRecord.frame;
      const afterFrame = afterRecord.frame;
      const beforeArtifact = readVerifiedArtifact(beforeDir, courseId, beforeFrame);
      const afterArtifact = readVerifiedArtifact(afterDir, courseId, afterFrame);
      const beforePath = beforeArtifact.artifactPath;
      const afterPath = afterArtifact.artifactPath;
      const diffName = `${courseId}--${beforeFrame.id}.png`;
      const stagingDiffPath = path.join(stagingDir, 'diffs', diffName);
      const publishedDiffPath = path.join(outputDir, 'diffs', diffName);
      const compared = comparePngBuffers(beforeArtifact.buffer, afterArtifact.buffer, { threshold });
      atomicText(stagingDiffPath, compared.diffPng);
      frames.push({
        courseId,
        courseLabel: beforeRecord.course.expectedName || courseId,
        frameId: beforeFrame.id,
        role: beforeFrame.role,
        target: beforeFrame.target,
        band: beforeFrame.band ?? null,
        judges: Array.isArray(beforeFrame.judges) ? beforeFrame.judges : [],
        dimensions: { width: beforeFrame.width, height: beforeFrame.height },
        devicePixelRatio: beforeRecord.course.environment?.page?.devicePixelRatio ?? before.capture?.deviceScaleFactor,
        beforeFile: `${courseId}/${beforeFrame.file}`,
        afterFile: `${courseId}/${afterFrame.file}`,
        beforeSha256: beforeArtifact.sha256,
        afterSha256: afterArtifact.sha256,
        diffFile: `diffs/${diffName}`,
        metrics: compared.metrics,
      });
      artifacts.push({ beforePath, afterPath, diffPath: publishedDiffPath });
    }
    const changedFrames = frames.filter((frame) => frame.metrics.classification === 'pixel-change').length;
    const comparison = {
      ok: true,
      schemaVersion: 1,
      suite: { id: before.suite.id, sha256: before.suite.sha256 },
      threshold,
      sources: {
        before: path.basename(beforeDir),
        after: path.basename(afterDir),
        beforeGit: before.git ?? null,
        afterGit: after.git ?? null,
      },
      environment: compatibility.environment,
      summary: {
        totalFrames: frames.length,
        changedFrames,
        pixelPass: changedFrames === 0,
        realismPass: null,
        note: 'Pixel pass is not a realism pass.',
      },
      frames,
    };
    atomicJson(path.join(stagingDir, 'comparison.json'), comparison);
    atomicText(path.join(stagingDir, 'report.md'), createComparisonReport({
      comparison,
      artifacts,
      outputDir,
      beforeLabel: path.basename(beforeDir),
      afterLabel: path.basename(afterDir),
    }));
    beforePublish({ stagingDir, finalDir: outputDir, comparison });
    fs.renameSync(stagingDir, outputDir);
    const summary = {
      ok: true,
      output: outputDir,
      frames: frames.length,
      changedFrames,
      pixelPass: changedFrames === 0,
    };
    stdout.write(`${JSON.stringify(summary)}\n`);
    return summary;
  } catch (error) {
    try {
      cleanupOwnedComparisonStaging(stagingDir, finalParent, stagingBasename);
    } catch (cleanupError) {
      error.cleanupFailure = cleanupError.toJSON?.() || {
        code: cleanupError.code,
        message: cleanupError.message,
      };
    }
    throw error;
  }
}

export async function cleanupRecordedChild(pid, {
  platform = process.platform,
  execFile = execFileAsync,
  kill = process.kill,
  force = true,
  commandTimeoutMs = 5000,
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new VisualCaptureError('CLEANUP_FAILED', `Refusing invalid child PID: ${pid}`);
  }
  try {
    if (platform === 'win32') {
      await execFile(
        'taskkill',
        ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
        { timeout: commandTimeoutMs, windowsHide: true },
      );
    } else {
      // Electron is spawned detached on POSIX, so the negative direct PID names
      // only its process group. No process-name scan is ever used.
      kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
    }
  } catch (cause) {
    if (cause?.code !== 'ESRCH' && cause?.code !== 128) {
      throw new VisualCaptureError('CLEANUP_FAILED', `Could not stop child PID ${pid}`, {
        stage: 'cleanup',
        details: { pid },
        cause,
      });
    }
  }
}

function withDeadline(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} did not complete within ${timeoutMs} ms`)),
      timeoutMs,
    );
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function childResultInvalid(message, details = {}, cause) {
  return new VisualCaptureError('CHILD_RESULT_INVALID', message, {
    stage: 'child',
    details,
    cause,
  });
}

export function validateChildResult(job, result) {
  if (!result || result.ok !== true || !job?.course || !job?.capture || !job?.courseOutputDir) {
    throw childResultInvalid('Child result is missing its requested job contract', {
      expectedCourse: job?.course?.id,
      actualCourse: result?.course,
    });
  }
  if (result.course !== job.course.id || !Array.isArray(result.frames)) {
    throw childResultInvalid('Child result does not match the requested course/frame contract', {
      expectedCourse: job.course.id,
      actualCourse: result.course,
    });
  }
  const expectedFrames = job.course.frames;
  if (result.frames.length !== expectedFrames.length) {
    throw childResultInvalid('Child result frame count does not match the request', {
      expectedFrames: expectedFrames.map((frame) => frame.id),
      actualFrames: result.frames.map((frame) => frame?.id),
    });
  }
  const actualById = new Map();
  for (const frame of result.frames) {
    if (!frame?.id || actualById.has(frame.id)) {
      throw childResultInvalid('Child result contains a missing or duplicate frame id', {
        actualFrames: result.frames.map((item) => item?.id),
      });
    }
    actualById.set(frame.id, frame);
  }
  const validatedFrames = expectedFrames.map((expected) => {
    const actual = actualById.get(expected.id);
    const expectedTarget = expected.target || (expected.role === 'ui' ? 'page' : 'canvas');
    const expectedFile = `${expected.id}.png`;
    if (!actual ||
        actual.role !== expected.role ||
        actual.target !== expectedTarget ||
        actual.file !== expectedFile ||
        !Number.isFinite(actual.fixedTime) ||
        actual.renderPath !== 'postfx.render') {
      throw childResultInvalid('Child frame metadata does not exactly match the request', {
        frameId: expected.id,
        expected: {
          id: expected.id, role: expected.role, target: expectedTarget, file: expectedFile,
          fixedTime: 'finite', renderPath: 'postfx.render',
        },
        actual: actual && {
          id: actual.id, role: actual.role, target: actual.target, file: actual.file,
          fixedTime: actual.fixedTime, renderPath: actual.renderPath,
        },
      });
    }
    const artifactPath = path.join(job.courseOutputDir, expectedFile);
    let buffer;
    try {
      buffer = fs.readFileSync(artifactPath);
    } catch (cause) {
      throw childResultInvalid('Child frame artifact is missing or unreadable', {
        frameId: expected.id,
        expectedFile,
      }, cause);
    }
    let image;
    try {
      image = inspectNonblankPng(buffer, {
        expectedWidth: job.capture.width,
        expectedHeight: job.capture.height,
      });
    } catch (cause) {
      throw childResultInvalid('Child frame artifact failed PNG validation', {
        frameId: expected.id,
        expectedFile,
        imageError: cause.message,
      }, cause);
    }
    if (typeof actual.sha256 !== 'string' || actual.sha256 !== image.sha256) {
      throw childResultInvalid('Child frame artifact hash does not match the reported sha256', {
        frameId: expected.id,
        expectedFile,
        reportedSha256: actual.sha256,
        actualSha256: image.sha256,
      });
    }
    return { ...actual, ...image };
  });
  const evidenceValid =
    result.environment?.capability?.qualifying === true &&
    result.environment?.page?.devicePixelRatio === 1 &&
    typeof result.environment?.gpuFeatureStatus === 'object' &&
    typeof result.environment?.webgl?.webglVersion === 'string' &&
    result.performance?.renderer?.resetPoint?.name === 'after-warmup-before-timed-sample' &&
    result.performance?.renderer?.aggregation === 'cumulative-across-postfx-passes-during-timed-sample' &&
    typeof result.performance?.cpu === 'object' &&
    typeof result.performance?.gpu?.supported === 'boolean' &&
    Array.isArray(result.pageConsole) &&
    !result.pageConsole.some((entry) => entry?.level === 'error') &&
    Array.isArray(result.fatalEvents) &&
    result.fatalEvents.length === 0;
  if (!evidenceValid) {
    throw childResultInvalid('Child result is missing required capability, renderer, timing, or event evidence', {
      expectedCourse: job.course.id,
    });
  }
  return { ...result, frames: validatedFrames };
}

export function runCourseChild(job, {
  electronPath,
  runnerPath,
  spawnImpl = childProcess.spawn,
  env = process.env,
  timeoutMs,
  cleanup = cleanupRecordedChild,
  cleanupGraceMs = 1000,
  escalationGraceMs = 1000,
  cleanupRequestTimeoutMs = 5000,
  stderr = process.stderr,
} = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawnImpl(electronPath, [runnerPath, '--job', job.jobFile], {
      cwd: ROOT,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    let state = 'running';
    let timer;
    let closeOutcome = null;
    const closeWaiters = new Set();
    const observeClose = (code, signal) => {
      closeOutcome = { code, signal };
      for (const waiter of closeWaiters) waiter(closeOutcome);
      closeWaiters.clear();
    };
    const waitForClose = (graceMs) => {
      if (closeOutcome) return Promise.resolve(closeOutcome);
      return new Promise((resolveClose) => {
        const waiter = (outcome) => {
          clearTimeout(graceTimer);
          resolveClose(outcome);
        };
        const graceTimer = setTimeout(() => {
          closeWaiters.delete(waiter);
          resolveClose(null);
        }, graceMs);
        closeWaiters.add(waiter);
      });
    };
    const finishRunning = (callback) => {
      if (state !== 'running') return;
      state = 'done';
      clearTimeout(timer);
      callback();
    };
    // stdout is deliberately treated as human noise, never as protocol.
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (chunk) => stderr.write(chunk));
    let terminationChildError = null;
    child.once('error', (cause) => {
      if (state === 'terminating') {
        terminationChildError = cause;
        return;
      }
      finishRunning(() => reject(new VisualCaptureError('CHILD_START_FAILED', 'Electron child failed to start', {
        stage: 'child', cause,
      })));
    });
    child.once('close', (code, signal) => {
      observeClose(code, signal);
      finishRunning(() => {
        if (!fs.existsSync(job.resultFile)) {
          reject(new VisualCaptureError('CHILD_RESULT_MISSING', `Child exited ${code ?? signal} without a result file`, {
            stage: 'child', details: { pid: child.pid, code, signal, resultFile: job.resultFile },
          }));
          return;
        }
        let result;
        try {
          result = JSON.parse(fs.readFileSync(job.resultFile, 'utf8'));
        } catch (cause) {
          reject(new VisualCaptureError('CHILD_RESULT_INVALID', 'Child result file is malformed', {
            stage: 'child', details: { resultFile: job.resultFile }, cause,
          }));
          return;
        }
        if (result?.ok) {
          try {
            result = validateChildResult(job, result);
          } catch (error) {
            reject(error);
            return;
          }
        }
        if (code !== 0 || !result?.ok) {
          reject(new VisualCaptureError(result?.code || 'CHILD_FAILED', result?.message || `Child exited with code ${code}`, {
            stage: result?.stage || 'child', details: { pid: child.pid, code, signal, result },
          }));
          return;
        }
        resolve(result);
      });
    });
    timer = setTimeout(async () => {
      if (state !== 'running') return;
      state = 'terminating';
      const diagnostics = {
        gracefulRequested: true,
        gracefulError: null,
        escalated: false,
        escalationError: null,
        terminationObserved: false,
        close: null,
        childError: null,
      };
      try {
        await withDeadline(
          cleanup(child.pid, { force: false, commandTimeoutMs: cleanupRequestTimeoutMs }),
          cleanupRequestTimeoutMs,
          'graceful cleanup request',
        );
      } catch (error) {
        diagnostics.gracefulError = error?.stack || String(error);
      }
      let observed = await waitForClose(cleanupGraceMs);
      if (!observed) {
        diagnostics.escalated = true;
        try {
          await withDeadline(
            cleanup(child.pid, { force: true, commandTimeoutMs: cleanupRequestTimeoutMs }),
            cleanupRequestTimeoutMs,
            'forced cleanup request',
          );
        } catch (error) {
          diagnostics.escalationError = error?.stack || String(error);
        }
        observed = await waitForClose(escalationGraceMs);
      }
      diagnostics.terminationObserved = Boolean(observed);
      diagnostics.close = observed;
      diagnostics.childError = terminationChildError?.stack || (terminationChildError && String(terminationChildError)) || null;
      state = 'done';
      reject(new VisualCaptureError('CHILD_TIMEOUT', `Course child exceeded ${timeoutMs} ms`, {
        stage: 'child',
        details: { pid: child.pid, timeoutMs, cleanup: diagnostics },
      }));
    }, timeoutMs);
  });
}

async function gitState({ cwd = ROOT } = {}) {
  try {
    const [{ stdout: sha }, { stdout: status }] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd }),
      execFileAsync('git', ['status', '--porcelain'], { cwd }),
    ]);
    return { sha: sha.trim(), dirty: Boolean(status.trim()) };
  } catch (cause) {
    throw new VisualCaptureError('GIT_STATE_UNAVAILABLE', 'Cannot determine Git revision/dirty state', { cause });
  }
}

function runId(suiteId) {
  return `${suiteId}-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}`;
}

export async function runCapture(options, {
  root = ROOT,
  electronPath = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
  runnerPath = path.join(root, 'tools', 'visual-capture', 'electron-runner.cjs'),
  spawnCourse = runCourseChild,
  gitStateImpl = gitState,
  runIdFactory = runId,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (options.mode === 'compare') {
    return runComparison(options, { root, stdout });
  }
  const resolvedSuite = resolveSuite(options.suite, { root });
  const suite = validateSuite(JSON.parse(fs.readFileSync(resolvedSuite.path, 'utf8')));
  const selectedCourses = options.course
    ? suite.courses.filter((course) => course.id === options.course)
    : suite.courses;
  if (options.course && selectedCourses.length !== 1) {
    throw new VisualCaptureError('COURSE_NOT_IN_SUITE', `Course "${options.course}" is not in suite "${suite.id}"`, {
      stage: 'preflight',
      recovery: 'Choose a course ID declared by the selected suite, or omit --course.',
      details: {
        course: options.course,
        suite: suite.id,
        availableCourses: suite.courses.map((course) => course.id),
      },
    });
  }
  const dataDir = path.resolve(root, options.dataDir || (options.mode === 'smoke'
    ? path.join('test', 'fixtures', 'visual-capture-data')
    : 'data'));
  const outputRoot = path.resolve(root, options.output || path.join('.shots', 'visual'));
  const git = await gitStateImpl({ cwd: root });
  if (options.requireClean && git.dirty) {
    throw new VisualCaptureError('WORKTREE_DIRTY', 'Release evidence requires a clean worktree', {
      stage: 'preflight',
      recovery: 'Commit or stash changes, then rerun with --require-clean.',
      details: git,
    });
  }
  const inputs = selectedCourses.map((course) => buildCourseInputManifest(dataDir, course));
  fs.mkdirSync(outputRoot, { recursive: true });
  const id = runIdFactory(suite.id);
  const finalDir = path.join(outputRoot, id);
  const stagingRoot = path.join(outputRoot, `${id}.staging-${process.pid}`);
  fs.mkdirSync(stagingRoot);
  const results = [];
  try {
    for (const [index, course] of selectedCourses.entries()) {
      stderr.write(`[visual] ${index + 1}/${selectedCourses.length} ${course.id}\n`);
      const courseOutputDir = path.join(stagingRoot, course.id);
      const resultFile = path.join(courseOutputDir, 'result.json');
      const jobFile = path.join(stagingRoot, `${course.id}.job.json`);
      fs.mkdirSync(courseOutputDir);
      const job = validateJobPaths({
        version: 1,
        mode: options.mode,
        suiteId: suite.id,
        stagingRoot,
        courseOutputDir,
        resultFile,
        jobFile,
        root,
        dataDir,
        server: { port: options.port, ocPort: 0 },
        showWindow: options.showWindow,
        capture: suite.capture,
        course,
      });
      atomicJson(jobFile, job);
      results.push(await spawnCourse(job, { electronPath, runnerPath, timeoutMs: options.courseTimeoutMs, stderr }));
      // Jobs contain absolute process-local paths. They are control files, not
      // shareable evidence, so remove them before publishing a successful run.
      fs.unlinkSync(jobFile);
    }
    const courseSpecs = new Map(selectedCourses.map((course) => [course.id, course]));
    const publishedResults = results.map((result) => {
      const courseSpec = courseSpecs.get(result.course);
      const frameSpecs = new Map((courseSpec?.frames || []).map((frame) => [frame.id, frame]));
      return {
        ...result,
        environment: {
          ...result.environment,
          os: {
            platform: os.platform(),
            release: os.release(),
            version: os.version(),
            arch: os.arch(),
          },
        },
        frames: result.frames.map((frame) => {
          const spec = frameSpecs.get(frame.id);
          return {
            ...frame,
            band: spec?.band ?? null,
            judges: spec?.judges ? [...spec.judges] : [],
          };
        }),
      };
    });
    const manifest = {
      ok: true,
      schemaVersion: 1,
      suite: {
        id: suite.id,
        sourceKind: resolvedSuite.kind,
        basename: path.basename(resolvedSuite.path),
        sha256: crypto.createHash('sha256').update(fs.readFileSync(resolvedSuite.path)).digest('hex'),
      },
      selection: {
        requestedCourse: options.course || null,
        courseIds: selectedCourses.map((course) => course.id),
      },
      capture: {
        ...suite.capture,
        windowMode: options.showWindow ? 'shown' : 'hidden',
      },
      git,
      evidence: git.dirty ? 'iteration-dirty' : 'clean',
      dataRoot: buildSharedRootManifest(dataDir, { sourceKind: options.dataDir ? 'explicit' : 'default' }),
      inputs,
      results: publishedResults,
    };
    atomicJson(path.join(stagingRoot, 'manifest.json'), manifest);
    fs.renameSync(stagingRoot, finalDir);
    const summary = { ok: true, output: finalDir, suite: suite.id, dirty: git.dirty };
    stdout.write(`${JSON.stringify(summary)}\n`);
    return summary;
  } catch (error) {
    const record = error instanceof VisualCaptureError
      ? error.toJSON()
      : new VisualCaptureError('CAPTURE_FAILED', error?.message || String(error), { cause: error }).toJSON();
    atomicJson(path.join(stagingRoot, 'failure.json'), { ...record, git, suite: suite.id });
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseCliArgs(argv);
    await runCapture(options);
  } catch (error) {
    const record = error instanceof VisualCaptureError
      ? error.toJSON()
      : new VisualCaptureError('CAPTURE_FAILED', error?.message || String(error), { cause: error }).toJSON();
    process.stderr.write(`${JSON.stringify(record, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
