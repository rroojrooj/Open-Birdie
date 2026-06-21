'use strict';
// Pure tests for the surface-drape helpers (public/render/drape.js). These build
// the per-surface "patch" geometry (bunkers/greens/tees) that gives crisp,
// geometry-based boundaries. No three, no DOM — node-importable ESM.

import { test } from 'node:test';
import assert from 'node:assert';
import { densifyRing, drapeRing } from '../public/render/drape.js';

test('densifyRing splits long edges, leaves short ones, drops a closing dup', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.strictEqual(densifyRing(sq, 100).length, 4); // edges shorter than maxLen -> untouched
  const d = densifyRing(sq, 2.5);                      // each 10m edge -> 4 segments
  assert.ok(d.length > 4, `expected densified, got ${d.length}`);
  assert.ok(d.some((p) => p[0] === 0 && p[1] === 0));  // original corner kept
  // closing-duplicate is dropped (OSM polys often repeat the first vertex)
  assert.strictEqual(densifyRing([[0, 0], [10, 0], [0, 0]], 100).length, 2);
});

test('drapeRing: heights from sampler + offset, three coords (x, h, -y)', () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const { pos, uv } = drapeRing(ring, (x) => x * 0.1, bounds, 2);
  assert.strictEqual(pos.length, 4 * 3);
  assert.strictEqual(uv.length, 4 * 2);
  // vertex 1 = [10,0]: x=10, h = 10*0.1 + 2 = 3, z = -0
  assert.ok(Math.abs(pos[3] - 10) < 1e-6, `x ${pos[3]}`);
  assert.ok(Math.abs(pos[4] - 3) < 1e-6, `h ${pos[4]}`);
  assert.ok(Math.abs(pos[5] - 0) < 1e-6, `z ${pos[5]}`);
  for (let i = 1; i < pos.length; i += 3) assert.ok(Number.isFinite(pos[i]));
});

test('drapeRing: UV is normalized over bounds (matches the base terrain UV space)', () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const { uv } = drapeRing(ring, () => 0, bounds);
  assert.ok(Math.abs(uv[0] - 0) < 1e-6 && Math.abs(uv[1] - 0) < 1e-6); // [0,0] -> (0,0)
  assert.ok(Math.abs(uv[4] - 1) < 1e-6 && Math.abs(uv[5] - 1) < 1e-6); // [10,10] -> (1,1)
});
