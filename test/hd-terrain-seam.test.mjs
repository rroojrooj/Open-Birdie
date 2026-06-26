import test from 'node:test';
import assert from 'node:assert/strict';
import { resampleTerrain } from '../tools/hd-course/terrain.mjs';
import { coarseBaseHeight } from '../tools/hd-course/cli.mjs';

// Regression for the zero-ring seam bug: the live provider used `baseHeightAt:
// () => 0`, so the resampler's edge ring + NoData fallback blended the HD patch
// boundary toward 0 instead of the coarse course terrain — the patch stepped off
// a cliff against the surround. coarseBaseHeight must sample the coarse grid.

const flatCourse = () => ({
  origin: { lat: 43, lon: -124 },
  elevation: { minX: -30, minY: -30, cellM: 5, nx: 13, ny: 13, baseM: 100, heights: new Array(13 * 13).fill(20) },
});

test('coarseBaseHeight samples the coarse grid (not a constant 0)', () => {
  const f = coarseBaseHeight(flatCourse());
  assert.equal(f(0, 0), 20);
  assert.equal(f(-12, 7), 20);
  // no elevation → safe constant-0 fallback
  assert.equal(coarseBaseHeight({})(0, 0), 0);
});

test('resampleTerrain blends the patch edge ring to the coarse terrain, not 0', () => {
  const course = flatCourse();
  const baseM = course.elevation.baseM;
  const sampler = () => 150;                 // HD abs 150 → 50 relative to baseM 100
  const snapped = { minX: -12, minY: -12, maxX: 12, maxY: 12, cellM: 3, nx: 9, ny: 9 };
  const opts = { sampler, snapped, origin: course.origin, baseM, featherM: 4 };

  const { heights, nx, ny } = resampleTerrain({ ...opts, baseHeightAt: coarseBaseHeight(course) });
  // the whole boundary ring equals the coarse height (20), NOT 0
  for (const [i, j] of [[0, 0], [nx - 1, 0], [0, ny - 1], [nx - 1, ny - 1], [4, 0], [0, 4]]) {
    assert.equal(heights[j * nx + i], 20, `edge (${i},${j})`);
  }
  // a deep-interior cell keeps the HD value (50) — real detail survives the blend
  assert.equal(heights[Math.floor(ny / 2) * nx + Math.floor(nx / 2)], 50);

  // documents exactly what was broken: a 0 base produces the zero ring
  const bug = resampleTerrain({ ...opts, baseHeightAt: () => 0 });
  assert.equal(bug.heights[0], 0);
});
