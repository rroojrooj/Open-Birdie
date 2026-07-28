'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LIMITS = require('./course-art-limits');
const { legacyIdentityMatches, normalizeDisplayName } = require('./course-identity');
const validators = require('./generated/course-art-pack-validator');

const MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
});
const KTX2_MAGIC = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const SHA256 = /^[a-f0-9]{64}$/;

class CourseArtError extends Error {
  constructor(code, stage, message, context = {}, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CourseArtError';
    this.code = code;
    this.stage = stage;
    this.context = context;
  }

  toJSON() {
    return {
      code: this.code,
      stage: this.stage,
      recovery: this.code === 'ART_ASSET_MISSING'
        ? 'Install or restore the required curated course asset and restage course art.'
        : 'Restage the curated course-art pack from a reviewed source.',
    };
  }
}

function artError(code, stage, message, context, cause) {
  return new CourseArtError(code, stage, message, context, cause);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function schemaError(validate, stage, label) {
  return artError('ART_PACK_INVALID', stage, `${label} does not satisfy its closed schema`, {
    errors: (validate.errors || []).map((entry) => ({
      instancePath: entry.instancePath,
      keyword: entry.keyword,
    })),
  });
}

function readJson(filePath, validate, { stage = 'course-art-source', label = 'JSON' } = {}) {
  let bytes;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > LIMITS.MAX_JSON_BYTES) {
      throw artError('ART_PACK_INVALID', stage, `${label} exceeds the JSON file limit`);
    }
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    if (error instanceof CourseArtError) throw error;
    throw artError('ART_PACK_INVALID', stage, `${label} cannot be read`, {}, error);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw artError('ART_PACK_INVALID', stage, `${label} is not valid JSON`, {}, error);
  }
  if (value?.version !== 1) {
    throw artError('ART_PACK_VERSION_UNSUPPORTED', stage, `${label} uses an unsupported version`);
  }
  if (!validate(value)) throw schemaError(validate, stage, label);
  return value;
}

function assertSafeRelativePath(relative, { stage = 'course-art-source', code = 'ART_ASSET_INVALID' } = {}) {
  if (typeof relative !== 'string' || relative.length < 1 || relative.length > 512 ||
      relative.includes('\0') || relative.includes('\\') || relative.includes(':') ||
      path.isAbsolute(relative) || relative.startsWith('/') || relative.startsWith('//')) {
    throw artError(code, stage, 'Unsafe course-art relative path');
  }
  const segments = relative.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' ||
        segment.endsWith('.') || segment.endsWith(' ') || WINDOWS_RESERVED.test(segment)) {
      throw artError(code, stage, 'Unsafe course-art path segment');
    }
  }
  return segments;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function resolveOwnedPath(root, relative, {
  mustExist = true,
  stage = 'course-art-source',
  code = 'ART_ASSET_INVALID',
} = {}) {
  const segments = assertSafeRelativePath(relative, { stage, code });
  const rootReal = fs.realpathSync(root);
  const candidate = path.join(rootReal, ...segments);
  if (!mustExist && !fs.existsSync(candidate)) return candidate;
  let stat;
  try {
    stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) throw new Error('symbolic link');
    const real = fs.realpathSync(candidate);
    if (!isInside(rootReal, real)) throw new Error('path escape');
    return real;
  } catch (error) {
    if (!mustExist && error?.code === 'ENOENT') return candidate;
    throw artError(code, stage, 'Course-art path is missing or escapes its owned root', {}, error);
  }
}

function assertTextureDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > LIMITS.MAX_TEXTURE_DIMENSION_PX || height > LIMITS.MAX_TEXTURE_DIMENSION_PX) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Texture dimensions exceed limits');
  }
}

function inspectPng(bytes) {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(magic) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Invalid PNG header');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assertTextureDimensions(width, height);
  return { width, height };
}

function inspectJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Invalid JPEG header');
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 7) break;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      assertTextureDimensions(width, height);
      return { width, height };
    }
    offset += length;
  }
  throw artError('ART_ASSET_INVALID', 'course-art-assets', 'JPEG dimensions are missing');
}

function inspectWebp(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP') {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Invalid WebP header');
  }
  const fourcc = bytes.toString('ascii', 12, 16);
  let width;
  let height;
  if (fourcc === 'VP8 ') {
    width = bytes.readUInt16LE(26) & 0x3fff;
    height = bytes.readUInt16LE(28) & 0x3fff;
  } else if (fourcc === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >> 14) & 0x3fff) + 1;
  } else if (fourcc === 'VP8X') {
    width = bytes.readUIntLE(24, 3) + 1;
    height = bytes.readUIntLE(27, 3) + 1;
  } else {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Unsupported WebP chunk');
  }
  assertTextureDimensions(width, height);
  return { width, height };
}

