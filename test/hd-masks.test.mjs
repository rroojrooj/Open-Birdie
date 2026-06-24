import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterizeMasks } from '../tools/hd-course/masks.mjs';

// 40x40 m hole; fairway covers all, a green in the north, a bunker SW, water SE.
const snapped = { minX: 0, minY: 0, maxX: 40, maxY: 40, cellM: 4, nx: 11, ny: 11 };
const surfaces = [
  { kind: 'fairway', poly: [[0, 0], [40, 0], [40, 40], [0, 40]] },
  { kind: 'green', poly: [[10, 30], [30, 30], [30, 38], [10, 38]] }, // north (high y)
  { kind: 'bunker', poly: [[2, 2], [10, 2], [10, 10], [2, 10]] }, // SW
  { kind: 'water', poly: [[30, 2], [38, 2], [38, 10], [30, 10]] }, // SE
];

const W = 20; const H = 20;
const m = rasterizeMasks({ surfaces, snapped, width: W, height: H });
const surf = (i, j) => { const o = (j * W + i) * 4; return [m.surfaces[o], m.surfaces[o + 1], m.surfaces[o + 2], m.surfaces[o + 3]]; };
const cov = (i, j) => { const o = (j * W + i) * 4; return [m.coverage[o], m.coverage[o + 1], m.coverage[o + 2], m.coverage[o + 3]]; };

test('surfaces.png packs fairway=R green=G tee=B bunker=A', () => {
  // plain fairway at the center: R high, others ~0
  const [r, g, b, a] = surf(10, 10);
  assert.ok(r > 200 && g < 50 && b < 50 && a < 50, `center fairway ${[r, g, b, a]}`);
});

test('priority: green wins over fairway where they overlap', () => {
  // world (21,35) is inside both fairway and green -> green, not fairway.
  // north -> top rows: y=35 -> j ~ 2
  const [r, g] = surf(10, 2);
  assert.ok(g > 200 && r < 50, `green-over-fairway ${[r, g]}`);
});

test('north-up orientation: the green sits in the TOP rows, the bunker in the BOTTOM-left', () => {
  assert.ok(surf(10, 2)[1] > 200, 'green near top');   // G channel, north
  assert.ok(surf(3, 16)[3] > 200, 'bunker near bottom-left'); // A channel (bunker), south-west
});

test('coverage.png packs validity=R(255) water=G', () => {
  // water SE -> bottom-right; validity is full
  const [r, g] = cov(17, 16);
  assert.equal(r, 255);
  assert.ok(g > 200, `water ${g}`);
  // a non-water cell still has full validity, zero water
  assert.equal(cov(10, 10)[0], 255);
  assert.ok(cov(10, 10)[1] < 50);
});
