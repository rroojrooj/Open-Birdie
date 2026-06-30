import { test } from 'node:test';
import assert from 'node:assert';
import { validateTrace, MAX_RING_PTS } from '../tools/trace/trace-schema.mjs';

const ok = {
  hole: 9,
  crop: { x0: 0, y0: 0, w: 10, h: 10 },
  pin_px: [5, 5],
  surfaces: [{ kind: 'green', poly_px: [[0, 0], [1, 0], [1, 1]], confidence: 0.9 }],
};

test('accepts a well-formed trace', () => {
  assert.deepEqual(validateTrace(ok), { ok: true, errors: [] });
});

test('rejects an unknown kind', () => {
  const bad = { ...ok, surfaces: [{ kind: 'lava', poly_px: [[0, 0], [1, 0], [1, 1]] }] };
  assert.ok(!validateTrace(bad).ok);
});

test('rejects a ring with < 3 points', () => {
  const bad = { ...ok, surfaces: [{ kind: 'green', poly_px: [[0, 0], [1, 1]] }] };
  assert.ok(!validateTrace(bad).ok);
});

test(`rejects a ring with > ${MAX_RING_PTS} points (precision guard)`, () => {
  const big = Array.from({ length: MAX_RING_PTS + 10 }, (_, i) => [i, i * 2]);
  const bad = { ...ok, surfaces: [{ kind: 'green', poly_px: big }] };
  assert.ok(!validateTrace(bad).ok);
});

test('rejects a missing crop', () => {
  assert.ok(!validateTrace({ hole: 9, surfaces: [] }).ok);
});

test('accepts an optional boundary_px and omitted pin_px', () => {
  const t = { hole: 9, crop: { x0: 0, y0: 0, w: 10, h: 10 }, surfaces: [], boundary_px: [[0, 0], [9, 0], [9, 9]] };
  assert.deepEqual(validateTrace(t).errors, []);
});
