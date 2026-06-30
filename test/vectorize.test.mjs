import { test } from 'node:test';
import assert from 'node:assert';
import { vectorize } from '../tools/trace/vectorize.mjs';

function rectMask(w, h, x0, y0, x1, y1) {
  const m = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * w + x] = 1;
  return m;
}

test('a filled rectangle -> one ring whose bbox matches the rectangle', () => {
  const w = 12, h = 10;
  const m = rectMask(w, h, 2, 2, 7, 5); // 6x4 = 24 px
  const rings = vectorize(m, w, h, { minArea: 12, eps: 1.0 });
  assert.equal(rings.length, 1);
  const r = rings[0];
  assert.ok(r.length >= 4 && r.length <= 8, `corners=${r.length}`);
  const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
  assert.equal(Math.min(...xs), 2); assert.equal(Math.max(...xs), 7);
  assert.equal(Math.min(...ys), 2); assert.equal(Math.max(...ys), 5);
});

test('a tiny speck is dropped (below minArea)', () => {
  const w = 10, h = 10;
  const m = new Uint8Array(w * h); m[0] = 1; m[1] = 1; // 2 px
  assert.equal(vectorize(m, w, h, { minArea: 12 }).length, 0);
});

test('two separate blobs -> two rings', () => {
  const w = 20, h = 10;
  const m = new Uint8Array(w * h);
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) m[y * w + x] = 1;
  for (let y = 1; y <= 4; y++) for (let x = 12; x <= 15; x++) m[y * w + x] = 1;
  assert.equal(vectorize(m, w, h, { minArea: 12 }).length, 2);
});

test('maxPts cap is respected on a round blob (shape still preserved)', () => {
  const w = 30, h = 30, cx = 15, cy = 15, rad = 9;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) m[y * w + x] = 1;
  const rings = vectorize(m, w, h, { minArea: 20, maxPts: 12 });
  assert.equal(rings.length, 1);
  assert.ok(rings[0].length <= 12 && rings[0].length >= 4, `pts=${rings[0].length}`);
});
