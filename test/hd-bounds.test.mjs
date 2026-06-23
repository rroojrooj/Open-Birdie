import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHoleBounds, snapHdBounds } from '../tools/hd-course/bounds.mjs';

const course = { holes: [{ ref: 1, line: [[0, 0], [50, 100], [100, 300]] }], surfaces: [] };
const coarse = { minX: -50, minY: -50, cellM: 5, nx: 60, ny: 90 };

test('computeHoleBounds pads the hole routing extent', () => {
  const b = computeHoleBounds(course, 1, 150);
  assert.deepEqual(b, { minX: -150, minY: -150, maxX: 250, maxY: 450 });
});

test('computeHoleBounds rejects a missing hole', () => {
  assert.throws(() => computeHoleBounds(course, 7, 150), /HD_HOLE_NOT_FOUND/);
});

test('snapHdBounds aligns edges to coarse cell lines, outward, with one consistent cellM', () => {
  const raw = computeHoleBounds(course, 1, 150);
  const s = snapHdBounds(raw, { coarse, targetSpacingM: 3.0 });

  // edges land on coarse 5 m cell lines (relative to the coarse origin).
  // Use === so a mathematically-aligned -0 remainder counts as aligned.
  const aligned = (v, o) => assert.ok(((v - o) % coarse.cellM) === 0, `${v} not on a ${coarse.cellM} m line from ${o}`);
  for (const v of [s.minX, s.maxX]) aligned(v, coarse.minX);
  for (const v of [s.minY, s.maxY]) aligned(v, coarse.minY);

  // strictly outward (contains the raw padded box)
  assert.ok(s.minX <= raw.minX && s.maxX >= raw.maxX);
  assert.ok(s.minY <= raw.minY && s.maxY >= raw.maxY);

  // single-cellM grid consistency — the lib/hd-bundle.js validator contract
  const tol = Math.max(1e-6, s.cellM * 1e-3);
  assert.ok(Math.abs((s.nx - 1) * s.cellM - (s.maxX - s.minX)) < tol);
  assert.ok(Math.abs((s.ny - 1) * s.cellM - (s.maxY - s.minY)) < tol);
  assert.equal(s.cellM, 3.0);
});

test('snapHdBounds rejects excessive pixel counts', () => {
  const huge = { minX: 0, minY: 0, maxX: 100000, maxY: 100000 };
  assert.throws(() => snapHdBounds(huge, { coarse, targetSpacingM: 3.0, maxPixels: 1_000_000 }), /HD_BOUNDS_TOO_LARGE/);
});
