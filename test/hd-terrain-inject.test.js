'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeTerrain } = require('../lib/elevation');
const { Game } = require('../lib/game');

const base = { minX: 0, minY: 0, cellM: 5, nx: 11, ny: 11, heights: new Array(121).fill(0) };
// Compiler-pre-blended HD patch spanning 10..15, edgeBlendM:0 (no runtime feather).
const hdPatch = (val = 10) => ({ minX: 10, minY: 10, cellM: 1, nx: 6, ny: 6, heights: new Array(36).fill(val), edgeBlendM: 0, kind: 'hd-hole' });

test('edgeBlendM:0 patch is pure at the exact boundary (no 0/0 NaN)', () => {
  const t = makeTerrain(base, [hdPatch(10)]);
  assert.equal(t.h(12, 12), 10);             // interior
  assert.ok(Number.isFinite(t.h(10, 10)));   // exact boundary must not be NaN
  assert.equal(t.h(10, 10), 10);             // pure patch (not base 0)
  assert.equal(t.h(15, 15), 10);             // far corner (maxX/maxY)
});

test('a legacy patch (no edgeBlendM) still feathers over FEATHER_M=4 m', () => {
  const legacy = { minX: 10, minY: 10, cellM: 1, nx: 21, ny: 21, heights: new Array(441).fill(10) }; // 10..30
  const t = makeTerrain(base, [legacy]);
  assert.equal(t.h(20, 20), 10);   // center, inset 10 >= 4 -> full patch
  assert.equal(t.h(10, 10), 0);    // exact edge, inset 0 -> base
  assert.equal(t.h(12, 12), 5);    // inset 2 -> halfway blend
});

test('smooth: h() uses raw heights, grad() uses a smoothed copy', () => {
  const nx = 7; const ny = 7; const h = new Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = (i % 2 === 0 ? 0 : 2);
  const noisy = { minX: 10, minY: 10, cellM: 1, nx, ny, heights: h, edgeBlendM: 0 };
  const sharp = makeTerrain(base, [noisy], { smooth: false });
  const soft = makeTerrain(base, [noisy], { smooth: true });
  assert.equal(soft.h(12, 13), sharp.h(12, 13)); // h is RAW in both
  const gSharp = sharp.grad(12.5, 13), gSoft = soft.grad(12.5, 13);
  assert.ok(Math.hypot(gSoft.dx, gSoft.dy) < Math.hypot(gSharp.dx, gSharp.dy)); // grad smoothed
});

function courseWithGrid(holePin = [40, 40]) {
  return {
    name: 'T', surfaces: [], boundary: null,
    elevation: { minX: 0, minY: 0, cellM: 5, nx: 11, ny: 11, baseM: 0, heights: new Array(121).fill(0), patches: [] },
    holes: [{ par: 4, tee: [12, 12], pin: holePin, lengthYd: 400, line: [[12, 12], holePin] }],
  };
}

test('setCourse injects HD terrain patches into physics', () => {
  const g = new Game();
  g.setCourse(courseWithGrid(), { terrainPatches: [hdPatch(10)] });
  assert.equal(g.terrain.h(12, 12), 10);
});

test('runtimeReady gates shots; activateRuntimeTerrain rebuilds terrain without resetting state', () => {
  const g = new Game();
  g.setCourse(courseWithGrid(), { terrainPatches: [], ready: false });
  assert.equal(g.state().runtimeReady, false);
  assert.equal(g.handleShot({ Speed: 100, VLA: 14 }), null); // blocked while not ready
  assert.equal(g.strokes, 0);

  g.strokes = 3; g.ball = { x: 20, y: 20 };
  g.activateRuntimeTerrain([hdPatch(7)]);
  assert.equal(g.terrain.h(12, 12), 7);          // terrain switched
  assert.equal(g.strokes, 3);                     // round state preserved
  assert.deepEqual(g.ball, { x: 20, y: 20 });
  assert.equal(g.state().runtimeReady, true);
  assert.ok(g.handleShot({ Speed: 100, VLA: 14 }) !== null); // now accepted
});