function inspectKtx2(bytes) {
  if (bytes.length < 40 || !bytes.subarray(0, 12).equals(KTX2_MAGIC)) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Invalid KTX2 header');
  }
  const width = bytes.readUInt32LE(20);
  const height = bytes.readUInt32LE(24);
  assertTextureDimensions(width, height);
  return { width, height };
}

function inspectImageBytes(bytes, mime) {
  if (mime === 'image/png') return inspectPng(bytes);
  if (mime === 'image/jpeg') return inspectJpeg(bytes);
  if (mime === 'image/webp') return inspectWebp(bytes);
  if (mime === 'image/ktx2') return inspectKtx2(bytes);
  throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Unsupported embedded image MIME');
}

function inspectGlb(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' ||
      bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Invalid GLB header');
  }
  const chunks = [];
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Truncated GLB chunk header');
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (length % 4 !== 0 || offset + length > bytes.length) {
      throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Invalid GLB chunk length');
    }
    chunks.push({ type, bytes: bytes.subarray(offset, offset + length) });
    offset += length;
  }
  if (offset !== bytes.length || chunks.length < 1 || chunks[0].type !== 0x4e4f534a ||
      chunks.filter((chunk) => chunk.type === 0x4e4f534a).length !== 1 ||
      chunks.filter((chunk) => chunk.type === 0x004e4942).length > 1 ||
      chunks.some((chunk) => chunk.type !== 0x4e4f534a && chunk.type !== 0x004e4942)) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Invalid GLB chunk structure');
  }
  let document;
  try {
    document = JSON.parse(chunks[0].bytes.toString('utf8').replace(/[\u0000 ]+$/u, ''));
  } catch (error) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Invalid GLB JSON chunk', {}, error);
  }
  if (document?.asset?.version !== '2.0') {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'GLB asset version must be 2.0');
  }
  for (const buffer of document.buffers || []) {
    if (buffer.uri != null) throw artError('ART_ASSET_INVALID', 'course-art-assets', 'GLB external buffer URI is forbidden');
  }
  for (const image of document.images || []) {
    if (image.uri != null) throw artError('ART_ASSET_INVALID', 'course-art-assets', 'GLB image URI is forbidden');
    if (!Number.isInteger(image.bufferView) || typeof image.mimeType !== 'string') {
      throw artError('ART_ASSET_INVALID', 'course-art-assets', 'GLB image must use an embedded bufferView');
    }
  }
  const bin = chunks.find((chunk) => chunk.type === 0x004e4942)?.bytes || Buffer.alloc(0);
  if ((document.buffers || []).length > 1 ||
      (document.buffers?.[0] && (!Number.isInteger(document.buffers[0].byteLength) ||
        document.buffers[0].byteLength < 0 || document.buffers[0].byteLength > bin.length))) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'GLB buffer declaration exceeds embedded bytes');
  }
  if (bin.length > LIMITS.MAX_TOTAL_ASSET_BYTES) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'GLB embedded bytes exceed limits');
  }
  for (const [index, bufferView] of (document.bufferViews || []).entries()) {
    const start = bufferView.byteOffset || 0;
    const length = bufferView.byteLength;
    if (bufferView.buffer !== 0 || !Number.isInteger(start) || !Number.isInteger(length) ||
        start < 0 || length < 0 || start + length > bin.length) {
      throw artError('ART_ASSET_INVALID', 'course-art-assets', `GLB bufferView ${index} is out of range`);
    }
  }
  for (const image of document.images || []) {
    const view = document.bufferViews?.[image.bufferView];
    if (!view) throw artError('ART_ASSET_INVALID', 'course-art-assets', 'GLB image bufferView is missing');
    const start = view.byteOffset || 0;
    inspectImageBytes(bin.subarray(start, start + view.byteLength), image.mimeType);
  }
  return {};
}

function inspectBytes(bytes, mime) {
  if (mime === 'model/gltf-binary') return inspectGlb(bytes);
  return inspectImageBytes(bytes, mime);
}

