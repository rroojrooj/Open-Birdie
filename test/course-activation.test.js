'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createCourseActivationManager } = require('../lib/course-activation');
const { createCourseAcquisitionCoordinator } = require('../lib/course');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function request(osmId) {
  return {
    name: `Course ${osmId}`,
    osmType: 'way',
    osmId,
  };
}

function candidate(courseId, marker = courseId) {
  return Object.freeze({
    courseId,
    contentRevision: String(courseId.split(':').at(-1) % 10).repeat(64),
    presentation: Object.freeze({ courseId, tier: 'automatic', marker }),
    terrainPatches: Object.freeze([]),
    publicAssetManifest: Object.freeze({}),
    privateAssetManifest: Object.freeze({}),
    diagnostics: Object.freeze([]),
    hdDescriptors: Object.freeze([]),
    gameplayCourse: Object.freeze({ marker }),
    preparedGameState: Object.freeze({ marker }),
  });
}

function harness({
  acquireCourse,
  prepareCandidate,
  commitPreparedActivation,
  onCommitted,
  onPrepareFailed,
} = {}) {
  const commits = [];
  const manager = createCourseActivationManager({
    acquireCourse: acquireCourse || (async (input) => ({ marker: input.osmId })),
    prepareCandidate: prepareCandidate || (async ({ source }) => candidate(source.courseId)),
    commitPreparedActivation: commitPreparedActivation || ((payload) => {
      commits.push(payload);
    }),
    onCommitted,
    onPrepareFailed,
  });
  return { manager, commits };
}

test('slow A cannot replace fast B and committed revision has no superseded gap', async () => {
  const pending = new Map();
  const { manager, commits } = harness({
    acquireCourse(input) {
      const gate = deferred();
      pending.set(input.osmId, gate);
      return gate.promise;
    },
  });

  const activateA = manager.activate(request(1));
  const activateB = manager.activate(request(2));
  pending.get(2).resolve({ marker: 'B' });
  const resultB = await activateB;
  pending.get(1).resolve({ marker: 'A' });
  const resultA = await activateA;

  assert.equal(resultB.status, 'committed');
  assert.equal(resultB.courseRevision, 1);
  assert.equal(resultA.status, 'superseded');
  assert.equal(resultA.diagnostic.code, 'ACTIVATION_SUPERSEDED');
  assert.equal(commits.length, 1);
  assert.equal(manager.current().courseId, 'osm:way:2');
  assert.equal(manager.current().courseRevision, 1);
});

test('late preparation and failed preparation preserve the previously committed package', async () => {
  const prepareA = deferred();
  const { manager, commits } = harness({
    prepareCandidate({ source }) {
      if (source.courseId === 'osm:way:1') return prepareA.promise;
      if (source.courseId === 'osm:way:3') throw new Error('C:\\Users\\alice\\secret?token=hunter2');
      return candidate(source.courseId);
    },
  });

  const activateA = manager.activate(request(1));
  const committedB = await manager.activate(request(2));
  prepareA.resolve(candidate('osm:way:1'));
  assert.equal((await activateA).status, 'superseded');
  assert.equal(committedB.status, 'committed');

  const failed = await manager.activate(request(3));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.diagnostic.code, 'ACTIVATION_PREPARE_FAILED');
  assert.doesNotMatch(JSON.stringify(failed), /alice|hunter2|secret|[A-Za-z]:\\/);
  assert.equal(manager.current().courseId, 'osm:way:2');
  assert.equal(manager.current().courseRevision, 1);
  assert.equal(commits.length, 1);
});

test('same-identity supersession shares one un-aborted acquisition and commits only the newer caller', async () => {
  const fetchGate = deferred();
  let calls = 0;
  let observedSignal;
  const coordinator = createCourseAcquisitionCoordinator((input, { signal }) => {
    calls += 1;
    observedSignal = signal;
    return fetchGate.promise;
  });
  const { manager, commits } = harness({
    acquireCourse: (input, options) => coordinator.acquire(input, options),
  });

  const first = manager.activate(request(10));
  const second = manager.activate({ ...request(10), name: 'Renamed Course' });
  assert.equal(calls, 1);
  assert.equal(observedSignal.aborted, false);
  fetchGate.resolve({ marker: 'shared' });

  assert.equal((await first).status, 'superseded');
  assert.equal((await second).status, 'committed');
  assert.equal(observedSignal.aborted, false);
  assert.equal(commits.length, 1);
});

