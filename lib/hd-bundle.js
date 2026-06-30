'use strict';

// Runtime contract + validator for HD hole bundles.
//
// This module ships inside the packaged Electron runtime, so it is deliberately
// dependency-light: Node core only (crypto/fs/path), hand-rolled image header
// parsing, and explicit schema-v1 checks. It must NOT import the compiler-only
// ESM tooling (ajv/sharp/geotiff/proj4). It never throws on an untrusted bundle:
// validateBundleDirectory returns a typed status — 'absent' | 'rejected' |
// 'valid' — so the runtime can distinguish "no bundle" from "bad bundle".

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HD_SCHEMA_VERSION = 1;

// schema-v1 mask packing: surfaces.png R/G/B/A, coverage.png R/G. Rough is the
// implicit default where no surface channel wins.
const SURFACE_CHANNELS = Object.freeze({
  surfaces: Object.freeze({ r: 'fairway', g: 'green', b: 'tee', a: 'bunker' }),
  coverage: Object.freeze({ r: 'validity', g: 'water' }),
});

// Defensive hard limits — the bundle is untrusted input.
const MAX_DIM = 20000;
const MAX_TERRAIN_CELLS = 64 * 1024 * 1024;
const HEX64 = /^[a-f0-9]{64}$/;

function rejectErr(code, message) {
  const e = new Error(message);
  e.code = code;
  e.rejected = true;
  return e;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Canonical course fingerprint — MUST stay byte-identical to the compiler's
// tools/hd-course/course-source.mjs (cross-checked by test/hd-bundle.test.js).
// Duplicated rather than imported because that module is ESM and this is CJS.
// ---------------------------------------------------------------------------
function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}
function sortedByCanonical(arr) {
  return [...(arr || [])]
    .map((el) => [stableStringify(el), el])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map((pair) => pair[1]);
}
function canonicalCourse(course) {
  const e = course.elevation;
  return {
    version: course.version ?? null,
    name: course.name ?? null,
    origin: course.origin ? { lat: course.origin.lat, lon: course.origin.lon } : null,
    boundary: course.boundary ?? null,
    surfaces: sortedByCanonical((course.surfaces || []).map((s) => ({ kind: s.kind, poly: s.poly }))),
    holes: sortedByCanonical((course.holes || []).map((h) => ({
      ref: h.ref ?? null, par: h.par ?? null, name: h.name ?? null,
      tee: h.tee ?? null, pin: h.pin ?? null, line: h.line ?? null, lengthYd: h.lengthYd ?? null,
    }))),
    trees: sortedByCanonical(course.trees || []),
    woods: sortedByCanonical(course.woods || []),
    elevation: e
      ? { minX: e.minX, minY: e.minY, cellM: e.cellM, nx: e.nx, ny: e.ny, baseM: e.baseM, heights: e.heights }
      : null,
  };
}
function courseFingerprint(course) {
  return crypto.createHash('sha256').update(stableStringify(canonicalCourse(course))).digest('hex');
}

