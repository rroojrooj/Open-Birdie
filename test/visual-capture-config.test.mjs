import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { createRequire } from 'node:module';

import { normalizePerformanceRequest } from '../public/render/capture-performance.js';
import {
  VisualCaptureError,
  assertCourseIdentity,
  buildCourseInputManifest,
  buildSharedRootManifest,
  checkCourseCache,
  parseCliArgs,
  resolveSuite,
  validateJobPaths,
  validateSuite,
} from '../tools/visual-capture/config.mjs';
import {
  classifyRendererCapability,
  normalizeGpuTimerSamples,
  inspectNonblankPng,
  summarizeTimings,
} from '../tools/visual-capture/metrics.mjs';
import {
  cleanupRecordedChild,
  runCapture,
  runCourseChild,
  validateChildResult,
} from '../tools/visual-capture/cli.mjs';

const ALL_ROLES = [
  ['address', 'address'],
  ['close-green', 'feature'],
  ['close-bunker', 'feature'],
  ['landing', 'hole'],
  ['hole-overview', 'hole'],
  ['high-overview', 'overview'],
  ['horizon', 'horizon'],
  ['ui', 'ui'],
];
const require = createRequire(import.meta.url);
const { buildPerformanceRequest } = require('../tools/visual-capture/performance-request.cjs');

test('renderer capability rejects software identities and invalid capture state', () => {
  for (const renderer of ['Google SwiftShader', 'Mesa llvmpipe', 'Software Rasterizer']) {
    const result = classifyRendererCapability({
      renderer,
      unmaskedRenderer: renderer,
      gpuFeatureStatus: { gpu_compositing: 'enabled' },
      devicePixelRatio: 1,
      innerSize: { width: 1280, height: 720 },
      drawingBufferSize: { width: 1280, height: 720 },
      expectedSize: { width: 1280, height: 720 },
      visibilityState: 'visible',
    });
    assert.equal(result.qualifying, false);
    assert.ok(result.reasons.some((reason) => reason.code === 'SOFTWARE_RENDERER'));
  }
  const invalid = classifyRendererCapability({
    renderer: 'ANGLE (NVIDIA GeForce RTX 4070 Direct3D11)',
    gpuFeatureStatus: { gpu_compositing: 'disabled_software' },
    devicePixelRatio: 2,
    innerSize: { width: 1200, height: 700 },
    drawingBufferSize: { width: 2400, height: 1400 },
    expectedSize: { width: 1280, height: 720 },
    visibilityState: 'hidden',
  });
  assert.equal(invalid.qualifying, false);
  assert.deepEqual(
    new Set(invalid.reasons.map((reason) => reason.code)),
    new Set(['GPU_COMPOSITING_DISABLED', 'DPR_MISMATCH', 'CONTENT_SIZE_MISMATCH', 'DRAWING_BUFFER_SIZE_MISMATCH', 'PAGE_NOT_VISIBLE']),
  );
});

test('renderer capability does not reject a hardware-backed exact capture', () => {
  const result = classifyRendererCapability({
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA GeForce RTX 4070 Direct3D11)',
    unmaskedVendor: 'NVIDIA Corporation',
    unmaskedRenderer: 'NVIDIA GeForce RTX 4070/PCIe/SSE2',
    gpuFeatureStatus: { gpu_compositing: 'enabled', webgl: 'enabled' },
    devicePixelRatio: 1,
    innerSize: { width: 1280, height: 720 },
    drawingBufferSize: { width: 1280, height: 720 },
    expectedSize: { width: 1280, height: 720 },
    visibilityState: 'visible',
  });
  assert.equal(result.qualifying, true);
  assert.deepEqual(result.reasons, []);
});

test('GPU timer evidence distinguishes unsupported, invalid, and disjoint samples', () => {
  assert.deepEqual(normalizeGpuTimerSamples({ supported: false, reason: 'extension-unavailable' }), {
    supported: false,
    reason: 'extension-unavailable',
    validSamples: [],
    validSampleCount: 0,
    discardedInvalid: 0,
    discardedDisjoint: 0,
  });
  const normalized = normalizeGpuTimerSamples({
    supported: true,
    samples: [
      { nanoseconds: 1200000, disjoint: false, available: true },
      { nanoseconds: 0, disjoint: false, available: true },
      { nanoseconds: 3300000, disjoint: true, available: true },
      { nanoseconds: 4400000, disjoint: false, available: false },
    ],
  });
  assert.equal(normalized.supported, true);
  assert.deepEqual(normalized.validSamples, [1.2]);
  assert.equal(normalized.validSampleCount, 1);
  assert.equal(normalized.discardedInvalid, 2);
  assert.equal(normalized.discardedDisjoint, 1);
  assert.equal(normalized.averageMs, 1.2);
});

