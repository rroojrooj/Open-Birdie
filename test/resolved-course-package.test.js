'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');

const {
  canonicalStringify,
  canonicalUtf8,
} = require('../lib/canonical-json');
const {
  prepareCourseCandidate,
} = require('../lib/resolved-course-package');
const { loadRuntimeCourseArt } = require('../lib/course-art-assets');

const SOURCE = Object.freeze({
  courseId: 'osm:way:26787026',
  osmType: 'way',
  osmId: 26787026,
});

function baseCourse(overrides = {}) {
  return {
    version: 4,
    name: 'Chambers Bay',
    source: SOURCE,
    origin: { lat: 47.2057007, lon: -122.5750529 },
    holes: [{
      ref: 1,
      par: 4,
      tee: [0, 0],
      pin: [100, 100],
      lengthYd: 400,
      line: [[0, 0], [100, 100]],
    }],
    surfaces: [],
    boundary: null,
    elevation: null,
    ...overrides,
  };
}

function feature(id) {
  return { id, required: false, assetKeys: [], payload: {} };
}

function runtimePack(overrides = {}) {
  return {
    version: 1,
    packId: 'chambers-bay',
    courseId: SOURCE.courseId,
    displayName: 'Chambers Bay',
    legacyMatch: {
      names: ['Chambers Bay'],
      origin: { lat: 47.2057007, lon: -122.5750529, toleranceM: 250 },
    },
    presentation: {
      tier: 'curated',
      character: { biome: 'pnw-links', dryness: 0.85 },
      world: {},
      surfaces: {},
      materials: {},
      vegetation: { rules: [] },
      landmarks: { features: [] },
      atmosphere: {},
      assetKeys: [],
      qualityHints: { source: 'curated' },
    },
    gameplay: {},
    terrainPatches: [],
    capabilities: {},
    features: [],
    assets: [],
    contentRevision: 'a'.repeat(64),
    ...overrides,
  };
}

function validResult(pack) {
  return {
    status: 'valid',
    runtimePack: pack,
    diagnostics: [],
    selection: {
      mode: 'stable',
      requestedCourseId: SOURCE.courseId,
      selectedCourseId: SOURCE.courseId,
    },
  };
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ob-package-'));
}

