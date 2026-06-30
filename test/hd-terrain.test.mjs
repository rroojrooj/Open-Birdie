import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildCoarseTerrain, buildHdTerrain, cellInAnyRect } from '../public/render/hd-terrain.js';
import { makeTerrainSampler } from '../public/render/terrain-grid.js';

// A small flat grid: nx×ny nodes at cellM spacing → (nx-1)(ny-1) cells, 2 tris each.
function grid(nx, ny, cellM = 10, minX = 0, minY = 0) {
  return { minX, minY, cellM, nx, ny, heights: new Float32Array(nx * ny) };
}
const tris = (mesh) => mesh.geometry.getIndex().count / 3;
const mat = () => new THREE.MeshBasicMaterial();

test('cellInAnyRect: whole-cell-inside test over a set of rects', () => {
  const g = grid(3, 3); // cells (0,0),(1,0),(0,1),(1,1), each 10×10
  const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };   // covers cell (0,0)
  const b = { minX: 10, minY: 10, maxX: 20, maxY: 20 }; // covers cell (1,1)
  assert.equal(cellInAnyRect(g, 0, 0, [a]), true);
  assert.equal(cellInAnyRect(g, 1, 1, [a]), false);
  assert.equal(cellInAnyRect(g, 1, 1, [a, b]), true); // matched by the 2nd rect
  assert.equal(cellInAnyRect(g, 1, 0, [a, b]), false); // covered by neither
  assert.equal(cellInAnyRect(g, 0, 0, []), false);
});

test('buildCoarseTerrain removes the UNION of every cutout rect', () => {
  const g = grid(3, 3); // 4 cells → 8 tris with nothing cut
  const full = buildCoarseTerrain({ grid: g, cutouts: [], material: mat() });
  assert.equal(tris(full), 8);
  const one = buildCoarseTerrain({ grid: g, cutouts: [{ minX: 0, minY: 0, maxX: 10, maxY: 10 }], material: mat() });
  assert.equal(tris(one), 6); // one cell removed
  const two = buildCoarseTerrain({
    grid: g,
    cutouts: [{ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: 10, minY: 10, maxX: 20, maxY: 20 }],
    material: mat(),
  });
  assert.equal(tris(two), 4); // two cells removed
});

test('buildHdTerrain skips cells already covered by an earlier patch (skipBounds)', () => {
  const g = grid(3, 3);
  const whole = buildHdTerrain({ grid: g, material: mat(), uvBounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 } });
  assert.equal(tris(whole), 8);
  const clipped = buildHdTerrain({
    grid: g, material: mat(), uvBounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    skipBounds: [{ minX: 0, minY: 0, maxX: 10, maxY: 10 }],
  });
  assert.equal(tris(clipped), 6); // the overlapped cell is dropped (no z-fight with the earlier patch)
});

test('makeTerrainSampler resolves multiple HD patches: each wins in its own region', () => {
  const base = grid(11, 11, 10); // 0..100m, all height 0
  const pa = { minX: 0, minY: 0, cellM: 1, nx: 6, ny: 6, heights: new Float32Array(36).fill(5), edgeBlendM: 0 };
  const pb = { minX: 90, minY: 90, cellM: 1, nx: 6, ny: 6, heights: new Float32Array(36).fill(9), edgeBlendM: 0 };
  const s = makeTerrainSampler(base, [pa, pb]);
  assert.equal(s.h(2, 2), 5);   // inside patch A
  assert.equal(s.h(92, 92), 9); // inside patch B
  assert.equal(s.h(50, 50), 0); // base between the patches
});
