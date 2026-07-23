import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  CaptureReadinessTimeout,
  installLoadingTracker,
  validateHdPolicy,
  waitForCaptureReady,
} from '../public/render/capture-readiness.js';
import { vegetationTextureCommands } from '../public/render/vegetation.js';

const require = createRequire(import.meta.url);
const { resolveTask0Output } = require('../tools/visual-capture/output-path.cjs');

const ready = (over = {}) => ({
  course: { name: 'Synthetic Visual', revision: 1 },
  runtimeReady: true,
  environment: { state: 'ready' },
  loader: { active: [], started: 3, completed: 3, failures: [] },
  hd: { advertisedIds: [], loadedIds: [], failures: [], ack: null },
  postfx: 'effect-composer',
  ...over,
});

test('readiness timeout preserves the last snapshot and names every outstanding subsystem', async () => {
  let time = 0;
  const blocked = {
    course: null,
    runtimeReady: false,
    environment: { state: 'loading', detail: 'studio.hdr' },
    loader: { active: ['/late.png'], started: 1, completed: 0, failures: [] },
    hd: { advertisedIds: ['one', 'two'], loadedIds: [], failures: [], ack: null },
    postfx: null,
  };
  await assert.rejects(
    waitForCaptureReady({
      status: () => blocked,
      nextFrame: () => { time += 6; },
      now: () => time,
      timeoutMs: 10,
      requiredSettledFrames: 2,
      hdPolicy: 'required',
    }),
    (error) => {
      assert.ok(error instanceof CaptureReadinessTimeout);
      assert.equal(error.code, 'VISUAL_CAPTURE_TIMEOUT');
      assert.deepEqual(error.outstanding, [
        'course', 'runtime', 'environment', 'loader', 'hd-assets',
        'hd-policy:HD_ID_SET_MISMATCH', 'hd-policy:HD_ACK_REQUIRED', 'postfx',
      ]);
      for (const subsystem of error.outstanding) assert.match(error.message, new RegExp(subsystem));
      assert.equal(error.lastSnapshot.environment.state, 'loading');
      assert.deepEqual(error.lastSnapshot, blocked);
      return true;
    },
  );
});

test('required HD policy detects a middle-bundle failure and compares exact ID sets', () => {
  const middleFailure = {
    advertisedIds: ['bundle-a', 'bundle-b', 'bundle-c'],
    loadedIds: ['bundle-c', 'bundle-a'],
    failures: [{ bundleId: 'bundle-b', hole: 2, message: 'decode failed' }],
    ack: { ok: true, mode: 'hd' },
  };
  const result = validateHdPolicy(middleFailure, 'required');
  assert.equal(result.ok, false);
  assert.deepEqual(result.advertisedIds, ['bundle-a', 'bundle-b', 'bundle-c']);
  assert.deepEqual(result.loadedIds, ['bundle-a', 'bundle-c']);
  assert.deepEqual(result.failures, middleFailure.failures);
  assert.deepEqual(result.violations, ['HD_FAILURES', 'HD_ID_SET_MISMATCH']);

  assert.equal(validateHdPolicy({
    advertisedIds: ['bundle-a', 'bundle-b'],
    loadedIds: ['bundle-b', 'bundle-a'],
    failures: [],
    ack: { ok: true },
  }, 'required').ok, true);
});

test('optional HD policy settles with visible failures; forbidden requires every HD set empty', () => {
  const failedOptional = {
    advertisedIds: ['bundle-a'],
    loadedIds: [],
    failures: [{ bundleId: 'bundle-a', message: 'missing texture' }],
    ack: null,
  };
  const optional = validateHdPolicy(failedOptional, 'optional');
  assert.equal(optional.ok, true);
  assert.deepEqual(optional.failures, failedOptional.failures);
  assert.equal(validateHdPolicy({ advertisedIds: [], loadedIds: [], failures: [], ack: null }, 'forbidden').ok, true);
  assert.deepEqual(
    validateHdPolicy(failedOptional, 'forbidden').violations,
    ['HD_FORBIDDEN_ADVERTISED', 'HD_FORBIDDEN_FAILURES'],
  );
});

