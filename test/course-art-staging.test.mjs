import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { main as generateValidator } from '../tools/course-art/generate-validator.mjs';
import {
  inspectRuntimeAsset,
  loadRuntimeCourseArt,
  stageSourceCourseArt,
} from '../lib/course-art-assets.js';
import packagedSmoke from '../tools/course-art/packaged-smoke.cjs';

const require = createRequire(import.meta.url);
const { validateRuntimeIndex, validateRuntimeManifest } = require('../lib/generated/course-art-pack-validator');
const { smokeRuntimeCourseArt } = packagedSmoke;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const legacyMatch = {
  names: ['Test Links'],
  origin: { lat: 47.2, lon: -122.5, toleranceM: 250 },
};

function sourceProfile(overrides = {}) {
  return {
    version: 1,
    courseId: 'osm:way:91001',
    displayName: 'Test Links',
    legacyMatch,
    tier: 'curated',
    character: { biome: 'pnw-links', dryness: 0.85 },
    world: {},
    atmosphere: {},
    materials: {},
    components: {
      references: 'references.json',
      landmarks: 'landmarks.json',
      vegetation: 'vegetation.json',
    },
    gameplay: {},
    assets: {},
    ...overrides,
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeSource({ profile = sourceProfile(), files = {} } = {}) {
  const sourceRoot = tmp('course-art-source-');
  const packDir = path.join(sourceRoot, 'test-links');
  fs.mkdirSync(packDir, { recursive: true });
  writeJson(path.join(sourceRoot, 'index.json'), {
    version: 1,
    packs: [{
      packId: 'test-links',
      courseId: profile.courseId,
      legacyMatch: profile.legacyMatch,
      source: 'test-links',
    }],
  });
  writeJson(path.join(packDir, 'profile.json'), profile);
  writeJson(path.join(packDir, 'references.json'), {
    version: 1,
    references: [{ title: 'Authoring proof', url: 'https://example.test/photo', license: 'test-only' }],
  });
  writeJson(path.join(packDir, 'landmarks.json'), { version: 1, features: [] });
  writeJson(path.join(packDir, 'vegetation.json'), { version: 1, rules: [] });
  for (const [relative, bytes] of Object.entries(files)) {
    const target = path.join(packDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  return { sourceRoot, packDir };
}

function readRuntime(outputRoot) {
  const index = JSON.parse(fs.readFileSync(path.join(outputRoot, 'index.json'), 'utf8'));
  const manifestPath = path.join(outputRoot, ...index.packs[0].manifest.split('/'));
  return {
    index,
    manifestPath,
    manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
  };
}

function treeDigest(root) {
  const records = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else records.push([relative, sha256(fs.readFileSync(absolute))]);
    }
  }
  walk(root);
  return sha256(Buffer.from(JSON.stringify(records)));
}

async function png(width = 2, height = 2) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 20, g: 120, b: 40, alpha: 1 } },
  }).png().toBuffer();
}

function glb(json, bin = null) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPad = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const chunks = [];
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPad.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  chunks.push(jsonHeader, jsonPad);
  if (bin) {
    const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binPad.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
    chunks.push(binHeader, binPad);
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + body.length, 8);
  return Buffer.concat([header, body]);
}

test('minimal source pack stages atomically and deterministically without authoring references', async () => {
  const { sourceRoot } = await makeSource();
  const outputA = path.join(tmp('course-art-out-'), 'course-art');
  const outputB = path.join(tmp('course-art-out-'), 'course-art');
  await stageSourceCourseArt({ sourceRoot, outputRoot: outputA });
  await stageSourceCourseArt({ sourceRoot, outputRoot: outputB });

  const a = readRuntime(outputA);
  assert.equal(validateRuntimeIndex(a.index), true, JSON.stringify(validateRuntimeIndex.errors));
  assert.equal(validateRuntimeManifest(a.manifest), true, JSON.stringify(validateRuntimeManifest.errors));
  assert.equal(a.manifest.presentation.character.dryness, 0.85);
  assert.equal(a.manifest.assets.length, 0);
  assert.equal(treeDigest(outputA), treeDigest(outputB));
  assert.equal(fs.existsSync(path.join(outputA, 'packs', 'test-links', 'references.json')), false);
  assert.ok(!JSON.stringify(a.manifest).includes('references.json'));
});

