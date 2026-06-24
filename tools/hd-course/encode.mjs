// Deterministic encoding + bundle assembly.
//
// Encodes terrain.f32 (explicit little-endian Float32, matching the base grid's
// 0.01 m quantization upstream), orthophoto.webp (Sharp, pinned settings), and
// surfaces/coverage.png (PNGJS). writeBundle assembles a bundle directory whose
// manifest.json is exactly what the Plan 1 runtime validator (lib/hd-bundle.js
// validateBundleDirectory) accepts — that reconciliation is enforced by tests.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function encodeTerrainF32(heights) {
  const buf = Buffer.alloc(heights.length * 4);
  for (let i = 0; i < heights.length; i += 1) buf.writeFloatLE(heights[i], i * 4);
  return buf;
}

export async function encodeWebp(rgb, width, height, { quality = 90, effort = 4 } = {}) {
  return sharp(Buffer.from(rgb), { raw: { width, height, channels: 3 } })
    .webp({ quality, effort, smartSubsample: false })
    .toBuffer();
}

export function encodePng(rgba, width, height) {
  const png = new PNG({ width, height });
  Buffer.from(rgba).copy(png.data);
  return PNG.sync.write(png);
}

export async function writeBundle({
  stagingDir, course, hole, snapped, baseM,
  terrainHeights, rgb, imgW, imgH,
  surfacesRgba, coverageRgba, maskW, maskH,
  fingerprint, compilerVersion, provenance,
}) {
  const holeName = String(hole).padStart(2, '0');
  const holeDir = path.join(stagingDir, 'holes', holeName);
  fs.mkdirSync(holeDir, { recursive: true });

  const terrain = encodeTerrainF32(terrainHeights);
  const webp = await encodeWebp(rgb, imgW, imgH);
  const surfaces = encodePng(surfacesRgba, maskW, maskH);
  const coverage = encodePng(coverageRgba, maskW, maskH);

  fs.writeFileSync(path.join(holeDir, 'terrain.f32'), terrain);
  fs.writeFileSync(path.join(holeDir, 'orthophoto.webp'), webp);
  fs.writeFileSync(path.join(holeDir, 'surfaces.png'), surfaces);
  fs.writeFileSync(path.join(holeDir, 'coverage.png'), coverage);
  fs.writeFileSync(path.join(stagingDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);

  const rel = `holes/${holeName}`;
  const manifest = {
    schemaVersion: 1,
    compilerVersion,
    course: { name: course, fingerprint },
    hole,
    bounds: { minX: snapped.minX, minY: snapped.minY, maxX: snapped.maxX, maxY: snapped.maxY },
    terrain: {
      file: `${rel}/terrain.f32`, nx: snapped.nx, ny: snapped.ny, cellM: snapped.cellM, baseM,
      byteOrder: 'LE', sha256: sha256(terrain), bytes: terrain.length,
    },
    image: {
      file: `${rel}/orthophoto.webp`, width: imgW, height: imgH, colorSpace: 'srgb',
      sha256: sha256(webp), bytes: webp.length,
    },
    surfaces: { file: `${rel}/surfaces.png`, width: maskW, height: maskH, sha256: sha256(surfaces), bytes: surfaces.length },
    coverage: { file: `${rel}/coverage.png`, width: maskW, height: maskH, sha256: sha256(coverage), bytes: coverage.length },
  };
  fs.writeFileSync(path.join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
