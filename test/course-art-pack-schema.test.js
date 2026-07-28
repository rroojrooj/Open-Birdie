'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateRuntimeIndex,
  validateRuntimeManifest,
  validateSourceIndex,
  validateSourceLandmarks,
  validateSourceProfile,
  validateSourceReferences,
  validateSourceTerrainFeatures,
  validateSourceVegetation,
} = require('../lib/generated/course-art-pack-validator');
const LIMITS = require('../lib/course-art-limits');

const legacyMatch = {
  names: ['Chambers Bay'],
  origin: { lat: 47.2057007, lon: -122.5750529, toleranceM: 250 },
};

const sourceIndex = () => ({
  version: 1,
  packs: [{
    packId: 'chambers-bay',
    courseId: 'osm:way:26787026',
    legacyMatch,
    source: 'chambers-bay',
  }],
});

const sourceProfile = () => ({
  version: 1,
  courseId: 'osm:way:26787026',
  displayName: 'Chambers Bay',
  legacyMatch,
  tier: 'curated',
  character: { biome: 'pnw-links', dryness: 0.85 },
  world: {},
  atmosphere: {},
  materials: {},
  components: { references: 'references.json' },
  gameplay: {},
  assets: {},
});

const runtimeIndex = () => ({
  version: 1,
  packs: [{
    packId: 'chambers-bay',
    courseId: 'osm:way:26787026',
    legacyMatch,
    manifest: 'packs/chambers-bay/manifest.json',
  }],
});

const runtimeManifest = () => ({
  version: 1,
  packId: 'chambers-bay',
  courseId: 'osm:way:26787026',
  displayName: 'Chambers Bay',
  legacyMatch,
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
});

function assertValid(validate, value) {
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}

function assertInvalid(validate, value) {
  assert.equal(validate(value), false, 'expected schema rejection');
  assert.ok(Array.isArray(validate.errors) && validate.errors.length > 0);
}

test('source and runtime validators accept their strict minimal entry points', () => {
  assertValid(validateSourceIndex, sourceIndex());
  assertValid(validateSourceProfile, sourceProfile());
  assertValid(validateSourceReferences, { version: 1, references: [] });
  assertValid(validateSourceLandmarks, { version: 1, features: [] });
  assertValid(validateSourceVegetation, { version: 1, rules: [] });
  assertValid(validateSourceTerrainFeatures, { version: 1, features: [] });
  assertValid(validateRuntimeIndex, runtimeIndex());
  assertValid(validateRuntimeManifest, runtimeManifest());
});

test('source and runtime root schemas cannot be interchanged', () => {
  assertInvalid(validateRuntimeIndex, sourceIndex());
  assertInvalid(validateSourceIndex, runtimeIndex());
  assertInvalid(validateRuntimeManifest, sourceProfile());
  assertInvalid(validateSourceProfile, runtimeManifest());
});

test('every entry point is closed and rejects unsupported versions', () => {
  const entries = [
    [validateSourceIndex, sourceIndex()],
    [validateSourceProfile, sourceProfile()],
    [validateSourceReferences, { version: 1, references: [] }],
    [validateSourceLandmarks, { version: 1, features: [] }],
    [validateSourceVegetation, { version: 1, rules: [] }],
    [validateSourceTerrainFeatures, { version: 1, features: [] }],
    [validateRuntimeIndex, runtimeIndex()],
    [validateRuntimeManifest, runtimeManifest()],
  ];
  for (const [validate, value] of entries) {
    assertInvalid(validate, { ...value, unknown: true });
    assertInvalid(validate, { ...value, version: 2 });
  }
});

test('schema rejects non-finite and out-of-envelope coordinates plus count/alias limits', () => {
  for (const coordinate of [NaN, Infinity, -Infinity, LIMITS.MAX_LOCAL_COORDINATE_M + 1]) {
    const value = {
      version: 1,
      features: [{
        id: 'clubhouse',
        required: false,
        assetKeys: [],
        payload: { position: [coordinate, 0, 0] },
      }],
    };
    assertInvalid(validateSourceLandmarks, value);
  }

  const aliases = Array.from({ length: LIMITS.MAX_LEGACY_ALIASES + 1 }, (_, i) => `Alias ${i}`);
  assertInvalid(validateSourceProfile, {
    ...sourceProfile(),
    legacyMatch: { ...legacyMatch, names: aliases },
  });

  assertInvalid(validateSourceVegetation, {
    version: 1,
    rules: Array.from({ length: LIMITS.MAX_VEGETATION_RULES + 1 }, (_, i) => ({
      id: `rule-${i}`,
      required: false,
      assetKeys: [],
      payload: {},
    })),
  });
});

test('schema rejects invalid asset keys and out-of-limit declared dimensions', () => {
  assertInvalid(validateSourceProfile, {
    ...sourceProfile(),
    assets: {
      BadKey: { path: 'assets/tree.png', mime: 'image/png', required: false },
    },
  });

  assertInvalid(validateSourceProfile, {
    ...sourceProfile(),
    assets: {
      tree: {
        path: 'assets/tree.png',
        mime: 'image/png',
        required: false,
        expectedWidth: LIMITS.MAX_TEXTURE_DIMENSION_PX + 1,
      },
    },
  });
});
