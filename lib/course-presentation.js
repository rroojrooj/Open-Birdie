'use strict';

const { applySurfaceOverride, loadLegacyGameplayOverlay } = require('./course');
const { legacyIdentityMatches, normalizeCourseSource } = require('./course-identity');
const { validateRuntimeManifest } = require('./generated/course-art-pack-validator');
const {
  createCourseDiagnostic,
  dedupeCourseDiagnostics,
} = require('./course-diagnostics');

const DIAGNOSTIC_TEXT = Object.freeze({
  COURSE_IDENTITY_INVALID: Object.freeze({
    severity: 'warning',
    stage: 'identity',
    message: 'The course identity is invalid, so curated presentation was skipped.',
    recovery: 'Select the course again from a result with a valid OpenStreetMap source.',
  }),
  ART_PACK_INVALID: Object.freeze({
    severity: 'warning',
    stage: 'course-art-runtime',
    message: 'The selected curated course-art pack is invalid.',
    recovery: 'Restage or reinstall the curated course-art pack.',
  }),
  ART_PACK_VERSION_UNSUPPORTED: Object.freeze({
    severity: 'warning',
    stage: 'course-art-runtime',
    message: 'The selected curated course-art pack uses an unsupported version.',
    recovery: 'Install a course-art pack supported by this Open Birdie version.',
  }),
  ART_PACK_IDENTITY_MISMATCH: Object.freeze({
    severity: 'warning',
    stage: 'course-art-runtime',
    message: 'The selected curated course-art pack belongs to another course.',
    recovery: 'Restage the pack with the matching stable course identity.',
  }),
  ART_ASSET_INVALID: Object.freeze({
    severity: 'warning',
    stage: 'course-art-runtime',
    message: 'A selected curated course-art asset is invalid.',
    recovery: 'Restage or reinstall the curated course-art pack.',
  }),
  ART_ASSET_MISSING: Object.freeze({
    severity: 'warning',
    stage: 'course-art-runtime',
    message: 'A required curated course-art asset is missing.',
    recovery: 'Restage or reinstall the curated course-art pack.',
  }),
  ART_CAPABILITY_UNSUPPORTED: Object.freeze({
    severity: 'warning',
    stage: 'course-art-runtime',
    message: 'The selected course-art pack requires a capability that is not available yet.',
    recovery: 'Remove unsupported feature declarations or use automatic presentation.',
  }),
  ART_LEGACY_SIDECAR: Object.freeze({
    severity: 'info',
    stage: 'course-art-legacy',
    message: 'A legacy gameplay sidecar was applied through the curated compatibility adapter.',
    recovery: 'Move this gameplay data into the identity-bound course-art profile.',
  }),
});

