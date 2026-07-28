'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  automaticCoursePresentation,
  cloneCourseWithGameplay,
  resolveCoursePresentation,
} = require('../lib/course-presentation');
const {
  createCourseDiagnostic,
  dedupeCourseDiagnostics,
} = require('../lib/course-diagnostics');

const SOURCE = Object.freeze({
  courseId: 'osm:way:26787026',
  osmType: 'way',
  osmId: 26787026,
});

function course(overrides = {}) {
  return {
    version: 4,
    name: 'Chambers Bay',
    source: SOURCE,
    origin: { lat: 47.2057007, lon: -122.5750529 },
    holes: [{ ref: 1, tee: [0, 0], pin: [100, 100] }],
    surfaces: [],
    ...overrides,
  };
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

const PUBLIC_KEYS = [
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
].sort();

test('unknown and Sawgrass courses use one complete automatic presentation with dryness zero', () => {
  for (const [courseId, name] of [
    ['osm:relation:999001', 'Unknown Municipal'],
    ['osm:way:136330252', 'TPC Sawgrass'],
  ]) {
    const presentation = resolveCoursePresentation({
      course: course({
        name,
        source: {
          courseId,
          osmType: courseId.split(':')[1],
          osmId: Number(courseId.split(':')[2]),
        },
      }),
      courseId,
      stagedRuntimePack: null,
      packsEnabled: true,
    });
    assert.equal(presentation.tier, 'automatic');
    assert.equal(presentation.character.dryness, 0);
    assert.equal(presentation.qualityHints.source, 'automatic');
    assert.deepEqual(Object.keys(presentation).sort(), PUBLIC_KEYS);
    assert.ok(Object.isFrozen(presentation));
    assert.ok(Object.isFrozen(presentation.vegetation.rules));
  }
});

test('valid Chambers runtime pack resolves reviewed curated character', () => {
  const presentation = resolveCoursePresentation({
    course: course(),
    courseId: SOURCE.courseId,
    stagedRuntimePack: runtimePack(),
    packsEnabled: true,
  });
  assert.equal(presentation.tier, 'curated');
  assert.deepEqual(presentation.character, { biome: 'pnw-links', dryness: 0.85 });
  assert.deepEqual(presentation.diagnostics, []);
  assert.deepEqual(Object.keys(presentation).sort(), PUBLIC_KEYS);
  assert.ok(Object.isFrozen(presentation.character));
  assert.doesNotMatch(JSON.stringify(presentation), /[A-Za-z]:\\|\/Users\/|manifest\.json|assets\//);
});

test('runtime-loader legacy selection is independently reverified by alias and origin', () => {
  const requestedCourseId = 'osm:way:999001';
  const legacyPack = runtimePack({ courseId: SOURCE.courseId });
  const stagedRuntimePack = {
    status: 'valid',
    runtimePack: legacyPack,
    diagnostics: [],
    selection: {
      mode: 'legacy',
      requestedCourseId,
      selectedCourseId: SOURCE.courseId,
    },
  };
  const selected = resolveCoursePresentation({
    course: course({
      source: { courseId: requestedCourseId, osmType: 'way', osmId: 999001 },
    }),
    courseId: requestedCourseId,
    stagedRuntimePack,
    packsEnabled: true,
  });
  assert.equal(selected.tier, 'curated');
  assert.equal(selected.courseId, requestedCourseId);

  const wrongOrigin = resolveCoursePresentation({
    course: course({
      source: { courseId: requestedCourseId, osmType: 'way', osmId: 999001 },
      origin: { lat: 40, lon: -80 },
    }),
    courseId: requestedCourseId,
    stagedRuntimePack,
    packsEnabled: true,
  });
  assert.equal(wrongOrigin.tier, 'automatic');
  assert.equal(wrongOrigin.diagnostics[0].code, 'ART_PACK_IDENTITY_MISMATCH');
});

test('packs-disabled mode is automatic and never calls the legacy sidecar loader', () => {
  let calls = 0;
  const presentation = resolveCoursePresentation({
    course: course(),
    courseId: SOURCE.courseId,
    stagedRuntimePack: runtimePack(),
    packsEnabled: false,
    environment: {
      loadLegacyGameplayOverlay() {
        calls += 1;
        throw new Error('must not run');
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(presentation.tier, 'automatic');
  assert.equal(presentation.character.dryness, 0);
});

test('environment rollback disables both staged loader results and legacy lookup', () => {
  let calls = 0;
  const presentation = resolveCoursePresentation({
    course: course(),
    courseId: SOURCE.courseId,
    stagedRuntimePack: { status: 'valid', runtimePack: runtimePack(), diagnostics: [] },
    packsEnabled: true,
    environment: {
      env: { BIRDIE_DISABLE_CURATED: '1' },
      loadLegacyGameplayOverlay() {
        calls += 1;
        return { pins: { 1: [10, 10] } };
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(presentation.tier, 'automatic');
  assert.deepEqual(presentation.diagnostics, []);
});

test('valid legacy sidecar is private curated gameplay and applies to a clone only', () => {
  const base = course();
  const presentation = resolveCoursePresentation({
    course: base,
    courseId: SOURCE.courseId,
    stagedRuntimePack: null,
    packsEnabled: true,
    environment: {
      loadLegacyGameplayOverlay: () => ({
        pins: { 1: [10, 10] },
        surfaces: [{ kind: 'green', poly: [[0, 0], [20, 0], [20, 20], [0, 20]] }],
      }),
    },
  });
  assert.equal(presentation.tier, 'curated');
  assert.equal(presentation.diagnostics.length, 1);
  assert.equal(presentation.diagnostics[0].code, 'ART_LEGACY_SIDECAR');
  assert.equal(Object.prototype.propertyIsEnumerable.call(presentation, 'gameplayOverlay'), false);

  const cloned = cloneCourseWithGameplay(base, presentation);
  assert.notEqual(cloned, base);
  assert.deepEqual(cloned.holes[0].pin, [10, 10]);
  assert.deepEqual(base.holes[0].pin, [100, 100]);
  assert.equal(base.surfaces.length, 0);
  assert.equal(cloned.surfaces.length, 1);
});

test('validated pack gameplay owns the overlay and skips legacy compatibility lookup', () => {
  let calls = 0;
  const pack = runtimePack({ gameplay: { pins: { 1: [12, 13] } } });
  const presentation = resolveCoursePresentation({
    course: course(),
    courseId: SOURCE.courseId,
    stagedRuntimePack: { status: 'valid', runtimePack: pack, diagnostics: [] },
    packsEnabled: true,
    environment: {
      loadLegacyGameplayOverlay() {
        calls += 1;
        return { pins: { 1: [99, 99] } };
      },
    },
  });
  pack.presentation.character.dryness = 0;
  pack.gameplay.pins['1'][0] = 99;

  assert.equal(calls, 0);
  assert.equal(presentation.character.dryness, 0.85);
  assert.deepEqual(cloneCourseWithGameplay(course(), presentation).holes[0].pin, [12, 13]);
  assert.ok(Object.isFrozen(presentation.gameplayOverlay.pins['1']));
});

test('invalid legacy sidecar rejects compatibility data with one root diagnostic', () => {
  const presentation = resolveCoursePresentation({
    course: course(),
    courseId: SOURCE.courseId,
    stagedRuntimePack: null,
    packsEnabled: true,
    environment: {
      loadLegacyGameplayOverlay: () => ({
        pins: { 1: [Number.NaN, 10] },
        privatePath: 'C:\\private\\sidecar.json',
      }),
    },
  });
  assert.equal(presentation.tier, 'automatic');
  assert.equal(presentation.diagnostics.length, 1);
  assert.equal(presentation.diagnostics[0].code, 'ART_PACK_INVALID');
  assert.equal(presentation.gameplayOverlay, undefined);
  assert.doesNotMatch(JSON.stringify(presentation), /private|[A-Za-z]:\\/i);
});

test('corrupt, mismatched, and unsupported selected packs fall back with one actionable diagnostic', () => {
  const cases = [
    [{ ...runtimePack(), surprise: true }, 'ART_PACK_INVALID'],
    [runtimePack({ courseId: 'osm:way:26787027' }), 'ART_PACK_IDENTITY_MISMATCH'],
    [runtimePack({ version: 2 }), 'ART_PACK_VERSION_UNSUPPORTED'],
    [runtimePack({ features: [{ id: 'ridge', required: false, assetKeys: [], payload: {} }] }), 'ART_CAPABILITY_UNSUPPORTED'],
  ];
  for (const [pack, code] of cases) {
    const presentation = resolveCoursePresentation({
      course: course(),
      courseId: SOURCE.courseId,
      stagedRuntimePack: pack,
      packsEnabled: true,
    });
    assert.equal(presentation.tier, 'automatic');
    assert.equal(presentation.diagnostics.length, 1);
    assert.equal(presentation.diagnostics[0].code, code);
    assert.ok(presentation.diagnostics[0].recovery);
  }
});

test('rejected staged loader result is sanitized and deduplicated at the composition gate', () => {
  const presentation = resolveCoursePresentation({
    course: course(),
    courseId: SOURCE.courseId,
    stagedRuntimePack: {
      status: 'rejected',
      runtimePack: null,
      diagnostics: [
        { code: 'ART_ASSET_INVALID', message: 'C:\\Users\\alice\\asset.glb' },
        { code: 'ART_ASSET_INVALID', message: 'duplicate' },
      ],
    },
    packsEnabled: true,
  });
  assert.equal(presentation.tier, 'automatic');
  assert.equal(presentation.diagnostics.length, 1);
  assert.equal(presentation.diagnostics[0].code, 'ART_ASSET_INVALID');
  assert.doesNotMatch(JSON.stringify(presentation), /alice|[A-Za-z]:\\/);
});

test('malformed active identity cannot select a pack or legacy sidecar', () => {
  let calls = 0;
  const presentation = resolveCoursePresentation({
    course: course({ source: { courseId: 'bad', osmType: 'way', osmId: 26787026 } }),
    courseId: 'bad',
    stagedRuntimePack: runtimePack(),
    packsEnabled: true,
    environment: {
      loadLegacyGameplayOverlay() {
        calls += 1;
        return {};
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(presentation.tier, 'automatic');
  assert.equal(presentation.diagnostics.length, 1);
  assert.equal(presentation.diagnostics[0].code, 'COURSE_IDENTITY_INVALID');
});

test('automatic adapter source has no course-name or stable-ID special cases', () => {
  const source = fs.readFileSync(require.resolve('../lib/course-presentation'), 'utf8');
  const start = source.indexOf('function automaticCoursePresentation');
  const end = source.indexOf('\nfunction ', start + 10);
  const adapter = source.slice(start, end);
  assert.doesNotMatch(adapter, /Chambers|Sawgrass|Bandon|St Andrews|osm:/i);
  assert.deepEqual(
    automaticCoursePresentation({ courseId: SOURCE.courseId }).character,
    { biome: 'temperate-parkland', dryness: 0 },
  );
});

test('diagnostics redact sensitive paths/secrets and dedupe by code/stage/courseId', () => {
  const first = createCourseDiagnostic({
    code: 'ART_PACK_INVALID',
    severity: 'warning',
    stage: 'course-art-runtime',
    courseId: SOURCE.courseId,
    message: 'Failed C:\\Users\\alice\\secret?token=hunter2',
    recovery: 'Retry /Users/alice/private with api_key=secret',
  });
  const second = { ...first, message: 'duplicate' };
  const diagnostics = dedupeCourseDiagnostics([first, second]);
  assert.equal(diagnostics.length, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics), /alice|hunter2|secret|C:\\|\/Users\//);
  assert.ok(Object.isFrozen(diagnostics[0]));
});