test('different-identity supersession may abort obsolete acquisition and still commits only B', async () => {
  const pending = new Map();
  const signals = new Map();
  const coordinator = createCourseAcquisitionCoordinator((input, { source, signal }) => {
    const gate = deferred();
    pending.set(source.courseId, gate);
    signals.set(source.courseId, signal);
    signal.addEventListener('abort', () => gate.reject(Object.assign(
      new Error('aborted obsolete acquisition'),
      { name: 'AbortError' },
    )), { once: true });
    return gate.promise;
  });
  const { manager, commits } = harness({
    acquireCourse: (input, options) => coordinator.acquire(input, options),
  });

  const activateA = manager.activate(request(20));
  const activateB = manager.activate(request(21));
  assert.equal(signals.get('osm:way:20').aborted, true);
  pending.get('osm:way:21').resolve({ marker: 'B' });

  assert.equal((await activateA).status, 'superseded');
  assert.equal((await activateB).status, 'committed');
  assert.equal(commits.length, 1);
  assert.equal(manager.current().courseId, 'osm:way:21');
});

test('commit receives one coherent candidate/public revision and private lookup is revision-scoped', async () => {
  const privateEntry = Object.freeze({ realPath: 'C:\\private\\asset.png' });
  const prepared = {
    ...candidate('osm:way:30'),
    publicAssetManifest: Object.freeze({
      turf: Object.freeze({ url: '/pending', mime: 'image/png', bytes: 1, sha256: 'a'.repeat(64) }),
    }),
    privateAssetManifest: Object.freeze({ turf: privateEntry }),
    hdDescriptors: Object.freeze([{ bundleId: 'hd-30' }]),
  };
  const observer = [];
  const { manager, commits } = harness({
    prepareCandidate: async () => Object.freeze(prepared),
    onCommitted(payload) {
      observer.push(payload);
      throw new Error('observer failed after commit');
    },
  });

  const result = await manager.activate(request(30));
  assert.equal(result.status, 'committed');
  assert.equal(commits.length, 1);
  assert.equal(observer.length, 1);
  assert.equal(commits[0].candidate, prepared);
  assert.equal(commits[0].resolvedPackage, result.package);
  assert.equal(result.package.courseRevision, 1);
  assert.deepEqual(Object.keys(result.package).sort(), [
    'assetManifest',
    'contentRevision',
    'courseId',
    'courseRevision',
    'diagnostics',
    'presentation',
    'terrainPatches',
  ]);
  assert.ok(Object.isFrozen(result.package));
  assert.equal(result.observerDiagnostic.code, 'ACTIVATION_OBSERVER_FAILED');
  assert.equal(manager.lookupPrivateAsset(result.package.contentRevision, 'turf'), privateEntry);
  assert.equal(manager.lookupPrivateAsset('f'.repeat(64), 'turf'), null);
  assert.equal(manager.lookupPrivateAsset(result.package.contentRevision, 'missing'), null);
});

test('identity derivation failure is typed, redacted, and performs no acquisition or commit', async () => {
  let acquisitions = 0;
  const internalFailures = [];
  const { manager, commits } = harness({
    acquireCourse() {
      acquisitions += 1;
    },
    onPrepareFailed(error, context) {
      internalFailures.push({ error, context });
    },
  });
  const result = await manager.activate({ name: 'No source' });
  assert.equal(result.status, 'failed');
  assert.equal(result.diagnostic.code, 'ACTIVATION_PREPARE_FAILED');
  assert.equal(acquisitions, 0);
  assert.equal(commits.length, 0);
  assert.equal(manager.current(), null);
  assert.equal(internalFailures.length, 1);
  assert.match(internalFailures[0].error.message, /OpenStreetMap source type/u);
  assert.deepEqual(internalFailures[0].context, {
    generation: 1,
    courseId: null,
  });
});

test('failed request preserves the coherent Game/HD/timer snapshot and next success replaces it once', async () => {
  const commits = [];
  let live = Object.freeze({
    gameRevision: 0,
    hdRevision: 0,
    timer: Object.freeze({ revision: 0 }),
  });
  const { manager } = harness({
    prepareCandidate({ source }) {
      if (source.courseId === 'osm:way:41') throw new Error('injected preparation failure');
      return Object.freeze({
        ...candidate(source.courseId),
        hdDescriptors: Object.freeze([{ bundleId: `hd-${source.osmId}` }]),
      });
    },
    commitPreparedActivation(payload) {
      const revision = payload.resolvedPackage.courseRevision;
      assert.equal(payload.timerSpecification.courseRevision, revision);
      live = Object.freeze({
        gameRevision: revision,
        hdRevision: revision,
        timer: Object.freeze({ revision }),
      });
      commits.push({ payload, live });
    },
  });

  const first = await manager.activate(request(40));
  const firstLive = live;
  const failed = await manager.activate(request(41));
  assert.equal(first.status, 'committed');
  assert.equal(failed.status, 'failed');
  assert.equal(live, firstLive);
  assert.equal(commits.length, 1);

  const second = await manager.activate(request(42));
  assert.equal(second.status, 'committed');
  assert.notEqual(live.timer, firstLive.timer);
  assert.deepEqual(
    [live.gameRevision, live.hdRevision, live.timer.revision],
    [second.courseRevision, second.courseRevision, second.courseRevision],
  );
  assert.equal(commits.length, 2);
  assert.equal(manager.current(), second.package);
});