function pngPackAt(artDir, rgba = [40, 100, 40, 255]) {
  const assetDir = path.join(artDir, 'packs', 'chambers-bay', 'assets');
  fs.mkdirSync(assetDir, { recursive: true });
  const assetPath = path.join(assetDir, 'turf.png');
  const image = new PNG({ width: 1, height: 1 });
  image.data.set(rgba);
  const bytes = PNG.sync.write(image);
  fs.writeFileSync(assetPath, bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const pack = runtimePack({
    presentation: {
      ...runtimePack().presentation,
      assetKeys: ['turf'],
    },
    assets: [{
      key: 'turf',
      file: 'assets/turf.png',
      mime: 'image/png',
      bytes: bytes.length,
      sha256,
      required: true,
      width: 1,
      height: 1,
    }],
  });
  Object.defineProperty(pack, 'assetPaths', {
    value: Object.freeze({ turf: assetPath }),
    enumerable: false,
  });
  return { assetPath, bytes, pack, sha256 };
}

function publishRuntimePack(artDir, pack) {
  const manifestPath = path.join(artDir, 'packs', pack.packId, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(pack, null, 2));
  fs.writeFileSync(path.join(artDir, 'index.json'), JSON.stringify({
    version: 1,
    packs: [{
      packId: pack.packId,
      courseId: pack.courseId,
      legacyMatch: pack.legacyMatch,
      manifest: `packs/${pack.packId}/manifest.json`,
    }],
  }, null, 2));
}

async function prepare({
  course = baseCourse(),
  packResult = { status: 'absent', runtimePack: null, diagnostics: [] },
  artDir = tempRoot(),
  resolveHd = () => ({ status: 'absent' }),
  loadLegacyOverride = () => null,
  prepareGame = (gameplayCourse, options) => ({ gameplayCourse, options }),
  packsEnabled = true,
} = {}) {
  return prepareCourseCandidate({
    baseCourse: course,
    requestedIdentity: {
      ...course.source,
      displayName: course.name,
      origin: course.origin,
    },
    packsEnabled,
    dataDir: tempRoot(),
    artDir,
    resolveHd,
    loadRuntimePack: () => packResult,
    loadLegacyOverride,
    prepareGame,
  });
}

test('canonical JSON pins NFC, negative zero, code-unit key order, and exact UTF-8 bytes', () => {
  const input = { '\ue000': 2, b: -0, a: 'e\u0301', '\ud83d\ude00': 1 };
  const expected = '{"a":"é","b":0,"😀":1,"":2}';
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = () => {
    throw new Error('canonical ordering must not depend on locale');
  };
  try {
    assert.equal(canonicalStringify(input), expected);
    assert.deepEqual(canonicalUtf8(input), Buffer.from(expected, 'utf8'));
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test('canonical JSON rejects unsupported, non-finite, and cyclic values', () => {
  for (const value of [
    { value: Number.NaN },
    { value: Infinity },
    { value: undefined },
    { value: 1n },
  ]) {
    assert.throws(() => canonicalStringify(value), /canonical/i);
  }
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalStringify(cyclic), /cyclic/i);
  assert.throws(() => canonicalStringify(new Array(1)), /sparse/i);
  assert.throws(
    () => canonicalStringify({ '\u00e9': 1, 'e\u0301': 2 }),
    /collide/i,
  );
});

test('candidate owns base/gameplay clones, applies legacy overlay only to gameplay, and prepares without revision', async () => {
  const acquired = baseCourse();
  const acquiredBytes = JSON.stringify(acquired);
  let hdObservedPin;
  let preparedOptions;
  const candidate = await prepare({
    course: acquired,
    resolveHd(course) {
      hdObservedPin = [...course.holes[0].pin];
      return { status: 'valid', descriptors: [{ bundleId: 'hd-1', grid: { heights: [1] } }] };
    },
    loadLegacyOverride: () => ({ pins: { 1: [10, 20] } }),
    prepareGame(gameplayCourse, options) {
      preparedOptions = options;
      return { course: gameplayCourse, ready: options.ready };
    },
  });

  assert.equal(JSON.stringify(acquired), acquiredBytes);
  assert.notEqual(candidate.baseCourse, acquired);
  assert.notEqual(candidate.gameplayCourse, candidate.baseCourse);
  assert.deepEqual(hdObservedPin, [100, 100]);
  assert.deepEqual(candidate.baseCourse.holes[0].pin, [100, 100]);
  assert.deepEqual(candidate.gameplayCourse.holes[0].pin, [10, 20]);
  assert.equal(candidate.courseRevision, undefined);
  assert.match(candidate.contentRevision, /^[a-f0-9]{64}$/);
  assert.equal(candidate.presentation.tier, 'curated');
  assert.deepEqual(preparedOptions, { terrainPatches: [], ready: false });
  assert.equal(candidate.preparedGameState.course, candidate.gameplayCourse);
  assert.ok(Object.isFrozen(candidate));
  assert.ok(Object.isFrozen(candidate.publicAssetManifest));
  assert.ok(Object.isFrozen(candidate.terrainPatches));
});

test('candidate validates asset bytes and separates path-free public records from private paths', async () => {
  const artDir = tempRoot();
  const { assetPath, bytes, pack, sha256 } = pngPackAt(artDir);

  const candidate = await prepare({ packResult: validResult(pack), artDir });
  assert.deepEqual(candidate.publicAssetManifest.turf, {
    url: `/api/course-art/${candidate.contentRevision}/turf`,
    mime: 'image/png',
    bytes: bytes.length,
    sha256,
  });
  assert.doesNotMatch(JSON.stringify(candidate.publicAssetManifest), /[A-Za-z]:\\|ob-package-/);
  assert.equal(candidate.privateAssetManifest.turf.absolutePath, assetPath);
  assert.equal(candidate.privateAssetManifest.turf.realPath, fs.realpathSync(assetPath));
  assert.deepEqual(
    Object.keys(candidate.privateAssetManifest.turf.fileIdentity).sort(),
    ['birthtimeNs', 'device', 'inode'],
  );
  assert.ok(Object.values(candidate.privateAssetManifest.turf.fileIdentity)
    .every((value) => typeof value === 'string' && /^[0-9]+$/u.test(value)));
  assert.ok(Object.isFrozen(candidate.privateAssetManifest.turf));
  assert.ok(Object.isFrozen(candidate.privateAssetManifest.turf.fileIdentity));

  fs.writeFileSync(assetPath, Buffer.from('tampered bytes'));
  await assert.rejects(
    prepare({ packResult: validResult(pack), artDir }),
    (error) => error.code === 'ART_ASSET_INVALID',
  );
});

test('runtime asset bytes are read and hashed once, then owned by the prepared package', async () => {
  const artDir = tempRoot();
  const { assetPath, bytes, pack, sha256 } = pngPackAt(artDir);
  publishRuntimePack(artDir, pack);
  const originalReadFileSync = fs.readFileSync;
  let assetReads = 0;
  fs.readFileSync = function countedRead(filePath, ...args) {
    if (path.resolve(filePath) === path.resolve(assetPath)) assetReads += 1;
    return originalReadFileSync.call(this, filePath, ...args);
  };
  let candidate;
  try {
    candidate = await prepareCourseCandidate({
      baseCourse: baseCourse(),
      requestedIdentity: SOURCE,
      dataDir: tempRoot(),
      artDir,
      resolveHd: () => ({ status: 'absent' }),
      loadRuntimePack: loadRuntimeCourseArt,
      loadLegacyOverride: () => null,
      prepareGame: () => ({}),
    });
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  assert.equal(candidate.presentation.tier, 'curated');
  assert.equal(assetReads, 1);
  assert.equal(candidate.privateAssetManifest.turf.sha256, sha256);
  assert.ok(candidate.privateAssetManifest.turf.verifiedBytes.equals(bytes));
});

test('content revision ignores root/name/object/feature order but tracks semantic presentation, gameplay, and assets', async () => {
  const automatic = await prepare();
  const renamed = await prepare({
    course: baseCourse({ name: 'Renamed Display Only' }),
  });
  assert.equal(automatic.contentRevision, renamed.contentRevision);

  const orderedPresentation = runtimePack().presentation;
  const reverseFeatures = {
    ...orderedPresentation,
    vegetation: { rules: [feature('z-rule'), feature('a-rule')] },
    landmarks: { features: [feature('z-mark'), feature('a-mark')] },
  };
  const sortedFeatures = {
    qualityHints: { source: 'curated' },
    assetKeys: [],
    atmosphere: {},
    landmarks: { features: [feature('a-mark'), feature('z-mark')] },
    vegetation: { rules: [feature('a-rule'), feature('z-rule')] },
    materials: {},
    surfaces: {},
    world: {},
    character: { dryness: 0.85, biome: 'pnw-links' },
    tier: 'curated',
  };
  const first = await prepare({ packResult: validResult(runtimePack({ presentation: reverseFeatures })) });
  const reordered = await prepare({ packResult: validResult(runtimePack({ presentation: sortedFeatures })) });
  assert.equal(first.contentRevision, reordered.contentRevision);

  const wetter = await prepare({
    packResult: validResult(runtimePack({
      presentation: {
        ...orderedPresentation,
        character: { biome: 'pnw-links', dryness: 0.5 },
      },
    })),
  });
  assert.notEqual(first.contentRevision, wetter.contentRevision);

  const gameplayA = await prepare({
    packResult: validResult(runtimePack({
      gameplay: {
        surfaces: [
          { kind: 'green', poly: [[0, 0], [10, 0], [10, 10]] },
          { kind: 'bunker', poly: [[20, 20], [30, 20], [30, 30]] },
        ],
      },
    })),
  });
  const gameplayB = await prepare({
    packResult: validResult(runtimePack({
      gameplay: {
        surfaces: [
          { kind: 'bunker', poly: [[20, 20], [30, 20], [30, 30]] },
          { kind: 'green', poly: [[0, 0], [10, 0], [10, 10]] },
        ],
      },
    })),
  });
  assert.notEqual(gameplayA.contentRevision, gameplayB.contentRevision);

  const rootA = tempRoot();
  const rootB = tempRoot();
  const assetA = pngPackAt(rootA, [10, 20, 30, 255]);
  const assetB = pngPackAt(rootB, [10, 20, 30, 255]);
  const fromRootA = await prepare({ packResult: validResult(assetA.pack), artDir: rootA });
  const fromRootB = await prepare({ packResult: validResult(assetB.pack), artDir: rootB });
  assert.equal(fromRootA.contentRevision, fromRootB.contentRevision);

  const changedRoot = tempRoot();
  const changedAsset = pngPackAt(changedRoot, [11, 20, 30, 255]);
  const changedBytes = await prepare({
    packResult: validResult(changedAsset.pack),
    artDir: changedRoot,
  });
  assert.notEqual(fromRootA.contentRevision, changedBytes.contentRevision);
});

test('packs-disabled preparation skips runtime and legacy discovery completely', async () => {
  let runtimeCalls = 0;
  let legacyCalls = 0;
  const course = baseCourse();
  const candidate = await prepareCourseCandidate({
    baseCourse: course,
    requestedIdentity: SOURCE,
    packsEnabled: false,
    dataDir: tempRoot(),
    artDir: tempRoot(),
    resolveHd: () => ({ status: 'absent' }),
    loadRuntimePack() {
      runtimeCalls += 1;
      throw new Error('must not run');
    },
    loadLegacyOverride() {
      legacyCalls += 1;
      throw new Error('must not run');
    },
    prepareGame: () => ({}),
  });
  assert.equal(runtimeCalls, 0);
  assert.equal(legacyCalls, 0);
  assert.equal(candidate.presentation.tier, 'automatic');
});

test('every fallible preparation stage leaves the acquired course byte-identical', async () => {
  const failures = [
    { resolveHd: () => { throw new Error('hd failed'); } },
    { packResult: null },
    { prepareGame: () => { throw new Error('game failed'); } },
  ];
  for (const injected of failures) {
    const acquired = baseCourse();
    const before = JSON.stringify(acquired);
    if (Object.hasOwn(injected, 'packResult') && injected.packResult === null) {
      await assert.rejects(prepareCourseCandidate({
        baseCourse: acquired,
        requestedIdentity: SOURCE,
        packsEnabled: true,
        dataDir: tempRoot(),
        artDir: tempRoot(),
        resolveHd: () => ({ status: 'absent' }),
        loadRuntimePack: () => { throw new Error('pack failed'); },
        loadLegacyOverride: () => null,
        prepareGame: () => ({}),
      }));
    } else {
      await assert.rejects(prepare({ course: acquired, ...injected }));
    }
    assert.equal(JSON.stringify(acquired), before);
  }

  const acquired = baseCourse();
  const before = JSON.stringify(acquired);
  const fallback = await prepare({
    course: acquired,
    loadLegacyOverride: () => { throw new Error('legacy failed'); },
  });
  assert.equal(fallback.presentation.tier, 'automatic');
  assert.equal(fallback.presentation.diagnostics[0].code, 'ART_PACK_INVALID');
  assert.equal(JSON.stringify(acquired), before);
});

test('unsupported terrain features reject only curated presentation and still prepare automatic gameplay', async () => {
  const candidate = await prepare({
    packResult: validResult(runtimePack({
      features: [feature('future-terrain')],
    })),
  });
  assert.equal(candidate.presentation.tier, 'automatic');
  assert.equal(candidate.presentation.diagnostics.length, 1);
  assert.equal(candidate.presentation.diagnostics[0].code, 'ART_CAPABILITY_UNSUPPORTED');
  assert.deepEqual(candidate.publicAssetManifest, {});
  assert.deepEqual(candidate.terrainPatches, []);
});