function inspectRuntimeAssetBytes(filePath, bytes, declaration) {
  const extension = path.extname(filePath).toLowerCase();
  const expectedMime = MIME_BY_EXTENSION[extension];
  if (!expectedMime || expectedMime !== declaration.mime) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Asset extension and declared MIME disagree');
  }
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 ||
      bytes.length > LIMITS.MAX_SINGLE_ASSET_BYTES) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Asset byte size exceeds limits');
  }
  const dimensions = inspectBytes(bytes, declaration.mime);
  if ((declaration.expectedWidth != null && dimensions.width !== declaration.expectedWidth) ||
      (declaration.expectedHeight != null && dimensions.height !== declaration.expectedHeight)) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Asset dimensions disagree with declaration');
  }
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    ...dimensions,
  };
}

function inspectRuntimeAsset(filePath, declaration) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < 1 || stat.size > LIMITS.MAX_SINGLE_ASSET_BYTES) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Asset byte size exceeds limits');
  }
  return inspectRuntimeAssetBytes(filePath, fs.readFileSync(filePath), declaration);
}

function runtimeFileIdentity(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  });
}

function sameRuntimeFileIdentity(left, right) {
  const a = runtimeFileIdentity(left);
  const b = runtimeFileIdentity(right);
  return a.device === b.device &&
    a.inode === b.inode &&
    a.birthtimeNs === b.birthtimeNs;
}

function readVerifiedRuntimeAsset(filePath, declaration) {
  const absolutePath = path.resolve(filePath);
  const realPath = fs.realpathSync(absolutePath);
  const before = fs.statSync(realPath, { bigint: true });
  if (!before.isFile() || before.size < 1n ||
      before.size > BigInt(LIMITS.MAX_SINGLE_ASSET_BYTES)) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Asset byte size exceeds limits');
  }
  const verifiedBytes = fs.readFileSync(realPath);
  const inspected = inspectRuntimeAssetBytes(realPath, verifiedBytes, declaration);
  const after = fs.statSync(realPath, { bigint: true });
  if (!after.isFile() || before.size !== after.size ||
      !sameRuntimeFileIdentity(before, after) ||
      inspected.bytes !== Number(after.size)) {
    throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Asset changed during verification');
  }
  return Object.freeze({
    absolutePath,
    realPath,
    verifiedBytes,
    verifiedMime: declaration.mime,
    inspected: Object.freeze(inspected),
    fileIdentity: runtimeFileIdentity(after),
  });
}

