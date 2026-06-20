'use strict';
// Offline tests for the tiered-LIDAR pieces of lib/elevation.js: resampling a
// 3DEP patch into the local-meter frame, and the patch-aware makeTerrain
// sampler (greens get fine relief; base grid elsewhere; a smoothed surface for
// physics). No network — fetchGreenPatches' live fetch is verified manually.

const { test } = require('node:test');
const assert = require('node:assert');
const { makeTerrain, resampleToLocal } = require('../lib/elevation');

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- resampleToLocal (pure; fake sampler, no network) ----

test('resampleToLocal: dims, baseM subtraction, grid layout', () => {
  const grid = resampleToLocal({
    sampler: () => 80, // constant 80m absolute
    minX: 0, minY: 0, maxX: 30, maxY: 30, cellM: 1.5,
    lat0: 33.5, lon0: -82, mPerLat: 111132, mPerLon: 92000, baseM: 30,
    baseH: () => 0,
  });
  assert.strictEqual(grid.nx, 21); // round(30/1.5)+1
  assert.strictEqual(grid.ny, 21);
  assert.strictEqual(grid.cellM, 1.5);
  assert.strictEqual(grid.minX, 0);
  assert.ok(grid.heights.every((v) => approx(v, 50)), 'abs 80 - baseM 30 = rel 50');
});

test('resampleToLocal: null (no-coverage) samples fall back to baseH', () => {
  const grid = resampleToLocal({
    sampler: () => null,
    minX: 0, minY: 0, maxX: 10, maxY: 10, cellM: 2,
    lat0: 33.5, lon0: -82, mPerLat: 111132, mPerLon: 92000, baseM: 30,
    baseH: () => 7,
  });
  assert.ok(grid.heights.every((v) => approx(v, 7)));
});

// ---- tiered makeTerrain ----

const base = { minX: 0, minY: 0, cellM: 10, nx: 21, ny: 21, heights: new Array(21 * 21).fill(0) };
function rampPatch() { // east-running ramp over 100..115 m, 1 m cells, slope 0.1/m
  const nx = 16, ny = 16, h = new Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = i * 0.1;
  return { minX: 100, minY: 100, cellM: 1, nx, ny, heights: h };
}

test('makeTerrain with no patches is base-only (unchanged behavior)', () => {
  const t = makeTerrain(base);
  assert.strictEqual(t.h(50, 50), 0);
  assert.strictEqual(t.grad(50, 50).dx, 0);
});

test('makeTerrain samples the patch on the green, base far away', () => {
  const t = makeTerrain(base, [rampPatch()]);
  assert.ok(approx(t.h(107.5, 107.5), 0.75, 0.05), `patch center got ${t.h(107.5, 107.5)}`);
  assert.strictEqual(t.h(5, 5), 0); // far from any patch -> base
});

test('makeTerrain gradient reflects the finer in-patch slope', () => {
  const g = makeTerrain(base, [rampPatch()]).grad(107.5, 107.5);
  assert.ok(approx(g.dx, 0.1, 0.02), `dx ${g.dx}`);
  assert.ok(approx(g.dy, 0, 0.02), `dy ${g.dy}`);
});

test('smooth:true reduces gradient magnitude from sub-cell noise (physics path)', () => {
  const nx = 16, ny = 16, h = new Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = (i + j) % 2 ? 2 : 0;
  const noisy = { minX: 100, minY: 100, cellM: 1, nx, ny, heights: h };
  const gm = (opts) => {
    const g = makeTerrain(base, [noisy], opts).grad(107.3, 107.7);
    return Math.hypot(g.dx, g.dy);
  };
  assert.ok(gm({ smooth: true }) < gm({ smooth: false }), 'smoothing must reduce jitter');
});