test('capture API remains query-gated while the scene starts with a live animation loop', () => {
  const appSource = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  const sceneSource = fs.readFileSync(path.resolve('public/render/scene.js'), 'utf8');
  const gate = appSource.indexOf("if (query.get('visualCapture') === '1')");
  const api = appSource.indexOf('window.__birdie.visualCapture =');
  assert.ok(gate >= 0 && api > gate, 'capture API must only be installed inside the query gate');
  assert.match(sceneSource, /this[.]_animationLoopLive = true;\s*this[.]_captureFixedTime = null;\s*this[.]renderer[.]setAnimationLoop\(this[.]_liveFrame\)/);
  assert.match(sceneSource, /finally\s*{\s*info[.]autoReset = previousAutoReset;[\s\S]*this[.]renderer[.]setAnimationLoop\(this[.]_liveFrame\)/);
});

test('performance request defaults to diagnostic and clamps claims to 60 seconds', () => {
  assert.deepEqual(normalizePerformanceRequest(), {
    sampleDuration: 2000,
    performanceClaim: false,
    routeFrames: [],
  });
  assert.equal(normalizePerformanceRequest({ durationMs: 2000, claim: 'performance' }).sampleDuration, 60000);
  assert.equal(normalizePerformanceRequest({ durationMs: 90000, claim: 'performance' }).sampleDuration, 90000);
  assert.equal(normalizePerformanceRequest({ durationMs: 100, claim: 'diagnostic-only' }).sampleDuration, 250);
});

test('runner performance request uses 60 seconds only for perf jobs', () => {
  assert.deepEqual(buildPerformanceRequest({ mode: 'perf' }, [{ id: 'route-a' }]), {
    durationMs: 60000,
    claim: 'performance',
    route: [{ id: 'route-a' }],
  });
  assert.deepEqual(buildPerformanceRequest({ mode: 'smoke' }, []), {
    durationMs: 2000,
    claim: 'diagnostic-only',
    route: [],
  });
});

function frame(role, band, index) {
  const out = {
    id: `${role}-${index}`,
    role,
    band,
    mode: role === 'address' ? 'idle' : 'free',
    judges: ['composition'],
  };
  if (out.mode === 'free') {
    out.pose = { tx: index, ty: index, dist: 100, pitch: -30, yaw: 0, hOff: 0 };
  }
  if (role === 'ui') out.target = 'page';
  return out;
}

function suite(overrides = {}) {
  const base = {
    schemaVersion: 1,
    id: 'baseline',
    capture: {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      qualityProfile: 'current-default',
      readinessTimeoutMs: 45000,
      settleFrames: 3,
      fixedTimeSeconds: 12,
    },
    courses: [{
      id: 'synthetic',
      cacheFile: 'synthetic-visual.json',
      expectedName: 'Open Birdie Synthetic Visual',
      hdPolicy: 'forbidden',
      frames: ALL_ROLES.map(([role, band], index) => frame(role, band, index)),
    }],
  };
  return { ...base, ...overrides };
}

function expectIssue(mutator, expectedPath) {
  const value = structuredClone(suite());
  mutator(value);
  assert.throws(
    () => validateSuite(value),
    (error) => error instanceof VisualCaptureError &&
      error.code === 'SUITE_INVALID' &&
      error.details.issues.some((issue) => issue.path === expectedPath),
  );
}

test('suite resolver accepts built-in IDs and explicit JSON paths', () => {
  const root = path.resolve('.');
  const builtIn = resolveSuite('synthetic-smoke', { root });
  assert.equal(builtIn.kind, 'built-in');
  assert.equal(builtIn.path, path.join(root, 'tools', 'visual-capture', 'suites', 'synthetic-smoke.json'));

  const explicitFile = path.join(root, 'test', 'fixture.json');
  fs.writeFileSync(explicitFile, '{}');
  const explicit = resolveSuite('.\\test\\fixture.json', { root });
  assert.equal(explicit.kind, 'explicit');
  assert.equal(explicit.path, path.join(root, 'test', 'fixture.json'));
  fs.unlinkSync(explicitFile);
  assert.throws(() => resolveSuite('does-not-exist', { root }), /SUITE_NOT_FOUND/);
});

test('valid v1 suite receives normalized capture and frame defaults', () => {
  const value = suite();
  delete value.capture.qualityProfile;
  delete value.capture.readinessTimeoutMs;
  delete value.capture.settleFrames;
  delete value.capture.fixedTimeSeconds;
  delete value.courses[0].hdPolicy;
  const normalized = validateSuite(value);
  assert.deepEqual(normalized.capture, {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    qualityProfile: 'current-default',
    readinessTimeoutMs: 45000,
    settleFrames: 3,
    fixedTimeSeconds: 12,
  });
  assert.equal(normalized.courses[0].hdPolicy, 'optional');
  assert.equal(normalized.courses[0].frames[0].target, 'canvas');
  assert.equal(normalized.courses[0].frames.at(-1).target, 'page');
});

test('suite validation reports exact JSON paths for closed/numeric/enum constraints', () => {
  expectIssue((v) => { v.extra = true; }, '/extra');
  expectIssue((v) => { v.courses[0].cacheFile = '../escape.json'; }, '/courses/0/cacheFile');
  expectIssue((v) => { v.courses[0].frames[0].band = 'space'; }, '/courses/0/frames/0/band');
  expectIssue((v) => { v.courses[0].frames[0].role = 'portrait'; }, '/courses/0/frames/0/role');
  expectIssue((v) => { v.courses[0].hdPolicy = 'maybe'; }, '/courses/0/hdPolicy');
  expectIssue((v) => { v.capture.deviceScaleFactor = 2; }, '/capture/deviceScaleFactor');
  expectIssue((v) => { v.capture.width = 200; }, '/capture/width');
  expectIssue((v) => { v.capture.height = 5000; }, '/capture/height');
  expectIssue((v) => { v.courses[0].frames[1].pose.tx = 'NaN'; }, '/courses/0/frames/1/pose/tx');
});

test('suite validation rejects duplicate IDs, incomplete poses, target mismatch, and missing proof roles', () => {
  expectIssue((v) => { v.courses.push(structuredClone(v.courses[0])); }, '/courses/1/id');
  expectIssue((v) => { v.courses[0].frames[1].id = v.courses[0].frames[0].id; }, '/courses/0/frames/1/id');
  expectIssue((v) => { delete v.courses[0].frames[1].pose.yaw; }, '/courses/0/frames/1/pose/yaw');
  expectIssue((v) => { v.courses[0].frames.at(-1).target = 'canvas'; }, '/courses/0/frames/7/target');
  expectIssue((v) => { v.courses[0].frames.pop(); }, '/courses/0/frames');
});

test('CLI parser recognizes all modes and capture flags', () => {
  for (const mode of ['capture', 'smoke', 'perf', 'compare']) {
    assert.equal(parseCliArgs([mode]).mode, mode);
  }
  assert.equal(parseCliArgs(['perf']).courseTimeoutMs, 900000);
  assert.equal(parseCliArgs(['smoke']).courseTimeoutMs, 180000);
  assert.deepEqual(parseCliArgs([
    'capture', '--suite', 'baseline', '--data-dir', '.\\data', '--output', '.\\out',
    '--port', '8123', '--course-timeout-ms', '9000', '--require-clean', '--show-window',
  ]), {
    mode: 'capture',
    suite: 'baseline',
    dataDir: '.\\data',
    output: '.\\out',
    port: 8123,
    courseTimeoutMs: 9000,
    requireClean: true,
    showWindow: true,
  });
  assert.throws(() => parseCliArgs(['unknown']), /ARGS_INVALID/);
});

test('timing summary excludes warmup and computes median, p95, average FPS, and 1%-low', () => {
  const result = summarizeTimings([999, 10, 20, 30, 40, 50], { warmupSamples: 1 });
  assert.equal(result.samples, 5);
  assert.equal(result.averageMs, 30);
  assert.equal(result.medianMs, 30);
  assert.equal(result.p95Ms, 50);
  assert.equal(result.worstMs, 50);
  assert.equal(result.averageFps, 33.333);
  assert.equal(result.onePercentLowFps, 20);
});

function pngBuffer(width, height, pixel) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    const rgba = pixel(i / 4);
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

test('nonblank detector rejects transparent, black, and one-color placeholders', () => {
  assert.throws(() => inspectNonblankPng(pngBuffer(4, 4, () => [0, 0, 0, 0])), /IMAGE_INVALID/);
  assert.throws(() => inspectNonblankPng(pngBuffer(4, 4, () => [0, 0, 0, 255])), /IMAGE_INVALID/);
  assert.throws(() => inspectNonblankPng(pngBuffer(4, 4, () => [20, 30, 40, 255])), /IMAGE_INVALID/);
  const valid = inspectNonblankPng(pngBuffer(4, 4, (i) => i % 2 ? [20, 30, 40, 255] : [200, 180, 90, 255]));
  assert.equal(valid.width, 4);
  assert.ok(valid.luminanceRange > 8);
});

test('internal roots are absolute while shared root manifest does not leak them', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-roots-'));
  const nested = path.join(temp, 'private-user-name', 'data');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'marker'), 'content');
  const manifest = buildSharedRootManifest(nested, { sourceKind: 'explicit' });
  assert.deepEqual(Object.keys(manifest).sort(), ['contentHash', 'rootBasename', 'sourceKind']);
  assert.equal(manifest.rootBasename, 'data');
  assert.equal(JSON.stringify(manifest).includes(temp), false);
});