test('missing optional assets prune every optional referencing feature; required assets reject', async () => {
  const optional = sourceProfile({
    ...sourceProfile(),
    assets: {
      shared: { path: 'assets/missing.png', mime: 'image/png', required: false },
    },
    inlineFeatures: [
      { id: 'a', required: false, assetKeys: ['shared'], payload: {} },
      { id: 'b', required: false, assetKeys: ['shared'], payload: {} },
    ],
  });
  const { sourceRoot } = await makeSource({ profile: optional });
  const outputRoot = path.join(tmp('course-art-out-'), 'course-art');
  await stageSourceCourseArt({ sourceRoot, outputRoot });
  const { manifest } = readRuntime(outputRoot);
  assert.deepEqual(manifest.assets, []);
  assert.deepEqual(manifest.features, []);

  const required = sourceProfile({
    ...sourceProfile(),
    assets: {
      clubhouse: { path: 'assets/missing.glb', mime: 'model/gltf-binary', required: true },
    },
  });
  const requiredSource = await makeSource({ profile: required });
  await assert.rejects(
    () => stageSourceCourseArt({
      sourceRoot: requiredSource.sourceRoot,
      outputRoot: path.join(tmp('course-art-out-'), 'course-art'),
    }),
    (error) => error.code === 'ART_ASSET_MISSING',
  );
});

test('required features may reference required assets only', async () => {
  const image = await png();
  const profile = sourceProfile({
    ...sourceProfile(),
    assets: {
      optional: { path: 'assets/tree.png', mime: 'image/png', required: false },
    },
    inlineFeatures: [{
      id: 'required-tree',
      required: true,
      assetKeys: ['optional'],
      payload: {},
    }],
  });
  const { sourceRoot } = await makeSource({
    profile,
    files: { 'assets/tree.png': image },
  });
  await assert.rejects(
    () => stageSourceCourseArt({
      sourceRoot,
      outputRoot: path.join(tmp('course-art-out-'), 'course-art'),
    }),
    (error) => error.code === 'ART_PACK_INVALID',
  );
});

test('duplicate feature IDs and oversized JSON roots reject before publication', async () => {
  const duplicateProfile = sourceProfile({
    ...sourceProfile(),
    inlineFeatures: [
      { id: 'duplicate', required: false, assetKeys: [], payload: {} },
      { id: 'duplicate', required: false, assetKeys: [], payload: {} },
    ],
  });
  const duplicate = await makeSource({ profile: duplicateProfile });
  await assert.rejects(
    () => stageSourceCourseArt({
      sourceRoot: duplicate.sourceRoot,
      outputRoot: path.join(tmp('course-art-out-'), 'course-art'),
    }),
    (error) => error.code === 'ART_PACK_CONFLICT',
  );

  const oversized = await makeSource();
  const indexPath = path.join(oversized.sourceRoot, 'index.json');
  const handle = fs.openSync(indexPath, 'w');
  try {
    fs.ftruncateSync(handle, (1024 * 1024) + 1);
  } finally {
    fs.closeSync(handle);
  }
  const outputRoot = path.join(tmp('course-art-out-'), 'course-art');
  await assert.rejects(
    () => stageSourceCourseArt({ sourceRoot: oversized.sourceRoot, outputRoot }),
    (error) => error.code === 'ART_PACK_INVALID',
  );
  assert.equal(fs.existsSync(outputRoot), false);
});