// ---------------------------------------------------------------------------
// Safe asset paths (bundle-relative, forward-slash canonical).
// ---------------------------------------------------------------------------
const DRIVE_LETTER = /^[A-Za-z]:/;
function safeSegment(seg) {
  if (typeof seg !== 'string' || !seg || seg === '.' || seg === '..' ||
      seg.includes('\\') || seg.includes('\0') || DRIVE_LETTER.test(seg)) {
    throw rejectErr('HD_PATH_TRAVERSAL', `unsafe path segment: ${JSON.stringify(seg)}`);
  }
  return seg;
}
function resolveAssetPath(bundleDir, relPath) {
  if (typeof relPath !== 'string' || !relPath) throw rejectErr('HD_PATH_TRAVERSAL', 'empty asset path');
  const segments = relPath.split('/').map(safeSegment);
  const base = path.resolve(bundleDir);
  const resolved = path.join(base, ...segments);
  const rel = path.relative(base, resolved);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw rejectErr('HD_PATH_TRAVERSAL', `asset escapes bundle: ${relPath}`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Image header parsing: magic + dimensions for PNG, WebP (VP8/VP8L/VP8X), JPEG.
// ---------------------------------------------------------------------------
function readImageInfo(buf) {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('ascii', 12, 16);
    if (fourcc === 'VP8 ') {
      return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === 'VP8X') {
      return { format: 'webp', width: (buf.readUIntLE(24, 3) & 0xffffff) + 1, height: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
    }
    return { format: 'webp', width: 0, height: 0 };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off += 1; continue; }
      const marker = buf[off + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + buf.readUInt16BE(off + 2);
    }
    return { format: 'jpeg', width: 0, height: 0 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Terrain decode: exact little-endian Float32, finite, bounded.
// ---------------------------------------------------------------------------
function decodeTerrainF32(buf, nx, ny) {
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx <= 0 || ny <= 0) {
    throw rejectErr('HD_TERRAIN_DIMS', `bad terrain dims ${nx}x${ny}`);
  }
  if (nx > MAX_DIM || ny > MAX_DIM || nx * ny > MAX_TERRAIN_CELLS) {
    throw rejectErr('HD_TERRAIN_TOO_LARGE', `terrain ${nx}x${ny} exceeds limits`);
  }
  const expected = nx * ny * 4;
  if (buf.length !== expected) {
    throw rejectErr('HD_TERRAIN_LENGTH', `terrain bytes ${buf.length} != ${expected}`);
  }
  const out = new Float32Array(nx * ny);
  for (let i = 0; i < out.length; i += 1) {
    const v = buf.readFloatLE(i * 4);
    if (!Number.isFinite(v)) throw rejectErr('HD_TERRAIN_NONFINITE', `non-finite height at index ${i}`);
    out[i] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Manifest checks (hand-rolled schema v1).
// ---------------------------------------------------------------------------
function validateManifest(m) {
  if (!m || typeof m !== 'object') throw rejectErr('HD_MANIFEST_SHAPE', 'manifest is not an object');
  if (m.schemaVersion !== HD_SCHEMA_VERSION) throw rejectErr('HD_SCHEMA_VERSION', `unsupported schemaVersion ${m.schemaVersion}`);
  if (!m.course || typeof m.course.fingerprint !== 'string' || !HEX64.test(m.course.fingerprint)) {
    throw rejectErr('HD_MANIFEST_FINGERPRINT', 'missing or invalid course fingerprint');
  }
  if (!Number.isInteger(m.hole) || m.hole < 1 || m.hole > 18) throw rejectErr('HD_MANIFEST_HOLE', 'invalid hole number');

  const b = m.bounds;
  if (!b || !isNum(b.minX) || !isNum(b.minY) || !isNum(b.maxX) || !isNum(b.maxY) || b.maxX <= b.minX || b.maxY <= b.minY) {
    throw rejectErr('HD_MANIFEST_BOUNDS', 'invalid bounds');
  }

  for (const key of ['terrain', 'image', 'surfaces', 'coverage']) {
    const a = m[key];
    if (!a || typeof a.file !== 'string' || typeof a.sha256 !== 'string' || !HEX64.test(a.sha256) ||
        !Number.isInteger(a.bytes) || a.bytes <= 0) {
      throw rejectErr('HD_MANIFEST_ASSET', `invalid asset descriptor: ${key}`);
    }
  }

  const t = m.terrain;
  if (!Number.isInteger(t.nx) || !Number.isInteger(t.ny) || t.nx <= 0 || t.ny <= 0 ||
      !isNum(t.cellM) || t.cellM <= 0 || !isNum(t.baseM) || t.byteOrder !== 'LE') {
    throw rejectErr('HD_MANIFEST_TERRAIN', 'invalid terrain descriptor');
  }
  // Base-grid consistency: nx/ny points at cellM spacing must span the bounds.
  const tol = Math.max(1e-6, t.cellM * 1e-3);
  if (Math.abs((t.nx - 1) * t.cellM - (b.maxX - b.minX)) > tol ||
      Math.abs((t.ny - 1) * t.cellM - (b.maxY - b.minY)) > tol) {
    throw rejectErr('HD_GRID_MISMATCH', 'terrain grid inconsistent with bounds');
  }

  for (const key of ['image', 'surfaces', 'coverage']) {
    const a = m[key];
    if (!Number.isInteger(a.width) || !Number.isInteger(a.height) ||
        a.width <= 0 || a.height <= 0 || a.width > MAX_DIM || a.height > MAX_DIM) {
      throw rejectErr('HD_MANIFEST_IMAGE', `invalid image dimensions: ${key}`);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Directory validation → typed status.
// ---------------------------------------------------------------------------
function listFilesRel(dir) {
  const out = [];
  (function walk(d, prefix) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) throw rejectErr('HD_SYMLINK', `symlink in bundle: ${rel}`);
      if (ent.isDirectory()) walk(path.join(d, ent.name), rel);
      else if (ent.isFile()) out.push(rel);
      else throw rejectErr('HD_UNEXPECTED_ENTRY', `non-file entry: ${rel}`);
    }
  })(dir, '');
  return out;
}

function validateBundleDirectory(bundleDir) {
  try {
    const manifestPath = path.join(bundleDir, 'manifest.json');
    if (!fs.existsSync(bundleDir) || !fs.existsSync(manifestPath)) return { status: 'absent' };

    const manifestRaw = fs.readFileSync(manifestPath);
    let manifest;
    try { manifest = JSON.parse(manifestRaw.toString('utf8')); }
    catch { throw rejectErr('HD_MANIFEST_JSON', 'manifest.json is not valid JSON'); }
    validateManifest(manifest);

    const assets = ['terrain', 'image', 'surfaces', 'coverage'].map((key) => ({ key, ...manifest[key] }));
    const allowed = new Set(['manifest.json', 'provenance.json', ...assets.map((a) => a.file)]);

    const present = listFilesRel(bundleDir);
    for (const rel of present) {
      if (!allowed.has(rel)) throw rejectErr('HD_UNEXPECTED_FILE', `unexpected file: ${rel}`);
    }
    if (!present.includes('provenance.json')) throw rejectErr('HD_MISSING_PROVENANCE', 'provenance.json is missing');

    for (const a of assets) {
      const assetPath = resolveAssetPath(bundleDir, a.file);
      if (!fs.existsSync(assetPath)) throw rejectErr('HD_MISSING_ASSET', `missing asset: ${a.file}`);
      const buf = fs.readFileSync(assetPath);
      if (buf.length !== a.bytes) throw rejectErr('HD_SIZE_MISMATCH', `size mismatch: ${a.file}`);
      if (sha256(buf) !== a.sha256) throw rejectErr('HD_HASH_MISMATCH', `hash mismatch: ${a.file}`);
      if (a.key === 'terrain') {
        decodeTerrainF32(buf, manifest.terrain.nx, manifest.terrain.ny);
      } else {
        const info = readImageInfo(buf);
        if (!info) throw rejectErr('HD_IMAGE_MAGIC', `unrecognized image: ${a.file}`);
        if (info.width !== a.width || info.height !== a.height) {
          throw rejectErr('HD_IMAGE_DIMENSION', `dimension mismatch ${a.file}: header ${info.width}x${info.height} vs manifest ${a.width}x${a.height}`);
        }
      }
    }

    return {
      status: 'valid',
      descriptor: {
        manifestSha256: sha256(manifestRaw),
        course: manifest.course,
        hole: manifest.hole,
        bounds: manifest.bounds,
        terrain: { nx: manifest.terrain.nx, ny: manifest.terrain.ny, cellM: manifest.terrain.cellM, baseM: manifest.terrain.baseM },
      },
    };
  } catch (e) {
    if (e && e.rejected) return { status: 'rejected', code: e.code, message: e.message };
    throw e;
  }
}

// Build a server-owned descriptor for one validated bundle dir: an injectable
// terrain grid (rebased to the course's baseM so it blends with the coarse grid),
// client-safe metadata (no absolute paths, no height arrays), and server-only
// asset paths. Assumes the dir already passed validateBundleDirectory.
function buildDescriptor(bundleDir, course) {
  const manifestRaw = fs.readFileSync(path.join(bundleDir, 'manifest.json'));
  const bundleId = sha256(manifestRaw);
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  const heights = decodeTerrainF32(fs.readFileSync(resolveAssetPath(bundleDir, manifest.terrain.file)), manifest.terrain.nx, manifest.terrain.ny);
  const offset = manifest.terrain.baseM - ((course.elevation && course.elevation.baseM) || 0);
  const rebased = new Array(heights.length);
  for (let i = 0; i < heights.length; i += 1) rebased[i] = heights[i] + offset;

  const grid = {
    minX: manifest.bounds.minX, minY: manifest.bounds.minY, cellM: manifest.terrain.cellM,
    nx: manifest.terrain.nx, ny: manifest.terrain.ny, heights: rebased, edgeBlendM: 0, kind: 'hd-hole',
  };
  const dims = (a) => ({ width: a.width, height: a.height, bytes: a.bytes, sha256: a.sha256 });
  const metadata = {
    bundleId,
    hole: manifest.hole,
    bounds: manifest.bounds,
    terrain: { nx: manifest.terrain.nx, ny: manifest.terrain.ny, cellM: manifest.terrain.cellM, bytes: manifest.terrain.bytes, sha256: manifest.terrain.sha256 },
    image: dims(manifest.image), surfaces: dims(manifest.surfaces), coverage: dims(manifest.coverage),
    assetKeys: ['terrain', 'orthophoto', 'surfaces', 'coverage'],
  };
  return {
    bundleId,
    bundleDir,
    hole: manifest.hole,
    grid,
    metadata,
    assetPaths: {
      terrain: resolveAssetPath(bundleDir, manifest.terrain.file),
      orthophoto: resolveAssetPath(bundleDir, manifest.image.file),
      surfaces: resolveAssetPath(bundleDir, manifest.surfaces.file),
      coverage: resolveAssetPath(bundleDir, manifest.coverage.file),
    },
  };
}

// Discover ALL valid HD bundles for a course on disk (one per hole) and return
// server-owned descriptors. Scans every hd-courses/<slug>/bundles/<id> dir
// (bounded), validates each, keeps those whose courseFingerprint matches, and
// dedups by hole — when a hole has multiple bundles (e.g. after a rebuild) the
// active.json pointer wins, else the newest. This is what lets the runtime render
// real 1 m relief on EVERY built hole at once, not just active.json's one.
function resolveHdBundles(course, { dataDir }) {
  const root = path.join(dataDir, 'hd-courses');
  if (!fs.existsSync(root)) return { status: 'absent' };
  const fingerprint = courseFingerprint(course);

  const candidates = []; // { bundleDir, hole, isActive, mtimeMs }
  for (const ent of fs.readdirSync(root, { withFileTypes: true }).slice(0, 64)) {
    if (!ent.isDirectory()) continue;
    const courseDir = path.join(root, ent.name);
    const bundlesDir = path.join(courseDir, 'bundles');
    if (!fs.existsSync(bundlesDir)) continue;

    // Which bundle does active.json point to? Used only as the dedup tie-break.
    let activeDir = null;
    try {
      const active = JSON.parse(fs.readFileSync(path.join(courseDir, 'active.json'), 'utf8'));
      if (active && typeof active.bundle === 'string') activeDir = path.resolve(resolveAssetPath(courseDir, active.bundle));
    } catch { /* missing/invalid active.json — fall back to mtime */ }

    for (const be of fs.readdirSync(bundlesDir, { withFileTypes: true }).slice(0, 64)) {
      if (!be.isDirectory()) continue;
      const bundleDir = path.join(bundlesDir, be.name);
      const res = validateBundleDirectory(bundleDir);
      if (res.status !== 'valid' || res.descriptor.course.fingerprint !== fingerprint) continue;
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(bundleDir).mtimeMs; } catch { /* ignore */ }
      candidates.push({ bundleDir, hole: res.descriptor.hole, isActive: activeDir === path.resolve(bundleDir), mtimeMs });
    }
  }
  if (candidates.length === 0) return { status: 'absent' };

  const byHole = new Map();
  for (const c of candidates) {
    const cur = byHole.get(c.hole);
    const better = !cur ||
      (c.isActive && !cur.isActive) ||
      (c.isActive === cur.isActive && c.mtimeMs > cur.mtimeMs);
    if (better) byHole.set(c.hole, c);
  }
  const descriptors = [...byHole.values()]
    .sort((a, b) => a.hole - b.hole)
    .map((c) => buildDescriptor(c.bundleDir, course));
  return { status: 'valid', descriptors };
}

// Back-compat singular resolver: the active-or-first bundle. Prefer
// resolveHdBundles for multi-patch rendering.
function resolveHdBundle(course, opts) {
  const r = resolveHdBundles(course, opts);
  if (r.status !== 'valid') return r;
  return { status: 'valid', descriptor: r.descriptors[0] };
}

module.exports = {
  HD_SCHEMA_VERSION,
  SURFACE_CHANNELS,
  courseFingerprint,
  validateManifest,
  decodeTerrainF32,
  validateBundleDirectory,
  resolveAssetPath,
  readImageInfo,
  resolveHdBundle,
  resolveHdBundles,
};