test('course cache manifest hashes cache plus referenced aerial/classmap without leaking roots', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-cache-'));
  const courses = path.join(temp, 'courses');
  fs.mkdirSync(courses);
  fs.writeFileSync(path.join(courses, 'a.jpg'), 'aerial');
  fs.writeFileSync(path.join(courses, 'c.png'), 'classes');
  fs.writeFileSync(path.join(courses, 'course.json'), JSON.stringify({
    name: 'Exact Course',
    aerial: { file: path.join(courses, 'a.jpg'), classFile: path.join(courses, 'c.png') },
  }));
  const manifest = buildCourseInputManifest(temp, {
    cacheFile: 'course.json', expectedName: 'Exact Course',
  });
  assert.deepEqual(manifest.files.map((x) => x.kind), ['cache', 'aerial', 'classmap']);
  assert.equal(JSON.stringify(manifest).includes(temp), false);
  assert.match(manifest.contentHash, /^[a-f0-9]{64}$/);
});

test('a cache that references a missing visual asset fails before capture', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-cache-missing-asset-'));
  const courses = path.join(temp, 'courses');
  fs.mkdirSync(courses);
  fs.writeFileSync(path.join(courses, 'course.json'), JSON.stringify({
    name: 'Exact Course',
    aerial: { file: path.join(courses, 'missing.jpg') },
  }));
  assert.throws(
    () => buildCourseInputManifest(temp, {
      id: 'exact-course', cacheFile: 'course.json', expectedName: 'Exact Course',
    }),
    (error) => error.code === 'COURSE_ASSET_MISSING' &&
      error.details.kind === 'aerial' &&
      error.details.expectedPath === path.join(courses, 'missing.jpg'),
  );
});

