import test from 'node:test';
import assert from 'node:assert/strict';
import { srgbToLinear, averageLinearColor } from '../public/render/macro-tint.js';

test('srgbToLinear: endpoints and midpoint', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(255), 1);
  assert.ok(Math.abs(srgbToLinear(128) - 0.2159) < 1e-3); // sRGB 50% grey ≈ 21.6% linear
});

test('averageLinearColor averages in LINEAR space (not sRGB)', () => {
  // black + white pixels: linear mean is 0.5; a (wrong) sRGB-space mean of 128 would decode to ~0.216
  const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const a = averageLinearColor(px);
  for (const c of [a.r, a.g, a.b]) assert.ok(Math.abs(c - 0.5) < 1e-9);
});
