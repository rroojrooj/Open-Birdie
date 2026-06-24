import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeTerrainSampler } from '../public/render/terrain-grid.js';
import { buildHdTerrain, buildCoarseTerrain } from '../public/render/hd-terrain.js';

const base = { minX: 0, minY: 0, cellM: 5, nx: 11, ny: 11, heights: Array.from({ length: 121 }, (_, k) => (k % 7) * 0.3) };
const hd = { minX: 10, minY: 10, cellM: 1, nx: 6, ny: 6, heights: Array.from({ length: 36 }, (_, k) => 5 + k * 0.05), edgeBlendM: 0 };

test('makeTerrainSampler h() matches lib/elevation.makeTerrain (sampler parity)', async () => {
  const lib = await import('../lib/elevation.js');
  const makeTerrain = lib.makeTerrain || lib.default.makeTerrain;
  const ref = makeTerrain(base, [hd], { smooth: true });
  const s = makeTerrainSampler(base, [hd]);
  for (const [x, y] of [[12, 12], [10, 10], [15, 15], [2, 2], [13, 11], [25, 25], [0, 0]]) {
    assert.ok(Math.abs(s.h(x, y) - ref.h(x, y)) < 1e-9, `h(${x},${y}): ${s.h(x, y)} vs ${ref.h(x, y)}`);
  }
});

test('buildHdTerrain: nx*ny verts, (nx-1)(ny-1)*2 triangles, north-up', () => {
  const m = buildHdTerrain({ grid: hd, material: new THREE.MeshStandardMaterial() });
  assert.equal(m.geometry.getAttribute('position').count, 36);
  assert.equal(m.geometry.getIndex().count, 5 * 5 * 2 * 3);
  // vertex (i=0,j=0) is at (minX, h, -minY); (i=5,j=5) at (maxX, h, -maxY)
  const pos = m.geometry.getAttribute('position').array;
  assert.equal(pos[0], 10); assert.equal(pos[2], -10);
});

test('buildCoarseTerrain removes whole cells inside the HD rect — no positive-area overlap', () => {
  const cutout = { minX: 10, minY: 10, maxX: 30, maxY: 30 }; // aligned to 5 m cell lines
  const m = buildCoarseTerrain({ grid: base, cutout, material: new THREE.MeshStandardMaterial() });
  const pos = m.geometry.getAttribute('position').array;
  const idx = m.geometry.getIndex().array;
  for (let t = 0; t < idx.length; t += 3) {
    let cx = 0; let cz = 0;
    for (let v = 0; v < 3; v += 1) { const a = idx[t + v] * 3; cx += pos[a]; cz += pos[a + 2]; }
    cx /= 3; const cy = -cz / 3; // world z = -localY
    assert.ok(!(cx > 10 && cx < 30 && cy > 10 && cy < 30), `triangle centroid (${cx},${cy}) inside HD rect`);
  }
  // 10x10 cells full = 600 indices; the 4x4 cutout removes 16 cells -> 504.
  assert.equal(idx.length, ((base.nx - 1) * (base.ny - 1) - 16) * 2 * 3);
});

test('coarse cutout boundary vertices sit exactly on the snapped HD edge', () => {
  const cutout = { minX: 10, minY: 10, maxX: 30, maxY: 30 };
  const m = buildCoarseTerrain({ grid: base, cutout, material: null });
  const pos = m.geometry.getAttribute('position').array;
  const k = 2 * 11 + 2; // (i=2,j=2) -> world (10, h, -10)
  assert.equal(pos[k * 3], 10);
  assert.equal(pos[k * 3 + 2], -10);
});
