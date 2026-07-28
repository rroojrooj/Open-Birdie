const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'course-presentation');
const PRESENTATION_KEYS = [
  'assetKeys',
  'atmosphere',
  'character',
  'courseId',
  'diagnostics',
  'landmarks',
  'materials',
  'qualityHints',
  'surfaces',
  'tier',
  'vegetation',
  'world',
];
const PREPARED_KEYS = [
  'contentRevision',
  'courseId',
  'diagnostics',
  'presentation',
  'publicAssetManifest',
  'terrainPatches',
];
const RESOLVED_KEYS = [
  'assetManifest',
  'contentRevision',
  'courseId',
  'courseRevision',
  'diagnostics',
  'presentation',
  'terrainPatches',
];

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'));
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function assertPublicContractIsPathAndRendererFree(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /[A-Za-z]:[\\/]/, 'Windows paths are private');
  assert.doesNotMatch(serialized, /(^|["'])\/(?!api\/)/, 'filesystem-rooted paths are private');
  assert.doesNotMatch(serialized, /[.][.][\\/]/, 'traversal is never public');
  assert.doesNotMatch(serialized, /\b(?:shader|uniform|u[A-Z][A-Za-z0-9_]*)\b/, 'renderer fields are out of contract');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function createFakeLatestOnlyManager(prepare) {
  let activationGeneration = 0;
  let courseRevision = 0;
  let currentPackage = null;
  return {
    async activate(request) {
      const generation = ++activationGeneration;
      try {
        const candidate = await prepare(request);
        if (generation !== activationGeneration) return { status: 'superseded', generation };
        const resolvedPackage = Object.freeze({
          ...candidate,
          courseRevision: ++courseRevision,
        });
        currentPackage = resolvedPackage;
        return {
          status: 'committed',
          generation,
          courseRevision,
          package: resolvedPackage,
        };
      } catch {
        return {
          status: 'failed',
          generation,
          diagnostic: {
            code: 'ACTIVATION_PREPARE_FAILED',
            severity: 'error',
            stage: 'prepare',
            courseId: request.courseId,
            message: 'Course preparation failed',
            recovery: 'Retry the course activation.',
          },
        };
      }
    },
    current() {
      return currentPackage;
    },
    counters() {
      return { activationGeneration, courseRevision };
    },
  };
}

test('automatic and curated fixtures pin one normalized public interface', () => {
  const automatic = fixture('automatic-course.json');
  const curated = fixture('chambers-profile.json');

  for (const example of [automatic, curated]) {
    assert.deepEqual(sortedKeys(example.preparedCandidate), PREPARED_KEYS);
    assert.deepEqual(sortedKeys(example.resolvedPackage), RESOLVED_KEYS);
    assert.deepEqual(sortedKeys(example.preparedCandidate.presentation), PRESENTATION_KEYS);
    assert.deepEqual(sortedKeys(example.resolvedPackage.presentation), PRESENTATION_KEYS);
    assert.equal(example.preparedCandidate.courseRevision, undefined);
    assert.equal(example.resolvedPackage.courseRevision > 0, true);
    assert.equal(example.preparedCandidate.courseId, example.preparedCandidate.presentation.courseId);
    assert.equal(example.resolvedPackage.courseId, example.resolvedPackage.presentation.courseId);
    assert.match(example.preparedCandidate.contentRevision, /^[a-f0-9]{64}$/);
    assertPublicContractIsPathAndRendererFree(example);
  }

  assert.equal(automatic.preparedCandidate.presentation.tier, 'automatic');
  assert.equal(automatic.preparedCandidate.presentation.character.dryness, 0);
  assert.equal(curated.preparedCandidate.presentation.tier, 'curated');
  assert.equal(curated.preparedCandidate.presentation.character.dryness, 0.85);
});

test('same-name fixtures pin stable identity and cache separation', () => {
  const a = fixture('same-name-a.json');
  const b = fixture('same-name-b.json');

  assert.equal(a.displayName, b.displayName);
  assert.notEqual(a.expected.courseId, b.expected.courseId);
  assert.notEqual(a.expected.cacheStem, b.expected.cacheStem);
  assertPublicContractIsPathAndRendererFree(a);
  assertPublicContractIsPathAndRendererFree(b);
});

test('public asset records expose opaque delivery metadata while private records retain paths', () => {
  const contentRevision = 'c'.repeat(64);
  const publicManifest = {
    clubhouse: {
      url: `/api/course-art/${contentRevision}/clubhouse`,
      mime: 'model/gltf-binary',
      bytes: 128,
      sha256: 'd'.repeat(64),
    },
  };
  const privateManifest = {
    clubhouse: {
      absolutePath: 'C:\\private-course-art\\clubhouse.glb',
      realPath: 'C:\\private-course-art\\clubhouse.glb',
      mime: 'model/gltf-binary',
      bytes: 128,
      sha256: 'd'.repeat(64),
    },
  };

  assertPublicContractIsPathAndRendererFree(publicManifest);
  assert.match(JSON.stringify(privateManifest), /C:\\\\private-course-art/);
  assert.equal(publicManifest.clubhouse.absolutePath, undefined);
  assert.equal(publicManifest.clubhouse.realPath, undefined);
  assert.equal(privateManifest.clubhouse.url, undefined);
  assert.deepEqual(Object.keys(publicManifest), Object.keys(privateManifest));
});

test('activation generation is per request while course revision is committed-only and latest wins', async () => {
  const a = deferred();
  const b = deferred();
  const manager = createFakeLatestOnlyManager(({ courseId }) => {
    if (courseId === 'osm:way:1') return a.promise;
    if (courseId === 'osm:way:2') return b.promise;
    throw new Error('injected prepare failure');
  });

  const activateA = manager.activate({ courseId: 'osm:way:1' });
  const activateB = manager.activate({ courseId: 'osm:way:2' });
  b.resolve({ courseId: 'osm:way:2', contentRevision: '2'.repeat(64) });
  const resultB = await activateB;
  a.resolve({ courseId: 'osm:way:1', contentRevision: '1'.repeat(64) });
  const resultA = await activateA;

  assert.equal(resultB.status, 'committed');
  assert.equal(resultB.courseRevision, 1);
  assert.equal(resultA.status, 'superseded');
  assert.equal(manager.current().courseId, 'osm:way:2');
  assert.deepEqual(manager.counters(), { activationGeneration: 2, courseRevision: 1 });

  const failed = await manager.activate({ courseId: 'osm:way:3' });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.diagnostic, {
    code: 'ACTIVATION_PREPARE_FAILED',
    severity: 'error',
    stage: 'prepare',
    courseId: 'osm:way:3',
    message: 'Course preparation failed',
    recovery: 'Retry the course activation.',
  });
  assertPublicContractIsPathAndRendererFree(failed.diagnostic);
  assert.equal(manager.current().courseId, 'osm:way:2');
  assert.deepEqual(manager.counters(), { activationGeneration: 3, courseRevision: 1 });
});