test('readiness requires consecutive settled frames and resets on regression', async () => {
  let time = 0;
  let polls = 0;
  const snapshots = [
    ready(),
    ready({ loader: { active: ['/late.png'], started: 1, completed: 0, failures: [] } }),
    ready(),
    ready(),
  ];
  const result = await waitForCaptureReady({
    status: () => { polls += 1; return snapshots.shift(); },
    nextFrame: () => { time += 1; },
    now: () => time,
    timeoutMs: 20,
    requiredSettledFrames: 2,
  });
  assert.equal(polls, 4);
  assert.equal(result.settledFrames, 2);
});

test('loading tracker chains existing callbacks and balances successful and failed loads', () => {
  const events = [];
  const manager = {
    itemStart(url) { events.push(['start', url]); this.onStart?.(url); },
    itemEnd(url) { events.push(['end', url]); this.onProgress?.(url); },
    itemError(url) { events.push(['error', url]); this.onError?.(url); },
    onStart(url) { events.push(['onStart', url]); },
    onProgress(url) { events.push(['onProgress', url]); },
    onError(url) { events.push(['onError', url]); },
  };
  const tracker = installLoadingTracker(manager, { now: () => 42 });
  manager.itemStart('ok.png');
  manager.itemEnd('ok.png');
  manager.itemStart('bad.png');
  manager.itemError('bad.png');
  manager.itemEnd('bad.png');

  assert.deepEqual(events, [
    ['start', 'ok.png'], ['onStart', 'ok.png'], ['end', 'ok.png'], ['onProgress', 'ok.png'],
    ['start', 'bad.png'], ['onStart', 'bad.png'], ['error', 'bad.png'], ['onError', 'bad.png'],
    ['end', 'bad.png'], ['onProgress', 'bad.png'],
  ]);
  assert.deepEqual(tracker.status(), {
    active: [],
    started: 2,
    completed: 2,
    failures: [{ url: 'bad.png', message: 'load failed' }],
    lastEventAt: 42,
  });
  assert.equal(installLoadingTracker(manager), tracker);
});

test('two independent visible vegetation texture builds have identical command checksums', () => {
  const checksum = (kind) => crypto.createHash('sha256')
    .update(JSON.stringify(vegetationTextureCommands(kind)))
    .digest('hex');
  const first = { straw: checksum('straw'), flower: checksum('flower') };
  const second = { straw: checksum('straw'), flower: checksum('flower') };
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    straw: '51671f90011740256e0bc98e160c3cefe2ee247545400cd02ec3d4135f87ee3d',
    flower: '0242e67094b71635e28c3cbf2009ae62438cee3f498a2c32e82f7bcce6e3e0d0',
  });
});

test('Task-0 output containment accepts descendants and rejects root/traversal/symlink escape', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-capture-output-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, '.shots', 'visual', 'task0-probes');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(
    resolveTask0Output(root, path.join(root, 'probe-a')),
    path.join(root, 'probe-a'),
  );
  assert.throws(() => resolveTask0Output(root, root), /OUTPUT_PATH_ROOT/);
  assert.throws(() => resolveTask0Output(root, path.join(root, '..', 'escaped')), /OUTPUT_PATH_ESCAPE/);

  const outside = path.join(temp, 'outside');
  const link = path.join(root, 'linked-outside');
  fs.mkdirSync(outside);
  try {
    fs.symlinkSync(outside, link, 'junction');
    assert.throws(() => resolveTask0Output(root, path.join(link, 'probe')), /OUTPUT_PATH_ESCAPE/);
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.diagnostic('symlink escape assertion skipped: junction creation requires Windows developer privileges');
  }
});
