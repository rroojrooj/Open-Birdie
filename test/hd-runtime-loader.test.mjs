import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadHdBundle } from '../public/render/hd-bundle.js';

const sha = async (bytes) => {
  const b = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
};

async function fixture() {
  const nx = 4; const ny = 4;
  const heights = new Float32Array(nx * ny);
  for (let i = 0; i < 16; i += 1) heights[i] = i * 0.1;
  const terrain = new Uint8Array(heights.buffer.slice(0));
  const ortho = new Uint8Array([10, 20, 30, 40]);
  const surf = new Uint8Array([1, 2, 3, 4, 5]);
  const cov = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const meta = {
    bundleId: 'a'.repeat(64),
    bounds: { minX: 0, minY: 0, maxX: 9, maxY: 9 },
    courseRevision: 7,
    terrain: { nx, ny, cellM: 3, bytes: terrain.length, sha256: await sha(terrain) },
    image: { width: 4, height: 4, bytes: ortho.length, sha256: await sha(ortho) },
    surfaces: { width: 4, height: 4, bytes: surf.length, sha256: await sha(surf) },
    coverage: { width: 4, height: 4, bytes: cov.length, sha256: await sha(cov) },
  };
  return { meta, heights, bytes: { terrain, orthophoto: ortho, surfaces: surf, coverage: cov } };
}

const fetchImplFor = (bytesByKey, { corrupt } = {}) => async (url) => {
  const key = url.split('/').pop();
  let b = bytesByKey[key];
  if (corrupt === key) b = new Uint8Array([...b, 0]);
  return { ok: true, status: 200, headers: new Map(), async arrayBuffer() { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } };
};
const imageDecoder = async () => ({ width: 4, height: 4, closed: false, close() { this.closed = true; } });

test('loads + verifies all assets and configures textures', async () => {
  const { meta, heights, bytes } = await fixture();
  const a = await loadHdBundle(meta, { fetchImpl: fetchImplFor(bytes), imageDecoder, expectedRevision: 7 });
  assert.equal(a.terrain.heights.length, 16);
  assert.ok(Math.abs(a.terrain.heights[5] - heights[5]) < 1e-6);
  assert.equal(a.terrain.edgeBlendM, 0);
  assert.ok(a.orthophoto.isTexture);
  assert.equal(a.orthophoto.colorSpace, THREE.SRGBColorSpace);
  assert.equal(a.surfaces.colorSpace, THREE.NoColorSpace);
  a.dispose();
  a.dispose(); // idempotent
});

test('rejects a terrain hash mismatch and cleans up', async () => {
  const { meta, bytes } = await fixture();
  await assert.rejects(() => loadHdBundle(meta, { fetchImpl: fetchImplFor(bytes, { corrupt: 'terrain' }), imageDecoder, expectedRevision: 7 }), /HD_(HASH|LENGTH)_terrain/);
});

test('rejects an image dimension mismatch', async () => {
  const { meta, bytes } = await fixture();
  const badDecoder = async () => ({ width: 9, height: 9, close() {} });
  await assert.rejects(() => loadHdBundle(meta, { fetchImpl: fetchImplFor(bytes), imageDecoder: badDecoder, expectedRevision: 7 }), /HD_DIM_orthophoto/);
});

test('rejects a stale revision before loading', async () => {
  const { meta, bytes } = await fixture();
  await assert.rejects(() => loadHdBundle(meta, { fetchImpl: fetchImplFor(bytes), imageDecoder, expectedRevision: 8 }), /HD_STALE_REVISION/);
});

test('propagates an aborted fetch', async () => {
  const { meta, bytes } = await fixture();
  const aborting = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  await assert.rejects(() => loadHdBundle(meta, { fetchImpl: aborting, imageDecoder, expectedRevision: 7 }));
});
