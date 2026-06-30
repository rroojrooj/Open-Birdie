import { test } from 'node:test';
import assert from 'node:assert';
import { fullPxToLocal, localToFullPx, cropPxToLocal, ringPxToLocal } from '../tools/trace/aerial-xform.mjs';

// Aerial bounds: x 0..100 (east), y 0..200 (north). Image 100x200 px.
const b = { minX: 0, minY: 0, maxX: 100, maxY: 200 };
const W = 100, H = 200;

test('top-left pixel = (minX, maxY); bottom-right = (maxX, minY)', () => {
  assert.deepEqual(fullPxToLocal({ px: 0, py: 0 }, b, W, H), { x: 0, y: 200 });
  assert.deepEqual(fullPxToLocal({ px: 100, py: 200 }, b, W, H), { x: 100, y: 0 });
});

test('center pixel maps to bounds center', () => {
  const c = fullPxToLocal({ px: 50, py: 100 }, b, W, H);
  assert.ok(Math.abs(c.x - 50) < 1e-9 && Math.abs(c.y - 100) < 1e-9);
});

test('round-trip px -> local -> px (catches axis flips)', () => {
  for (const [px, py] of [[10, 20], [55, 140], [99, 199]]) {
    const l = fullPxToLocal({ px, py }, b, W, H);
    const r = localToFullPx(l, b, W, H);
    assert.ok(Math.abs(r.px - px) < 1e-6 && Math.abs(r.py - py) < 1e-6, `${px},${py} -> ${r.px},${r.py}`);
  }
});

test('cropPxToLocal applies the crop offset', () => {
  const crop = { x0: 10, y0: 20, w: 30, h: 30 };
  assert.deepEqual(cropPxToLocal({ cx: 0, cy: 0 }, crop, b, W, H), fullPxToLocal({ px: 10, py: 20 }, b, W, H));
});

test('ringPxToLocal converts every vertex', () => {
  const r = ringPxToLocal([[0, 0], [100, 200]], b, W, H);
  assert.deepEqual(r, [[0, 200], [100, 0]]);
});