test('index/profile disagreement, duplicate identity, and overlapping aliases reject the stage', async () => {
  const { sourceRoot } = await makeSource();
  const indexPath = path.join(sourceRoot, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  index.packs[0].courseId = 'osm:way:91002';
  writeJson(indexPath, index);
  await assert.rejects(
    () => stageSourceCourseArt({ sourceRoot, outputRoot: path.join(tmp('course-art-out-'), 'course-art') }),
    (error) => error.code === 'ART_PACK_IDENTITY_MISMATCH',
  );

  const duplicate = await makeSource();
  const duplicateIndexPath = path.join(duplicate.sourceRoot, 'index.json');
  const duplicateIndex = JSON.parse(fs.readFileSync(duplicateIndexPath, 'utf8'));
  duplicateIndex.packs.push({ ...duplicateIndex.packs[0], packId: 'other', source: 'test-links' });
  writeJson(duplicateIndexPath, duplicateIndex);
  await assert.rejects(
    () => stageSourceCourseArt({
      sourceRoot: duplicate.sourceRoot,
      outputRoot: path.join(tmp('course-art-out-'), 'course-art'),
    }),
    (error) => error.code === 'ART_PACK_CONFLICT',
  );

  const overlap = await makeSource();
  const secondDir = path.join(overlap.sourceRoot, 'second-links');
  fs.mkdirSync(secondDir);
  const secondProfile = sourceProfile({
    ...sourceProfile(),
    courseId: 'osm:way:91002',
    displayName: 'Second Links',
    legacyMatch: {
      names: [' test   LINKS '],
      origin: { lat: 48, lon: -123, toleranceM: 250 },
    },
    components: {},
  });
  writeJson(path.join(secondDir, 'profile.json'), secondProfile);
  const overlapIndexPath = path.join(overlap.sourceRoot, 'index.json');
  const overlapIndex = JSON.parse(fs.readFileSync(overlapIndexPath, 'utf8'));
  overlapIndex.packs.push({
    packId: 'second-links',
    courseId: secondProfile.courseId,
    legacyMatch: secondProfile.legacyMatch,
    source: 'second-links',
  });
  writeJson(overlapIndexPath, overlapIndex);
  await assert.rejects(
    () => stageSourceCourseArt({
      sourceRoot: overlap.sourceRoot,
      outputRoot: path.join(tmp('course-art-out-'), 'course-art'),
    }),
    (error) => error.code === 'ART_PACK_CONFLICT',
  );
});

test('asset paths reject traversal, absolute/device/UNC/ADS forms and Windows collisions', async () => {
  const badPaths = [
    '../escape.png',
    '/absolute.png',
    'C:/drive.png',
    '\\\\server\\share\\asset.png',
    '\\\\.\\NUL',
    'assets/file.png:stream',
    'assets/CON.png',
    'assets/trailing. ',
  ];
  for (const assetPath of badPaths) {
    const profile = sourceProfile({
      ...sourceProfile(),
      assets: { bad: { path: assetPath, mime: 'image/png', required: false } },
    });
    const { sourceRoot } = await makeSource({ profile });
    await assert.rejects(
      () => stageSourceCourseArt({ sourceRoot, outputRoot: path.join(tmp('course-art-out-'), 'course-art') }),
      (error) => error.code === 'ART_ASSET_INVALID',
      assetPath,
    );
  }

  const image = await png();
  const collisionProfile = sourceProfile({
    ...sourceProfile(),
    assets: {
      upper: { path: 'assets/Tree.png', mime: 'image/png', required: true },
      lower: { path: 'assets/tree.png', mime: 'image/png', required: true },
    },
  });
  const collision = await makeSource({
    profile: collisionProfile,
    files: { 'assets/Tree.png': image, 'assets/tree.png': image },
  });
  await assert.rejects(
    () => stageSourceCourseArt({
      sourceRoot: collision.sourceRoot,
      outputRoot: path.join(tmp('course-art-out-'), 'course-art'),
    }),
    (error) => error.code === 'ART_ASSET_INVALID',
  );
});

test('symlink escape rejects where the environment permits symlink creation', async (t) => {
  const image = await png();
  const outside = path.join(tmp('course-art-outside-'), 'outside.png');
  fs.writeFileSync(outside, image);
  const profile = sourceProfile({
    ...sourceProfile(),
    assets: { escaped: { path: 'assets/escaped.png', mime: 'image/png', required: true } },
  });
  const { sourceRoot, packDir } = await makeSource({ profile });
  fs.mkdirSync(path.join(packDir, 'assets'), { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(packDir, 'assets', 'escaped.png'), 'file');
  } catch (error) {
    t.skip(`symlink unavailable: ${error.code}`);
    return;
  }
  await assert.rejects(
    () => stageSourceCourseArt({ sourceRoot, outputRoot: path.join(tmp('course-art-out-'), 'course-art') }),
    (error) => error.code === 'ART_ASSET_INVALID',
  );
});

test('extension, MIME, magic, dimensions, and byte limits fail closed even for optional assets', async () => {
  const image = await png();
  const cases = [
    { path: 'assets/image.jpg', mime: 'image/png', bytes: image },
    { path: 'assets/image.png', mime: 'image/png', bytes: Buffer.from('not-png') },
  ];
  for (const entry of cases) {
    const profile = sourceProfile({
      ...sourceProfile(),
      assets: { image: { path: entry.path, mime: entry.mime, required: false } },
    });
    const { sourceRoot } = await makeSource({ profile, files: { [entry.path]: entry.bytes } });
    await assert.rejects(
      () => stageSourceCourseArt({ sourceRoot, outputRoot: path.join(tmp('course-art-out-'), 'course-art') }),
      (error) => error.code === 'ART_ASSET_INVALID',
    );
  }

  const oversized = path.join(tmp('course-art-oversized-'), 'huge.png');
  const descriptor = fs.openSync(oversized, 'w');
  try {
    fs.ftruncateSync(descriptor, (128 * 1024 * 1024) + 1);
  } finally {
    fs.closeSync(descriptor);
  }
  assert.throws(
    () => inspectRuntimeAsset(oversized, { mime: 'image/png' }),
    (error) => error.code === 'ART_ASSET_INVALID',
  );
});

test('GLB inspection rejects malformed chunks, URIs, and out-of-range bufferViews', () => {
  const root = tmp('course-art-glb-');
  const entries = [
    Buffer.from('glTF'),
    glb({ asset: { version: '2.0' }, buffers: [{ uri: 'data:application/octet-stream;base64,AA==' }] }),
    glb({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 4 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 99 }],
      images: [{ bufferView: 0, mimeType: 'image/png' }],
    }, Buffer.alloc(4)),
  ];
  for (const [index, bytes] of entries.entries()) {
    const file = path.join(root, `bad-${index}.glb`);
    fs.writeFileSync(file, bytes);
    assert.throws(
      () => inspectRuntimeAsset(file, { mime: 'model/gltf-binary' }),
      (error) => error.code === 'ART_ASSET_INVALID',
    );
  }

  const oversizedPng = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversizedPng);
  oversizedPng.writeUInt32BE(13, 8);
  oversizedPng.write('IHDR', 12, 'ascii');
  oversizedPng.writeUInt32BE(8193, 16);
  oversizedPng.writeUInt32BE(1, 20);
  const oversizedEmbedded = glb({
    asset: { version: '2.0' },
    buffers: [{ byteLength: oversizedPng.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: oversizedPng.length }],
    images: [{ bufferView: 0, mimeType: 'image/png' }],
  }, oversizedPng);
  const file = path.join(root, 'oversized-embedded.glb');
  fs.writeFileSync(file, oversizedEmbedded);
  assert.throws(
    () => inspectRuntimeAsset(file, { mime: 'model/gltf-binary' }),
    (error) => error.code === 'ART_ASSET_INVALID',
  );
});

