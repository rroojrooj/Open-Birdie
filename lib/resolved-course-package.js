'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { canonicalUtf8 } = require('./canonical-json');
const { loadRuntimeCourseArt, readVerifiedRuntimeAsset } = require('./course-art-assets');
const { createCourseDiagnostic, dedupeCourseDiagnostics } = require('./course-diagnostics');
const { normalizeCourseSource } = require('./course-identity');
const { loadLegacyGameplayOverlay } = require('./course');
const {
  cloneCourseWithGameplay,
  resolveCoursePresentation,
} = require('./course-presentation');
const { resolveHdBundles } = require('./hd-bundle');

const PACKAGE_CONTRACT_VERSION = 1;

class ResolvedCoursePackageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ResolvedCoursePackageError';
    this.code = code;
  }
}

function packageError(code, message) {
  return new ResolvedCoursePackageError(code, message);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' && !path.isAbsolute(relative);
}

function deepFreezeMetadata(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  if (Buffer.isBuffer(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreezeMetadata(value[key], seen);
  return Object.freeze(value);
}

function compareFeatureId(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function presentationForRevision(presentation) {
  return {
    courseId: presentation.courseId,
    tier: presentation.tier,
    character: structuredClone(presentation.character),
    world: structuredClone(presentation.world),
    surfaces: structuredClone(presentation.surfaces),
    materials: structuredClone(presentation.materials),
    vegetation: {
      rules: structuredClone(presentation.vegetation.rules).sort(compareFeatureId),
    },
    landmarks: {
      features: structuredClone(presentation.landmarks.features).sort(compareFeatureId),
    },
    atmosphere: structuredClone(presentation.atmosphere),
    assetKeys: [...presentation.assetKeys].sort(),
    qualityHints: structuredClone(presentation.qualityHints),
  };
}

function verifyAssetRecords(runtimePack, artDir) {
  if (!runtimePack || runtimePack.assets.length === 0) {
    return { revisionAssets: {}, privateAssetManifest: {} };
  }
  if (!artDir) throw packageError('ART_ASSET_INVALID', 'Course-art root is unavailable');

  let rootReal;
  try {
    rootReal = fs.realpathSync(artDir);
  } catch {
    throw packageError('ART_ASSET_INVALID', 'Course-art root is unavailable');
  }
  const rootAbsolute = path.resolve(artDir);
  const revisionAssets = {};
  const privateAssetManifest = {};
  const assets = [...runtimePack.assets].sort((left, right) => (
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  ));
  const manifestKeys = assets.map((asset) => asset.key);
  const presentationKeys = [...runtimePack.presentation.assetKeys].sort();
  if (canonicalUtf8(manifestKeys).compare(canonicalUtf8(presentationKeys)) !== 0) {
    throw packageError('ART_ASSET_INVALID', 'Course-art presentation and asset keys disagree');
  }

  for (const asset of assets) {
    const absolutePath = runtimePack.assetPaths?.[asset.key];
    if (typeof absolutePath !== 'string' || !path.isAbsolute(absolutePath)) {
      throw packageError('ART_ASSET_MISSING', 'A required staged course-art asset is unavailable');
    }
    let verified = runtimePack.verifiedAssets?.[asset.key];
    try {
      if (!verified) verified = readVerifiedRuntimeAsset(absolutePath, asset);
    } catch (error) {
      if (error?.code === 'ART_ASSET_INVALID') {
        throw packageError('ART_ASSET_INVALID', 'A staged course-art asset failed verification');
      }
      throw packageError('ART_ASSET_MISSING', 'A required staged course-art asset is unavailable');
    }
    const {
      realPath,
      inspected,
      verifiedBytes,
      verifiedMime,
      fileIdentity,
    } = verified;
    if (!isInside(rootAbsolute, path.resolve(absolutePath)) ||
        verified.absolutePath !== path.resolve(absolutePath) ||
        !isInside(rootReal, realPath) ||
        !Buffer.isBuffer(verifiedBytes) ||
        verifiedMime !== asset.mime) {
      throw packageError('ART_ASSET_INVALID', 'A staged course-art asset is outside the runtime root');
    }
    if (inspected.bytes !== asset.bytes || inspected.sha256 !== asset.sha256) {
      throw packageError('ART_ASSET_INVALID', 'A staged course-art asset failed verification');
    }
    revisionAssets[asset.key] = {
      mime: asset.mime,
      bytes: asset.bytes,
      sha256: asset.sha256,
    };
    privateAssetManifest[asset.key] = Object.freeze({
      absolutePath: path.resolve(absolutePath),
      realPath,
      mime: asset.mime,
      bytes: asset.bytes,
      sha256: asset.sha256,
      fileIdentity,
      verifiedBytes,
      verifiedMime,
      verifiedSha256: inspected.sha256,
    });
  }
  return { revisionAssets, privateAssetManifest };
}

function buildPublicAssetManifest(revisionAssets, contentRevision) {
  const manifest = {};
  for (const key of Object.keys(revisionAssets).sort()) {
    manifest[key] = Object.freeze({
      url: `/api/course-art/${contentRevision}/${key}`,
      ...revisionAssets[key],
    });
  }
  return Object.freeze(manifest);
}

function hdDiagnostic(result, courseId) {
  if (!result || result.status !== 'rejected') return null;
  const typedCodes = new Set([
    'HD_FINGERPRINT_VERSION_UNSUPPORTED',
    'HD_SOURCE_ID_MISMATCH',
    'HD_SOURCE_ID_REQUIRED',
  ]);
  const code = typedCodes.has(result.code)
    ? result.code
    : 'HD_BUNDLE_REJECTED';
  return createCourseDiagnostic({
    code,
    severity: 'warning',
    stage: 'hd-runtime',
    courseId,
    message: 'High-detail course data was rejected; base terrain remains available.',
    recovery: 'Rebuild or remove the incompatible high-detail course bundle.',
  });
}

async function prepareCourseCandidate({
  baseCourse: acquiredCourse,
  requestedIdentity,
  packsEnabled = true,
  dataDir,
  artDir,
  resolveHd = resolveHdBundles,
  loadRuntimePack = loadRuntimeCourseArt,
  loadLegacyOverride = loadLegacyGameplayOverlay,
  prepareGame,
} = {}) {
  if (typeof prepareGame !== 'function') {
    throw packageError('ACTIVATION_PREPARE_FAILED', 'Game preparation is unavailable');
  }

  const baseCourse = structuredClone(acquiredCourse);
  const requestedSource = normalizeCourseSource(requestedIdentity?.source || requestedIdentity);
  const cachedSource = normalizeCourseSource(baseCourse?.source);
  if (requestedSource.courseId !== cachedSource.courseId) {
    throw packageError('COURSE_IDENTITY_INVALID', 'Requested and acquired course identities disagree');
  }
  const courseId = requestedSource.courseId;

  const hdResult = await resolveHd(baseCourse, { dataDir });
  const hdDescriptors = hdResult?.status === 'valid'
    ? Object.freeze([...(hdResult.descriptors || [])])
    : Object.freeze([]);

  const curatedDisabled = packsEnabled === false || process.env.BIRDIE_DISABLE_CURATED === '1';
  const runtimeResult = curatedDisabled
    ? { status: 'disabled', runtimePack: null, diagnostics: [] }
    : await loadRuntimePack({
      runtimeRoot: artDir,
      courseId,
      legacyIdentity: { name: baseCourse.name, origin: baseCourse.origin },
      disabled: false,
    });
  const presentation = resolveCoursePresentation({
    course: baseCourse,
    courseId,
    stagedRuntimePack: runtimeResult,
    packsEnabled: !curatedDisabled,
    environment: {
      loadLegacyGameplayOverlay: loadLegacyOverride,
      dataDir: dataDir == null ? undefined : path.join(dataDir, 'courses'),
    },
  });
  const gameplayCourse = cloneCourseWithGameplay(baseCourse, presentation);
  const terrainPatches = Object.freeze([]);

  const acceptedRuntimePack = presentation.tier === 'curated' &&
    runtimeResult?.status === 'valid'
    ? runtimeResult.runtimePack
    : null;
  const {
    revisionAssets,
    privateAssetManifest,
  } = verifyAssetRecords(acceptedRuntimePack, artDir);

  const revisionInput = {
    version: PACKAGE_CONTRACT_VERSION,
    courseId,
    presentation: presentationForRevision(presentation),
    gameplay: presentation.gameplayOverlay
      ? structuredClone(presentation.gameplayOverlay)
      : {},
    terrainPatches: [],
    assets: revisionAssets,
  };
  const contentRevision = sha256(canonicalUtf8(revisionInput));
  const publicAssetManifest = buildPublicAssetManifest(revisionAssets, contentRevision);
  const diagnostics = dedupeCourseDiagnostics([
    ...presentation.diagnostics,
    hdDiagnostic(hdResult, courseId),
  ]);
  const preparedGameState = await prepareGame(gameplayCourse, {
    terrainPatches,
    ready: hdDescriptors.length === 0,
  });
  if (!preparedGameState || typeof preparedGameState !== 'object') {
    throw packageError('ACTIVATION_PREPARE_FAILED', 'Game preparation returned invalid state');
  }

  return Object.freeze({
    courseId,
    contentRevision,
    baseCourse,
    gameplayCourse,
    terrainPatches,
    presentation,
    hdDescriptors,
    publicAssetManifest,
    privateAssetManifest: deepFreezeMetadata(privateAssetManifest),
    diagnostics,
    preparedGameState: Object.freeze(preparedGameState),
  });
}

module.exports = {
  PACKAGE_CONTRACT_VERSION,
  ResolvedCoursePackageError,
  prepareCourseCandidate,
};
