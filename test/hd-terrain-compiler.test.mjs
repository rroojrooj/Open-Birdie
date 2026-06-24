import test from 'node:test';
import assert from 'node:assert/strict';
import { resampleTerrain } from '../tools/hd-course/terrain.mjs';

const origin = { lat: 43.188372, lon: -124.391261 };
const snapped = { minX: 0, minY: 0, maxX: 30, maxY: 30, cellM: 3, nx: 11, ny: 11 };

test('a flat patch resamples to constant relative, quantized heights (interior)', () => {
  const r = resampleTerrain({ sampler: () => 80, snapped, origin, baseM: 30, baseHeightAt: () => 0 });
  assert.ok(r.heights instanceof Float32Array);
  assert.equal(r.heights.length, 121);
  assert.equal(r.heights[5 * 11 + 5], 50); // center, far from the feather ring: 80 - 30
});

test('heights are quantized to 0.01 m', () => {
  const r = resampleTerrain({ sampler: () => 80.123456, snapped, origin, baseM: 30, baseHeightAt: () => 0 });
  // Stored as Float32 (terrain.f32), so 50.12 reads back as 50.119998…; re-quantize to confirm.
  assert.equal(Math.round(r.heights[5 * 11 + 5] * 100) / 100, 50.12);
});

test('NoData gaps fall back to the base height', () => {
  const r = resampleTerrain({ sampler: () => null, snapped, origin, baseM: 30, baseHeightAt: () => 7, maxGapRatio: 1 });
  assert.equal(r.heights[5 * 11 + 5], 7);
  assert.equal(r.gapRatio, 1);
});

test('excessive NoData gaps are rejected', () => {
  assert.throws(
    () => resampleTerrain({ sampler: () => null, snapped, origin, baseM: 30, baseHeightAt: () => 0, maxGapRatio: 0.5 }),
    /HD_3DEP_GAPS/,
  );
});

test('the outer ring blends toward the base so the patch edge matches the surround', () => {
  const r = resampleTerrain({ sampler: () => 80, snapped, origin, baseM: 30, baseHeightAt: () => 0, featherM: 4 });
  assert.equal(r.heights[0], 0); // corner (dist 0) == base
  assert.equal(r.heights[0 * 11 + 5], 0); // top-edge midpoint (dist 0) == base
});