test('runtime loader validates staged index, identity, manifest, and private asset bytes', async () => {
  const image = await png();
  const profile = sourceProfile({
    ...sourceProfile(),
    assets: {
      turf: { path: 'assets/turf.png', mime: 'image/png', required: true },
    },
  });
  const { sourceRoot } = await makeSource({
    profile,
    files: { 'assets/turf.png': image },
  });
  const runtimeRoot = path.join(tmp('course-art-out-'), 'course-art');
  await stageSourceCourseArt({ sourceRoot, outputRoot: runtimeRoot });

  const valid = loadRuntimeCourseArt({
    runtimeRoot,
    courseId: profile.courseId,
  });
  assert.equal(valid.status, 'valid');
  assert.equal(valid.runtimePack.courseId, profile.courseId);
  assert.deepEqual(Object.keys(valid.runtimePack.assetPaths), ['turf']);
  assert.ok(!JSON.stringify(valid.runtimePack).includes(runtimeRoot), 'private paths are non-enumerable');

  assert.equal(loadRuntimeCourseArt({
    runtimeRoot,
    courseId: 'osm:way:99999',
  }).status, 'absent');
  assert.equal(loadRuntimeCourseArt({
    runtimeRoot,
    courseId: profile.courseId,
    disabled: true,
  }).status, 'disabled');

  const runtime = readRuntime(runtimeRoot);
  const originalManifest = fs.readFileSync(runtime.manifestPath);
  writeJson(runtime.manifestPath, { ...runtime.manifest, version: 2 });
  const unsupported = loadRuntimeCourseArt({ runtimeRoot, courseId: profile.courseId });
  assert.equal(unsupported.status, 'rejected');
  assert.equal(unsupported.diagnostics[0].code, 'ART_PACK_VERSION_UNSUPPORTED');
  fs.writeFileSync(runtime.manifestPath, originalManifest);

  const assetPath = valid.runtimePack.assetPaths.turf;
  fs.writeFileSync(assetPath, Buffer.from('tampered'));
  const rejected = loadRuntimeCourseArt({ runtimeRoot, courseId: profile.courseId });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.diagnostics.length, 1);
  assert.equal(rejected.diagnostics[0].code, 'ART_ASSET_INVALID');
  assert.ok(!JSON.stringify(rejected).includes(runtimeRoot));
});

