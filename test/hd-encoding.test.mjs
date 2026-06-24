import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { writeBundle, encodeTerrainF32 } from '../tools/hd-course/encode.mjs';
import hdBundle from '../lib/hd-bundle.js';

const { validateBundleDirectory } = hdBundle;

test('encodeTerrainF32 writes little-endian Float32 and round-trips', () => {
  const buf = encodeTerrainF32(new Float32Array([1, 2.5, -3]));
  assert.equal(buf.length, 12);
  assert.equal(buf.readFloatLE(4), 2.5);
});

test('two encodes of identical heights produce identical bytes (reproducible)', () => {
  const h = new Float32Array([1.23, 4.56, 7.89, 0]);
  assert.ok(encodeTerrainF32(h).equals(encodeTerrainF32(h)));
});

test('an encoded bundle passes the Plan 1 runtime validator', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-enc-'));
  const snapped = { minX: 0, minY: 0, maxX: 30, maxY: 30, cellM: 3, nx: 11, ny: 11 };
  const terrainHeights = new Float32Array(11 * 11).fill(1.5);
  const rgb = Buffer.alloc(8 * 8 * 3, 100);
  const surfacesRgba = Buffer.alloc(11 * 11 * 4);
  const coverageRgba = Buffer.alloc(11 * 11 * 4);
  for (let i = 0; i < 11 * 11; i += 1) { coverageRgba[i * 4] = 255; coverageRgba[i * 4 + 3] = 255; }

  await writeBundle({
    stagingDir: dir,
    course: 'Synthetic Test Course',
    hole: 1,
    snapped,
    baseM: 12.5,
    terrainHeights,
    rgb, imgW: 8, imgH: 8,
    surfacesRgba, coverageRgba, maskW: 11, maskH: 11,
    fingerprint: 'a'.repeat(64),
    compilerVersion: '0.1.0',
    provenance: { source: 'synthetic-test', tools: { node: process.version } },
  });

  const res = validateBundleDirectory(dir);
  assert.equal(res.status, 'valid', res.status === 'rejected' ? `${res.code}: ${res.message}` : '');
  assert.equal(res.descriptor.terrain.nx, 11);
});