function sameJson(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function assertIndexConflicts(index) {
  const packIds = new Set();
  const courseIds = new Set();
  const aliases = new Set();
  const sources = new Set();
  for (const entry of index.packs) {
    const sourceFolded = entry.source.toLocaleLowerCase('en-US');
    if (packIds.has(entry.packId) || courseIds.has(entry.courseId) || sources.has(sourceFolded)) {
      throw artError('ART_PACK_CONFLICT', 'course-art-source', 'Duplicate course-art pack selector');
    }
    packIds.add(entry.packId);
    courseIds.add(entry.courseId);
    sources.add(sourceFolded);
    for (const alias of entry.legacyMatch.names) {
      const normalized = normalizeDisplayName(alias);
      if (aliases.has(normalized)) {
        throw artError('ART_PACK_CONFLICT', 'course-art-source', 'Overlapping course-art legacy alias');
      }
      aliases.add(normalized);
    }
  }
}

function readOptionalComponent(packDir, relative, validate, empty, label) {
  if (relative == null) return empty;
  const candidate = resolveOwnedPath(packDir, relative, {
    mustExist: false,
    code: 'ART_PACK_INVALID',
  });
  if (!fs.existsSync(candidate)) return empty;
  return readJson(candidate, validate, { label });
}

function pruneFeatures(features, declarations, presentKeys) {
  const out = [];
  const ids = new Set();
  for (const feature of features) {
    if (ids.has(feature.id)) {
      throw artError('ART_PACK_CONFLICT', 'course-art-source', 'Duplicate course-art feature ID');
    }
    ids.add(feature.id);
    for (const key of feature.assetKeys) {
      const declaration = declarations[key];
      if (!declaration) {
        throw artError('ART_PACK_INVALID', 'course-art-source', 'Feature references an undeclared asset');
      }
      if (feature.required && !declaration.required) {
        throw artError('ART_PACK_INVALID', 'course-art-source', 'Required feature references an optional asset');
      }
    }
    if (!feature.required && feature.assetKeys.some((key) => !presentKeys.has(key))) continue;
    out.push(feature);
  }
  return out;
}

function writeRuntimePack(stagingRoot, entry, profile, packDir) {
  if (entry.courseId !== profile.courseId || !sameJson(entry.legacyMatch, profile.legacyMatch)) {
    throw artError('ART_PACK_IDENTITY_MISMATCH', 'course-art-source', 'Index and profile identity disagree');
  }
  const references = readOptionalComponent(
    packDir,
    profile.components.references,
    validators.validateSourceReferences,
    { version: 1, references: [] },
    'references component',
  );
  void references; // Authoring-only provenance is intentionally excluded.
  const landmarks = readOptionalComponent(
    packDir,
    profile.components.landmarks,
    validators.validateSourceLandmarks,
    { version: 1, features: [] },
    'landmarks component',
  );
  const vegetation = readOptionalComponent(
    packDir,
    profile.components.vegetation,
    validators.validateSourceVegetation,
    { version: 1, rules: [] },
    'vegetation component',
  );
  const terrainFeatures = readOptionalComponent(
    packDir,
    profile.components.terrainFeatures,
    validators.validateSourceTerrainFeatures,
    { version: 1, features: [] },
    'terrain-features component',
  );

  const packOut = path.join(stagingRoot, 'packs', entry.packId);
  const assetsOut = path.join(packOut, 'assets');
  fs.mkdirSync(assetsOut, { recursive: true });
  const sourcePathFolds = new Set();
  const runtimeNames = new Set();
  const runtimeAssets = [];
  const presentKeys = new Set();
  let totalBytes = 0;

  for (const key of Object.keys(profile.assets).sort()) {
    const declaration = profile.assets[key];
    assertSafeRelativePath(declaration.path);
    const folded = declaration.path.toLocaleLowerCase('en-US');
    if (sourcePathFolds.has(folded)) {
      throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Case-folded source asset path collision');
    }
    sourcePathFolds.add(folded);
    const source = resolveOwnedPath(packDir, declaration.path, { mustExist: false });
    if (!fs.existsSync(source)) {
      if (declaration.required) {
        throw artError('ART_ASSET_MISSING', 'course-art-assets', 'Required course-art asset is missing');
      }
      continue;
    }
    const sourceReal = resolveOwnedPath(packDir, declaration.path);
    const inspected = inspectRuntimeAsset(sourceReal, declaration);
    totalBytes += inspected.bytes;
    if (totalBytes > LIMITS.MAX_TOTAL_ASSET_BYTES) {
      throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Course-art pack exceeds total asset budget');
    }
    const extension = path.extname(declaration.path).toLowerCase();
    const sourceStem = path.basename(declaration.path, extension)
      .toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || key;
    const runtimeName = `${sourceStem}.${inspected.sha256.slice(0, 16)}${extension}`;
    const runtimeFolded = runtimeName.toLocaleLowerCase('en-US');
    if (runtimeNames.has(runtimeFolded)) {
      throw artError('ART_ASSET_INVALID', 'course-art-assets', 'Runtime asset filename collision');
    }
    runtimeNames.add(runtimeFolded);
    fs.copyFileSync(sourceReal, path.join(assetsOut, runtimeName));
    runtimeAssets.push({
      key,
      file: `assets/${runtimeName}`,
      mime: declaration.mime,
      bytes: inspected.bytes,
      sha256: inspected.sha256,
      required: declaration.required,
      ...(inspected.width ? { width: inspected.width, height: inspected.height } : {}),
    });
    presentKeys.add(key);
  }

  const landmarkFeatures = pruneFeatures(landmarks.features, profile.assets, presentKeys);
  const vegetationRules = pruneFeatures(vegetation.rules, profile.assets, presentKeys);
  const genericFeatures = pruneFeatures([
    ...(profile.inlineFeatures || []),
    ...terrainFeatures.features,
  ], profile.assets, presentKeys);
  const manifestBase = {
    version: 1,
    packId: entry.packId,
    courseId: profile.courseId,
    displayName: profile.displayName,
    legacyMatch: profile.legacyMatch,
    presentation: {
      tier: profile.tier,
      character: profile.character,
      world: profile.world,
      surfaces: {},
      materials: profile.materials,
      vegetation: { rules: vegetationRules },
      landmarks: { features: landmarkFeatures },
      atmosphere: profile.atmosphere,
      assetKeys: [...presentKeys].sort(),
      qualityHints: { source: 'curated' },
    },
    gameplay: profile.gameplay,
    terrainPatches: [],
    capabilities: {},
    features: genericFeatures,
    assets: runtimeAssets,
  };
  const manifest = {
    ...manifestBase,
    contentRevision: sha256(Buffer.from(stableStringify(manifestBase))),
  };
  if (!validators.validateRuntimeManifest(manifest)) {
    throw schemaError(validators.validateRuntimeManifest, 'course-art-runtime', 'runtime manifest');
  }
  fs.writeFileSync(path.join(packOut, 'manifest.json'), stableJson(manifest));
  return {
    packId: entry.packId,
    courseId: entry.courseId,
    legacyMatch: entry.legacyMatch,
    manifest: `packs/${entry.packId}/manifest.json`,
  };
}

function atomicPublish(stagingRoot, outputRoot) {
  const parent = path.dirname(outputRoot);
  fs.mkdirSync(parent, { recursive: true });
  if (!fs.existsSync(outputRoot)) {
    fs.renameSync(stagingRoot, outputRoot);
    return;
  }
  const nonce = crypto.randomBytes(8).toString('hex');
  const backup = path.join(parent, `.${path.basename(outputRoot)}.backup-${process.pid}-${nonce}`);
  fs.renameSync(outputRoot, backup);
  try {
    fs.renameSync(stagingRoot, outputRoot);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(outputRoot) && fs.existsSync(backup)) fs.renameSync(backup, outputRoot);
    throw error;
  }
}