test('missing cache is typed and includes exact recovery command', () => {
  const dataDir = path.join(os.tmpdir(), 'missing-birdie-data');
  assert.throws(
    () => checkCourseCache(dataDir, { cacheFile: 'missing.json', expectedName: 'Missing Golf Club' }),
    (error) => error.code === 'COURSE_CACHE_MISSING' &&
      error.details.expectedPath === path.join(dataDir, 'courses', 'missing.json') &&
      error.details.expectedCourse === 'Missing Golf Club' &&
      error.recovery === 'npm start # search for "Missing Golf Club" and select it once to create missing.json',
  );
});

test('course identity mismatch fails before capture', () => {
  assert.throws(
    () => assertCourseIdentity({ name: 'Wrong Course' }, { expectedName: 'Exact Course', cacheFile: 'course.json' }),
    (error) => error.code === 'COURSE_IDENTITY_MISMATCH' && error.stage === 'course-cache',
  );
});

test('server port 0 reports a bound port and no-autoload suppresses only startup activation', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-server-'));
  fs.mkdirSync(path.join(dataDir, 'courses'));
  fs.copyFileSync(
    path.resolve('test/fixtures/visual-capture-data/courses/synthetic-visual.json'),
    path.join(dataDir, 'courses', 'synthetic-visual.json'),
  );
  const script = `
    (async () => {
      const srv = require('./server.js');
      const ready = await srv.ready;
      const geometry = await fetch('http://127.0.0.1:' + ready.httpPort + '/api/course-geometry').then(r => r.json());
      srv.close();
      console.log('__VISUAL_RESULT__' + JSON.stringify({ httpPort: ready.httpPort, geometry }));
      setTimeout(() => process.exit(0), 20);
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  function invoke(noAutoload) {
    const run = childProcess.spawnSync(process.execPath, ['-e', script], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        BIRDIE_PORT: '0',
        BIRDIE_OC_PORT: '0',
        BIRDIE_NO_WATCH: '1',
        BIRDIE_NO_AUTOLOAD: noAutoload ? '1' : '',
        BIRDIE_DATA_DIR: dataDir,
      },
    });
    assert.equal(run.status, 0, run.stderr);
    const line = run.stdout.split(/\r?\n/).find((entry) => entry.startsWith('__VISUAL_RESULT__'));
    return JSON.parse(line.slice('__VISUAL_RESULT__'.length));
  }
  const isolated = invoke(true);
  assert.ok(isolated.httpPort > 0);
  assert.equal(isolated.geometry, null);
  const normal = invoke(false);
  assert.ok(normal.httpPort > 0);
  assert.equal(normal.geometry.name, 'Open Birdie Synthetic Visual');
});

test('parent and runner job path validation reject staging-root escapes', () => {
  const root = path.resolve(os.tmpdir(), 'owned-stage');
  const escaped = path.resolve(root, '..', 'outside', 'result.json');
  const job = { stagingRoot: root, courseOutputDir: path.join(root, 'course'), resultFile: escaped };
  assert.throws(() => validateJobPaths(job), /OUTPUT_PATH_ESCAPE/);
  assert.throws(() => validateJobPaths(job, { actor: 'runner' }), /OUTPUT_PATH_ESCAPE/);
});

test('cleanup targets only recorded PID with exact platform commands', async () => {
  const windows = [];
  await cleanupRecordedChild(4321, {
    platform: 'win32',
    execFile: async (file, args) => windows.push([file, args]),
    force: false,
  });
  await cleanupRecordedChild(4321, {
    platform: 'win32',
    execFile: async (file, args) => windows.push([file, args]),
    force: true,
  });
  assert.deepEqual(windows, [
    ['taskkill', ['/PID', '4321', '/T']],
    ['taskkill', ['/PID', '4321', '/T', '/F']],
  ]);

  const signals = [];
  await cleanupRecordedChild(9876, {
    platform: 'linux',
    kill: (pid, signal) => signals.push([pid, signal]),
    force: false,
  });
  await cleanupRecordedChild(9876, {
    platform: 'linux',
    kill: (pid, signal) => signals.push([pid, signal]),
    force: true,
  });
  assert.deepEqual(signals, [[-9876, 'SIGTERM'], [-9876, 'SIGKILL']]);
});

function artifactJob(temp) {
  return {
    courseOutputDir: temp,
    capture: { width: 4, height: 4 },
    course: {
      id: 'synthetic',
      frames: [
        { id: 'canvas-frame', role: 'high-overview', target: 'canvas' },
        { id: 'page-frame', role: 'ui', target: 'page' },
      ],
    },
  };
}

function writeArtifact(temp, id, target, {
  width = 4,
  height = 4,
  pixel = (index) => index % 2 ? [20, 30, 40, 255] : [200, 180, 90, 255],
} = {}) {
  const buffer = pngBuffer(width, height, pixel);
  const file = `${id}.png`;
  fs.writeFileSync(path.join(temp, file), buffer);
  return {
    id,
    role: target === 'page' ? 'ui' : 'high-overview',
    target,
    file,
    fixedTime: 12.5,
    renderPath: 'postfx.render',
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

function diagnosticEvidence() {
  return {
    environment: {
      capability: { qualifying: true, reasons: [] },
      page: { devicePixelRatio: 1 },
      gpuFeatureStatus: { gpu_compositing: 'enabled' },
      webgl: { webglVersion: 'WebGL 2.0' },
    },
    performance: {
      cpu: { samples: 1 },
      gpu: { supported: false, reason: 'extension-unavailable' },
      renderer: {
        resetPoint: { name: 'after-warmup-before-timed-sample' },
        aggregation: 'cumulative-across-postfx-passes-during-timed-sample',
      },
    },
    pageConsole: [],
    fatalEvents: [],
  };
}

test('child result validation accepts exact canvas/page artifacts and verifies their bytes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-result-valid-'));
  const job = artifactJob(temp);
  const result = {
    ok: true,
    course: 'synthetic',
    frames: [
      writeArtifact(temp, 'canvas-frame', 'canvas'),
      writeArtifact(temp, 'page-frame', 'page'),
    ],
    ...diagnosticEvidence(),
  };
  const validated = validateChildResult(job, result);
  assert.equal(validated.frames.length, 2);
  assert.equal(validated.frames[0].width, 4);
  assert.equal(validated.frames[1].height, 4);
});

test('child result validation rejects filename, role, target, and sha mismatches', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-result-contract-'));
  const job = artifactJob(temp);
  const canvas = writeArtifact(temp, 'canvas-frame', 'canvas');
  const page = writeArtifact(temp, 'page-frame', 'page');
  for (const mutate of [
    (result) => { result.frames[0].id = 'different-id'; },
    (result) => { result.frames[0].file = 'page-frame.png'; },
    (result) => { result.frames[0].role = 'ui'; },
    (result) => { result.frames[0].target = 'page'; },
    (result) => { result.frames[1].target = 'canvas'; },
    (result) => { result.frames[0].sha256 = '0'.repeat(64); },
    (result) => { result.frames[0].fixedTime = Number.NaN; },
    (result) => { result.frames[0].renderPath = 'renderer.render'; },
  ]) {
    const result = structuredClone({ ok: true, course: 'synthetic', frames: [canvas, page], ...diagnosticEvidence() });
    mutate(result);
    assert.throws(
      () => validateChildResult(job, result),
      (error) => error.code === 'CHILD_RESULT_INVALID',
    );
  }
});

test('child result validation requires capability, timing, reset, and event evidence', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-result-evidence-'));
  const job = artifactJob(temp);
  const base = {
    ok: true,
    course: 'synthetic',
    frames: [
      writeArtifact(temp, 'canvas-frame', 'canvas'),
      writeArtifact(temp, 'page-frame', 'page'),
    ],
    ...diagnosticEvidence(),
  };
  for (const mutate of [
    (result) => { delete result.environment.capability; },
    (result) => { delete result.environment.webgl.webglVersion; },
    (result) => { delete result.performance.renderer.resetPoint; },
    (result) => { delete result.performance.cpu; },
    (result) => { delete result.performance.gpu.supported; },
    (result) => { delete result.pageConsole; },
    (result) => { delete result.fatalEvents; },
  ]) {
    const result = structuredClone(base);
    mutate(result);
    assert.throws(
      () => validateChildResult(job, result),
      (error) => error.code === 'CHILD_RESULT_INVALID',
    );
  }
});

test('child result validation decodes every PNG and rejects wrong dimensions or blank bytes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-result-image-'));
  const job = artifactJob(temp);
  const validPage = writeArtifact(temp, 'page-frame', 'page');
  const wrongSize = writeArtifact(temp, 'canvas-frame', 'canvas', { width: 5 });
  assert.throws(
    () => validateChildResult(job, {
      ok: true, course: 'synthetic', frames: [wrongSize, validPage], ...diagnosticEvidence(),
    }),
    (error) => error.code === 'CHILD_RESULT_INVALID' && error.details.frameId === 'canvas-frame',
  );

  const blank = writeArtifact(temp, 'canvas-frame', 'canvas', {
    pixel: () => [10, 10, 10, 255],
  });
  assert.throws(
    () => validateChildResult(job, {
      ok: true, course: 'synthetic', frames: [blank, validPage], ...diagnosticEvidence(),
    }),
    (error) => error.code === 'CHILD_RESULT_INVALID' && error.details.frameId === 'canvas-frame',
  );
});

test('child protocol strips Electron-as-Node, ignores stdout, and requires valid result file', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-child-'));
  const resultFile = path.join(temp, 'result.json');
  const seen = {};
  const spawnImpl = (_exe, _args, options) => {
    seen.env = options.env;
    const listeners = new Map();
    queueMicrotask(() => listeners.get('close')?.(0, null));
    return {
      pid: 2468,
      stdout: { on() {} },
      stderr: { on() {} },
      once(name, callback) { listeners.set(name, callback); },
    };
  };
  await assert.rejects(
    runCourseChild({ resultFile }, {
      electronPath: 'electron',
      runnerPath: 'runner',
      spawnImpl,
      env: { ELECTRON_RUN_AS_NODE: '1', KEEP_ME: 'yes' },
      timeoutMs: 1000,
    }),
    (error) => error.code === 'CHILD_RESULT_MISSING',
  );
  assert.equal('ELECTRON_RUN_AS_NODE' in seen.env, false);
  assert.equal(seen.env.KEEP_ME, 'yes');

  fs.writeFileSync(resultFile, '{bad json');
  await assert.rejects(
    runCourseChild({ resultFile }, { electronPath: 'electron', runnerPath: 'runner', spawnImpl, timeoutMs: 1000 }),
    (error) => error.code === 'CHILD_RESULT_INVALID',
  );

  fs.writeFileSync(resultFile, JSON.stringify({ ok: true }));
  await assert.rejects(
    runCourseChild({
      resultFile,
      course: { id: 'synthetic', frames: [{ id: 'overview' }] },
    }, { electronPath: 'electron', runnerPath: 'runner', spawnImpl, timeoutMs: 1000 }),
    (error) => error.code === 'CHILD_RESULT_INVALID' &&
      error.details.expectedCourse === 'synthetic',
  );
});

function hangingChild(pid = 1357) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('child timeout observes graceful PID-scoped termination without escalation', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-timeout-'));
  const resultFile = path.join(temp, 'result.json');
  const child = hangingChild();
  const cleaned = [];
  await assert.rejects(
    runCourseChild({ resultFile }, {
      electronPath: 'electron',
      runnerPath: 'runner',
      spawnImpl: () => child,
      timeoutMs: 5,
      cleanupGraceMs: 10,
      escalationGraceMs: 10,
      cleanup: async (pid, options) => {
        cleaned.push([pid, options.force]);
        queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      },
    }),
    (error) => error.code === 'CHILD_TIMEOUT' &&
      error.details.cleanup.terminationObserved === true &&
      error.details.cleanup.escalated === false,
  );
  assert.deepEqual(cleaned, [[1357, false]]);
});

test('child timeout escalates only the recorded PID and verifies close', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-timeout-escalate-'));
  const child = hangingChild(2468);
  const cleaned = [];
  await assert.rejects(
    runCourseChild({ resultFile: path.join(temp, 'result.json') }, {
      electronPath: 'electron',
      runnerPath: 'runner',
      spawnImpl: () => child,
      timeoutMs: 5,
      cleanupGraceMs: 5,
      escalationGraceMs: 10,
      cleanup: async (pid, options) => {
        cleaned.push([pid, options.force]);
        if (options.force) queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
      },
    }),
    (error) => error.code === 'CHILD_TIMEOUT' &&
      error.details.cleanup.terminationObserved === true &&
      error.details.cleanup.escalated === true,
  );
  assert.deepEqual(cleaned, [[2468, false], [2468, true]]);
});

test('child timeout is bounded and preserves cleanup diagnostics when close is never observed', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-timeout-bounded-'));
  const child = hangingChild(9753);
  const started = Date.now();
  await assert.rejects(
    runCourseChild({ resultFile: path.join(temp, 'result.json') }, {
      electronPath: 'electron',
      runnerPath: 'runner',
      spawnImpl: () => child,
      timeoutMs: 5,
      cleanupGraceMs: 5,
      escalationGraceMs: 5,
      cleanupRequestTimeoutMs: 5,
      cleanup: () => new Promise(() => {}),
    }),
    (error) => error.code === 'CHILD_TIMEOUT' &&
      error.details.cleanup.terminationObserved === false &&
      error.details.cleanup.gracefulError.includes('graceful cleanup request did not complete') &&
      error.details.cleanup.escalationError.includes('forced cleanup request did not complete'),
  );
  assert.ok(Date.now() - started < 500, 'timeout cleanup must not hang');
});

test('dirty iteration is marked, require-clean rejects it, and success publishes atomically', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-transaction-'));
  const options = {
    mode: 'smoke',
    suite: 'synthetic-smoke',
    dataDir: path.resolve('test/fixtures/visual-capture-data'),
    output: outputRoot,
    port: 0,
    courseTimeoutMs: 1000,
    showWindow: false,
    requireClean: false,
  };
  const dependencies = {
    root: path.resolve('.'),
    gitStateImpl: async () => ({ sha: 'abc123', dirty: true }),
    runIdFactory: () => 'successful-run',
    spawnCourse: async (job) => {
      assert.ok(path.isAbsolute(job.dataDir));
      assert.ok(path.isAbsolute(job.courseOutputDir));
      return { ok: true, course: job.course.id, frames: [{ id: 'overview' }] };
    },
    stdout: { write() {} },
    stderr: { write() {} },
  };
  const result = await runCapture(options, dependencies);
  assert.equal(result.dirty, true);
  assert.equal(fs.existsSync(path.join(outputRoot, 'successful-run', 'manifest.json')), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(outputRoot, 'successful-run', 'manifest.json')));
  assert.equal(manifest.evidence, 'iteration-dirty');
  assert.match(manifest.suite.sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(manifest).includes(path.resolve('test/fixtures/visual-capture-data')), false);
  assert.equal(fs.readdirSync(path.join(outputRoot, 'successful-run')).some((name) => name.endsWith('.job.json')), false);
  assert.deepEqual(fs.readdirSync(outputRoot), ['successful-run']);

  await assert.rejects(
    runCapture({ ...options, requireClean: true }, {
      ...dependencies,
      runIdFactory: () => 'must-not-exist',
    }),
    (error) => error.code === 'WORKTREE_DIRTY',
  );
  assert.equal(fs.existsSync(path.join(outputRoot, 'must-not-exist')), false);
});

test('perf mode reaches the child with perf mode and the 15-minute default timeout', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-perf-route-'));
  const options = parseCliArgs([
    'perf',
    '--suite', 'synthetic-smoke',
    '--data-dir', path.resolve('test/fixtures/visual-capture-data'),
    '--output', outputRoot,
  ]);
  const seen = {};
  await runCapture(options, {
    root: path.resolve('.'),
    gitStateImpl: async () => ({ sha: 'abc123', dirty: false }),
    runIdFactory: () => 'perf-run',
    spawnCourse: async (job, childOptions) => {
      seen.job = job;
      seen.childOptions = childOptions;
      return { ok: true, course: job.course.id, frames: [{ id: 'overview' }] };
    },
    stdout: { write() {} },
    stderr: { write() {} },
  });
  assert.equal(seen.job.mode, 'perf');
  assert.equal(seen.childOptions.timeoutMs, 900000);
  await assert.rejects(
    runCapture({ ...options, mode: 'compare' }),
    (error) => error.code === 'MODE_NOT_IMPLEMENTED',
  );
});

test('failed course preserves staging evidence and never publishes success manifest', async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-failure-'));
  const options = {
    mode: 'smoke',
    suite: 'synthetic-smoke',
    dataDir: path.resolve('test/fixtures/visual-capture-data'),
    output: outputRoot,
    port: 0,
    courseTimeoutMs: 1000,
    showWindow: false,
    requireClean: false,
  };
  await assert.rejects(
    runCapture(options, {
      root: path.resolve('.'),
      gitStateImpl: async () => ({ sha: 'abc123', dirty: false }),
      runIdFactory: () => 'failed-run',
      spawnCourse: async (job) => {
        fs.writeFileSync(path.join(job.courseOutputDir, 'child-diagnostic.txt'), 'preserved');
        throw new VisualCaptureError('CHILD_FAILED', 'synthetic interruption', { stage: 'child' });
      },
      stdout: { write() {} },
      stderr: { write() {} },
    }),
    (error) => error.code === 'CHILD_FAILED',
  );
  const entries = fs.readdirSync(outputRoot);
  assert.equal(entries.length, 1);
  assert.match(entries[0], /^failed-run[.]staging-/);
  const staging = path.join(outputRoot, entries[0]);
  assert.equal(fs.existsSync(path.join(staging, 'failure.json')), true);
  assert.equal(fs.existsSync(path.join(staging, 'synthetic-visual', 'child-diagnostic.txt')), true);
  assert.equal(fs.existsSync(path.join(staging, 'manifest.json')), false);
  assert.equal(fs.existsSync(path.join(outputRoot, 'failed-run')), false);
});

test('CLI preflight failure exits non-zero with a typed actionable record', () => {
  const emptyData = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-empty-data-'));
  fs.mkdirSync(path.join(emptyData, 'courses'));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-cli-output-'));
  const run = childProcess.spawnSync(process.execPath, [
    'tools/visual-capture/cli.mjs',
    'smoke',
    '--data-dir', emptyData,
    '--output', output,
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(run.status, 1);
  const failure = JSON.parse(run.stderr);
  assert.equal(failure.code, 'COURSE_CACHE_MISSING');
  assert.equal(failure.details.expectedCourse, 'Open Birdie Synthetic Visual');
  assert.equal(failure.recovery, 'npm start # search for "Open Birdie Synthetic Visual" and select it once to create synthetic-visual.json');
});
