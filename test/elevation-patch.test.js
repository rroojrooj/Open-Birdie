'use strict';
// Offline tests for the tiered-LIDAR pieces of lib/elevation.js: resampling a
// 3DEP patch into the local-meter frame, and the patch-aware makeTerrain
// sampler (greens get fine relief; base grid elsewhere; a smoothed surface for
// physics). No network — fetchGreenPatches' live fetch is verified manually.

const { test } = require('node:test');
const assert = require('node:assert');
const { makeTerrain, resampleToLocal, planLidarTiles, combineSamplers, fetch3depBase } = require('../lib/elevation');
const { lonToMerc, latToMerc } = require('../lib/lidar');

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

// ---- course-wide 1m base: tiling + sampler combine + offline assembly ----

test('planLidarTiles tiles a bbox into <= tileM chunks that cover it', () => {
  const tiles = planLidarTiles(0, 0, 250, 250, 100);
  assert.equal(tiles.length, 9); // 3 cols x 3 rows (0-100,100-200,200-250)
  for (const t of tiles) {
    assert.ok(t.maxX - t.minX <= 100 + 1e-9);
    assert.ok(t.maxY - t.minY <= 100 + 1e-9);
  }
  assert.deepEqual(tiles[0], { minX: 0, minY: 0, maxX: 100, maxY: 100 });
  const last = tiles[tiles.length - 1];
  assert.equal(last.maxX, 250); // clamped to the bbox edge
  assert.equal(last.maxY, 250);
});

test('planLidarTiles is a single tile when the bbox fits', () => {
  assert.deepEqual(planLidarTiles(0, 0, 50, 50, 1400), [{ minX: 0, minY: 0, maxX: 50, maxY: 50 }]);
});

test('combineSamplers returns the first covering sampler value, else null', () => {
  const s1 = (x) => (x < 10 ? 1 : null);
  const s2 = (x) => (x >= 10 ? 2 : null);
  const c = combineSamplers([s1, s2]);
  assert.equal(c(5, 0), 1);
  assert.equal(c(15, 0), 2);
  assert.equal(combineSamplers([])(5, 0), null);
});

// A fake 3DEP fetch: meta returns a mercator extent covering the whole course,
// the image is a w*h little-endian F32 raster filled with `fillM` metres.
function fake3dep(lat0, lon0, mPerLat, mPerLon, fillM, w = 64, h = 64) {
  const xmin = lonToMerc(lon0 - 0.01), xmax = lonToMerc(lon0 + 0.01);
  const ymin = latToMerc(lat0 - 0.01), ymax = latToMerc(lat0 + 0.01);
  return async (url) => {
    if (url.includes('f=json')) return { ok: true, json: async () => ({ width: w, height: h, extent: { xmin, ymin, xmax, ymax } }) };
    const buf = Buffer.alloc(w * h * 4);
    for (let k = 0; k < w * h; k++) buf.writeFloatLE(fillM, k * 4);
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
  };
}

test('fetch3depBase assembles a 1m grid from 3DEP tiles (offline)', async () => {
  const lat0 = 47.2, lon0 = -122.6, mPerLat = 111132, mPerLon = 111319 * Math.cos((lat0 * Math.PI) / 180);
  const grid = await fetch3depBase({
    lat0, lon0, mPerLat, mPerLon, minX: 0, minY: 0, maxX: 50, maxY: 50, cellM: 1,
    baseM: 30, baseH: () => -999, fetchImpl: fake3dep(lat0, lon0, mPerLat, mPerLon, 100),
  });
  assert.ok(grid, 'grid built');
  assert.equal(grid.cellM, 1);
  assert.equal(grid.nx, 51);
  assert.equal(grid.ny, 51);
  // every covered node = abs 100 - baseM 30 = rel 70 (NOT the -999 baseH fallback)
  assert.ok(grid.heights.every((v) => approx(v, 70, 1e-3)), `got ${grid.heights[0]}`);
});

test('fetch3depBase returns null when every tile fetch fails (caller uses coarse)', async () => {
  const failFetch = async () => ({ ok: false, status: 500 });
  const grid = await fetch3depBase({
    lat0: 47, lon0: -122, mPerLat: 111132, mPerLon: 75000, minX: 0, minY: 0, maxX: 50, maxY: 50, cellM: 1,
    baseM: 30, baseH: () => 0, fetchImpl: failFetch,
  });
  assert.equal(grid, null);
});