async function stageSourceCourseArt({ sourceRoot, outputRoot }) {
  if (!sourceRoot || !outputRoot) throw artError('ART_PACK_INVALID', 'course-art-source', 'Source and output roots are required');
  const sourceReal = fs.realpathSync(sourceRoot);
  const outputAbsolute = path.resolve(outputRoot);
  if (isInside(sourceReal, outputAbsolute) || isInside(outputAbsolute, sourceReal)) {
    throw artError('ART_PACK_INVALID', 'course-art-source', 'Source and output roots must be separate');
  }
  const index = readJson(
    resolveOwnedPath(sourceReal, 'index.json', { code: 'ART_PACK_INVALID' }),
    validators.validateSourceIndex,
    { label: 'source index' },
  );
  assertIndexConflicts(index);
  const nonce = crypto.randomBytes(8).toString('hex');
  const stagingRoot = path.join(
    path.dirname(outputAbsolute),
    `.${path.basename(outputAbsolute)}.staging-${process.pid}-${nonce}`,
  );
  fs.mkdirSync(stagingRoot, { recursive: true });
  try {
    const runtimeEntries = [];
    for (const entry of [...index.packs].sort((left, right) => left.packId.localeCompare(right.packId))) {
      const packDir = resolveOwnedPath(sourceReal, entry.source, {
        code: 'ART_PACK_INVALID',
      });
      if (!fs.statSync(packDir).isDirectory()) {
        throw artError('ART_PACK_INVALID', 'course-art-source', 'Pack source is not a directory');
      }
      const profile = readJson(
        resolveOwnedPath(packDir, 'profile.json', { code: 'ART_PACK_INVALID' }),
        validators.validateSourceProfile,
        { label: 'source profile' },
      );
      runtimeEntries.push(writeRuntimePack(stagingRoot, entry, profile, packDir));
    }
    const runtimeIndex = { version: 1, packs: runtimeEntries };
    if (!validators.validateRuntimeIndex(runtimeIndex)) {
      throw schemaError(validators.validateRuntimeIndex, 'course-art-runtime', 'runtime index');
    }
    fs.writeFileSync(path.join(stagingRoot, 'index.json'), stableJson(runtimeIndex));
    atomicPublish(stagingRoot, outputAbsolute);
    return {
      outputRoot: outputAbsolute,
      packCount: runtimeEntries.length,
      contentHash: sha256(Buffer.from(stableStringify(runtimeIndex))),
    };
  } catch (error) {
    if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function runtimeDiagnostic(code, courseId) {
  return {
    code,
    severity: 'warning',
    stage: 'course-art-runtime',
    courseId: courseId || null,
    message: 'Curated course presentation is unavailable.',
    recovery: 'Restage or reinstall the curated course-art pack.',
  };
}

function loadRuntimeCourseArt({
  runtimeRoot,
  courseId,
  legacyIdentity,
  disabled = false,
}) {
  if (disabled) return { status: 'disabled', runtimePack: null, diagnostics: [] };
  if (!runtimeRoot || !fs.existsSync(path.join(runtimeRoot, 'index.json'))) {
    return { status: 'absent', runtimePack: null, diagnostics: [] };
  }
  let index;
  try {
    const indexPath = resolveOwnedPath(runtimeRoot, 'index.json', {
      code: 'ART_PACK_INVALID',
      stage: 'course-art-runtime',
    });
    index = readJson(
      indexPath,
      validators.validateRuntimeIndex,
      { stage: 'course-art-runtime', label: 'runtime index' },
    );
    assertIndexConflicts({
      packs: index.packs.map((entry) => ({ ...entry, source: entry.manifest })),
    });
  } catch (error) {
    const code = error?.code === 'ART_PACK_VERSION_UNSUPPORTED'
      ? 'ART_PACK_VERSION_UNSUPPORTED'
      : 'ART_PACK_INVALID';
    return {
      status: 'rejected',
      runtimePack: null,
      diagnostics: [runtimeDiagnostic(code, courseId)],
    };
  }
  const stableSelection = index.packs.find((entry) => entry.courseId === courseId);
  const legacySelection = stableSelection ? null :
    index.packs.find((entry) => legacyIdentity && entry.legacyMatch.names.some((name) =>
      legacyIdentityMatches({
        requestedName: legacyIdentity.name,
        requestedOrigin: legacyIdentity.origin,
        cachedName: name,
        cachedOrigin: entry.legacyMatch.origin,
        toleranceM: entry.legacyMatch.origin.toleranceM,
      })));
  const selected = stableSelection || legacySelection;
  if (!selected) return { status: 'absent', runtimePack: null, diagnostics: [] };

  try {
    const manifestPath = resolveOwnedPath(runtimeRoot, selected.manifest, {
      code: 'ART_PACK_INVALID',
      stage: 'course-art-runtime',
    });
    const manifest = readJson(
      manifestPath,
      validators.validateRuntimeManifest,
      { stage: 'course-art-runtime', label: 'runtime manifest' },
    );
    if (manifest.packId !== selected.packId || manifest.courseId !== selected.courseId ||
        !sameJson(manifest.legacyMatch, selected.legacyMatch)) {
      throw artError('ART_PACK_IDENTITY_MISMATCH', 'course-art-runtime', 'Runtime index and manifest identity disagree');
    }
    const packDir = path.dirname(manifestPath);
    const assetPaths = {};
    const verifiedAssets = {};
    let totalBytes = 0;
    for (const asset of manifest.assets) {
      const assetPath = resolveOwnedPath(packDir, asset.file, {
        code: 'ART_ASSET_INVALID',
        stage: 'course-art-runtime',
      });
      const verified = readVerifiedRuntimeAsset(assetPath, asset);
      const inspected = verified.inspected;
      totalBytes += inspected.bytes;
      if (inspected.bytes !== asset.bytes || inspected.sha256 !== asset.sha256 ||
          (asset.width != null && (asset.width !== inspected.width || asset.height !== inspected.height))) {
        throw artError('ART_ASSET_INVALID', 'course-art-runtime', 'Runtime asset metadata disagrees with bytes');
      }
      assetPaths[asset.key] = assetPath;
      verifiedAssets[asset.key] = verified;
    }
    if (totalBytes > LIMITS.MAX_TOTAL_ASSET_BYTES) {
      throw artError('ART_ASSET_INVALID', 'course-art-runtime', 'Runtime pack exceeds total asset budget');
    }
    const runtimePack = { ...manifest };
    Object.defineProperty(runtimePack, 'assetPaths', {
      value: Object.freeze(assetPaths),
      enumerable: false,
    });
    Object.defineProperty(runtimePack, 'verifiedAssets', {
      value: Object.freeze(verifiedAssets),
      enumerable: false,
    });
    return {
      status: 'valid',
      runtimePack: Object.freeze(runtimePack),
      diagnostics: [],
      selection: Object.freeze({
        mode: stableSelection ? 'stable' : 'legacy',
        requestedCourseId: courseId,
        selectedCourseId: selected.courseId,
      }),
    };
  } catch (error) {
    const code = ['ART_PACK_IDENTITY_MISMATCH', 'ART_ASSET_INVALID', 'ART_PACK_VERSION_UNSUPPORTED']
      .includes(error?.code)
      ? error.code
      : 'ART_PACK_INVALID';
    return {
      status: 'rejected',
      runtimePack: null,
      diagnostics: [runtimeDiagnostic(code, selected.courseId)],
    };
  }
}

module.exports = {
  CourseArtError,
  inspectRuntimeAsset,
  inspectRuntimeAssetBytes,
  readVerifiedRuntimeAsset,
  loadRuntimeCourseArt,
  stageSourceCourseArt,
};