test('curated source stages and unpacked packaged smoke imports validator plus manifests', async () => {
  const runtimeRoot = path.join(tmp('course-art-curated-'), 'course-art');
  await stageSourceCourseArt({
    sourceRoot: path.join(REPO, 'courses', 'curated'),
    outputRoot: runtimeRoot,
  });
  assert.deepEqual(smokeRuntimeCourseArt({ runtimeRoot }), { status: 'valid', packCount: 1 });
  const { manifest } = readRuntime(runtimeRoot);
  assert.equal(manifest.courseId, 'osm:way:26787026');
  assert.equal(manifest.presentation.character.dryness, 0.85);
  assert.deepEqual(manifest.assets, [], 'missing optional placeholder asset is pruned');
});

test('generated validator is current, dependency-free, and executes without node_modules', async () => {
  const output = path.join(tmp('course-art-validator-'), 'validator.cjs');
  await generateValidator(['--output', output]);
  const committed = fs.readFileSync(path.join(REPO, 'lib', 'generated', 'course-art-pack-validator.js'));
  assert.ok(fs.readFileSync(output).equals(committed), 'generated validator is stale');
  const text = committed.toString('utf8');
  assert.doesNotMatch(text, /\brequire\s*\(\s*["'][^.]|import\s*\(/);

  const isolated = tmp('course-art-isolated-');
  fs.copyFileSync(output, path.join(isolated, 'validator.cjs'));
  const script = [
    "const v=require('./validator.cjs');",
    "if(!v.validateRuntimeIndex({version:1,packs:[]})) process.exit(2);",
  ].join('');
  fs.writeFileSync(path.join(isolated, 'smoke.cjs'), script);
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['smoke.cjs'], { cwd: isolated, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('simulated unpacked resources smoke has no authoring files or runtime package imports', async () => {
  const runtimeRoot = path.join(tmp('course-art-runtime-'), 'course-art');
  await stageSourceCourseArt({
    sourceRoot: path.join(REPO, 'courses', 'curated'),
    outputRoot: runtimeRoot,
  });
  const unpacked = tmp('course-art-unpacked-');
  const appRoot = path.join(unpacked, 'resources', 'app');
  const packagedRuntime = path.join(unpacked, 'resources', 'course-art');
  const validatorTarget = path.join(appRoot, 'lib', 'generated', 'course-art-pack-validator.js');
  const smokeTarget = path.join(appRoot, 'tools', 'course-art', 'packaged-smoke.cjs');
  fs.mkdirSync(path.dirname(validatorTarget), { recursive: true });
  fs.mkdirSync(path.dirname(smokeTarget), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'lib', 'generated', 'course-art-pack-validator.js'), validatorTarget);
  fs.copyFileSync(path.join(REPO, 'tools', 'course-art', 'packaged-smoke.cjs'), smokeTarget);
  fs.cpSync(runtimeRoot, packagedRuntime, { recursive: true });

  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, [smokeTarget, packagedRuntime], {
    cwd: appRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"status":"valid"/);
  assert.equal(fs.existsSync(path.join(appRoot, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(packagedRuntime, 'references.json')), false);

  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('!lib/schemas/course-art-*.schema.json'));
  assert.ok(pkg.build.files.includes('tools/course-art/packaged-smoke.cjs'));
  assert.equal(pkg.build.extraResources[0].to, 'course-art');
});