function cloneJson(value) {
  return structuredClone(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function makeDiagnostic(code, courseId) {
  const text = DIAGNOSTIC_TEXT[code] || DIAGNOSTIC_TEXT.ART_PACK_INVALID;
  return createCourseDiagnostic({ code, courseId, ...text });
}

function normalizeIncomingDiagnostic(diagnostic, courseId) {
  const code = typeof diagnostic?.code === 'string' && DIAGNOSTIC_TEXT[diagnostic.code]
    ? diagnostic.code
    : 'ART_PACK_INVALID';
  return makeDiagnostic(code, courseId);
}

function finalizePresentation(fields, gameplayOverlay = null) {
  const presentation = {
    courseId: fields.courseId,
    tier: fields.tier,
    character: cloneJson(fields.character),
    world: cloneJson(fields.world),
    surfaces: cloneJson(fields.surfaces),
    materials: cloneJson(fields.materials),
    vegetation: cloneJson(fields.vegetation),
    landmarks: cloneJson(fields.landmarks),
    atmosphere: cloneJson(fields.atmosphere),
    assetKeys: cloneJson(fields.assetKeys),
    qualityHints: cloneJson(fields.qualityHints),
    diagnostics: dedupeCourseDiagnostics(fields.diagnostics),
  };
  if (gameplayOverlay && Object.keys(gameplayOverlay).length > 0) {
    Object.defineProperty(presentation, 'gameplayOverlay', {
      value: cloneJson(gameplayOverlay),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return deepFreeze(presentation);
}

function automaticCoursePresentation({ courseId = null, diagnostics = [] } = {}) {
  return finalizePresentation({
    courseId,
    tier: 'automatic',
    character: { biome: 'temperate-parkland', dryness: 0 },
    world: {},
    surfaces: {},
    materials: {},
    vegetation: { rules: [] },
    landmarks: { features: [] },
    atmosphere: {},
    assetKeys: [],
    qualityHints: { source: 'automatic' },
    diagnostics,
  });
}

function curatedPresentation(courseId, normalized, diagnostics = [], gameplayOverlay = null) {
  return finalizePresentation({
    courseId,
    ...normalized,
    diagnostics,
  }, gameplayOverlay);
}

function isCuratedDisabled(packsEnabled, environment) {
  const configuredEnvironment = environment?.env || process.env;
  return packsEnabled === false ||
    configuredEnvironment?.BIRDIE_DISABLE_CURATED === '1' ||
    environment?.BIRDIE_DISABLE_CURATED === '1';
}

function unwrapRuntimePack(stagedRuntimePack, courseId) {
  if (!stagedRuntimePack) return { status: 'absent', runtimePack: null };
  if (typeof stagedRuntimePack.status !== 'string') {
    return { status: 'valid', runtimePack: stagedRuntimePack };
  }
  if (stagedRuntimePack.status === 'valid' && stagedRuntimePack.runtimePack) {
    return {
      status: 'valid',
      runtimePack: stagedRuntimePack.runtimePack,
      selection: stagedRuntimePack.selection || null,
    };
  }
  if (stagedRuntimePack.status === 'absent' || stagedRuntimePack.status === 'disabled') {
    return { status: stagedRuntimePack.status, runtimePack: null };
  }
  const diagnostic = normalizeIncomingDiagnostic(stagedRuntimePack.diagnostics?.[0], courseId);
  return { status: 'rejected', runtimePack: null, diagnostic };
}

function validateGameplayOverlay(gameplay, courseId) {
  const candidate = {
    version: 1,
    packId: 'legacy-gameplay',
    courseId,
    displayName: 'Legacy gameplay',
    legacyMatch: {
      names: ['Legacy gameplay'],
      origin: { lat: 0, lon: 0, toleranceM: 0 },
    },
    presentation: {
      tier: 'curated',
      character: { biome: 'temperate-parkland', dryness: 0 },
      world: {},
      surfaces: {},
      materials: {},
      vegetation: { rules: [] },
      landmarks: { features: [] },
      atmosphere: {},
      assetKeys: [],
      qualityHints: { source: 'curated' },
    },
    gameplay,
    terrainPatches: [],
    capabilities: {},
    features: [],
    assets: [],
    contentRevision: '0'.repeat(64),
  };
  return validateRuntimeManifest(candidate);
}

function resolveCoursePresentation({
  course,
  courseId,
  stagedRuntimePack = null,
  packsEnabled = true,
  environment = {},
} = {}) {
  if (isCuratedDisabled(packsEnabled, environment)) {
    return automaticCoursePresentation({ courseId });
  }

  let identity;
  try {
    identity = normalizeCourseSource(course?.source);
    if (identity.courseId !== courseId) throw new Error('Course identity mismatch');
  } catch {
    return automaticCoursePresentation({
      courseId,
      diagnostics: [makeDiagnostic('COURSE_IDENTITY_INVALID', courseId)],
    });
  }

  const selected = unwrapRuntimePack(stagedRuntimePack, identity.courseId);
  if (selected.status === 'rejected') {
    return automaticCoursePresentation({
      courseId: identity.courseId,
      diagnostics: [selected.diagnostic],
    });
  }

  let runtimePack = selected.runtimePack;
  if (runtimePack) {
    if (runtimePack.version != null && runtimePack.version !== 1) {
      return automaticCoursePresentation({
        courseId: identity.courseId,
        diagnostics: [makeDiagnostic('ART_PACK_VERSION_UNSUPPORTED', identity.courseId)],
      });
    }
    if (!validateRuntimeManifest(runtimePack)) {
      return automaticCoursePresentation({
        courseId: identity.courseId,
        diagnostics: [makeDiagnostic('ART_PACK_INVALID', identity.courseId)],
      });
    }
    const verifiedLegacySelection = selected.selection?.mode === 'legacy' &&
      selected.selection.requestedCourseId === identity.courseId &&
      selected.selection.selectedCourseId === runtimePack.courseId &&
      runtimePack.legacyMatch.names.some((name) => legacyIdentityMatches({
        requestedName: course.name,
        requestedOrigin: course.origin,
        cachedName: name,
        cachedOrigin: runtimePack.legacyMatch.origin,
        toleranceM: runtimePack.legacyMatch.origin.toleranceM,
      }));
    if (runtimePack.courseId !== identity.courseId && !verifiedLegacySelection) {
      return automaticCoursePresentation({
        courseId: identity.courseId,
        diagnostics: [makeDiagnostic('ART_PACK_IDENTITY_MISMATCH', identity.courseId)],
      });
    }
    if (runtimePack.features.length > 0) {
      return automaticCoursePresentation({
        courseId: identity.courseId,
        diagnostics: [makeDiagnostic('ART_CAPABILITY_UNSUPPORTED', identity.courseId)],
      });
    }
  }

  let gameplayOverlay = runtimePack && Object.keys(runtimePack.gameplay).length > 0
    ? runtimePack.gameplay
    : null;
  const diagnostics = [];
  if (!gameplayOverlay) {
    const loadLegacy = environment.loadLegacyGameplayOverlay || loadLegacyGameplayOverlay;
    let legacyGameplay;
    try {
      legacyGameplay = loadLegacy({
        course,
        dataDir: environment.dataDir,
        curatedDir: environment.curatedDir,
      });
    } catch {
      return automaticCoursePresentation({
        courseId: identity.courseId,
        diagnostics: [makeDiagnostic('ART_PACK_INVALID', identity.courseId)],
      });
    }
    if (legacyGameplay != null) {
      if (!validateGameplayOverlay(legacyGameplay, identity.courseId)) {
        return automaticCoursePresentation({
          courseId: identity.courseId,
          diagnostics: [makeDiagnostic('ART_PACK_INVALID', identity.courseId)],
        });
      }
      gameplayOverlay = legacyGameplay;
      diagnostics.push(makeDiagnostic('ART_LEGACY_SIDECAR', identity.courseId));
    }
  }

  if (runtimePack) {
    return curatedPresentation(
      identity.courseId,
      runtimePack.presentation,
      diagnostics,
      gameplayOverlay,
    );
  }
  if (gameplayOverlay) {
    return curatedPresentation(identity.courseId, {
      tier: 'curated',
      character: { biome: 'temperate-parkland', dryness: 0 },
      world: {},
      surfaces: {},
      materials: {},
      vegetation: { rules: [] },
      landmarks: { features: [] },
      atmosphere: {},
      assetKeys: [],
      qualityHints: { source: 'curated' },
    }, diagnostics, gameplayOverlay);
  }
  return automaticCoursePresentation({ courseId: identity.courseId });
}

function cloneCourseWithGameplay(course, presentation) {
  const cloned = cloneJson(course);
  if (presentation?.gameplayOverlay) {
    applySurfaceOverride(cloned, presentation.gameplayOverlay);
  }
  return cloned;
}

module.exports = {
  automaticCoursePresentation,
  cloneCourseWithGameplay,
  resolveCoursePresentation,
};
