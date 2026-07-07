// P1b: one manual per-course "dryness" scalar blends the lush palette toward a
// dry tan-links palette. Pure logic — greens/sand/water stay put; courseDry=0
// must be byte-identical to today (no regression to lush courses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, DRY_PALETTE, COURSE_DRY, courseDryFor, blendPalette, BLEND_KEYS } from '../public/render/course-character.js';

test('courseDryFor: map lookup, clamp, default 0', () => {
  assert.equal(courseDryFor('TPC Sawgrass'), 0);                 // parkland — no dryness
  assert.ok(courseDryFor('Chambers Bay') > 0.5);                 // links — dry
  assert.equal(courseDryFor('Some Unknown Course'), 0);          // unknown → lush default
  assert.equal(courseDryFor(undefined), 0);                      // missing → 0, never NaN
  assert.ok(!Number.isNaN(courseDryFor(null)));
});

test('blendPalette at 0 is byte-identical to COLORS (no lush-course regression)', () => {
  assert.deepEqual(blendPalette(COLORS, DRY_PALETTE, 0), COLORS);
});

test('blendPalette at 1 hits the dry targets on grass zones', () => {
  const dry = blendPalette(COLORS, DRY_PALETTE, 1);
  assert.equal(dry.rough, DRY_PALETTE.rough);                    // gold-tan dominant
  assert.equal(dry.fairwayA, DRY_PALETTE.fairwayA);             // cool olive
});

test('greens/sand/water are excluded from the tan blend (greens stay green)', () => {
  for (const t of [0, 0.5, 1]) {
    const p = blendPalette(COLORS, DRY_PALETTE, t);
    assert.equal(p.greenA, COLORS.greenA);                       // putting surfaces never go tan
    assert.equal(p.greenB, COLORS.greenB);
    assert.equal(p.water, COLORS.water);
    assert.equal(p.bunker, COLORS.bunker);
  }
  assert.ok(!BLEND_KEYS.includes('greenA'));
});

test('blendPalette is monotone toward tan (rough R rises, G/B fall)', () => {
  const r = (hex) => parseInt(hex.slice(1, 3), 16);
  const mid = blendPalette(COLORS, DRY_PALETTE, 0.5).rough;
  assert.ok(r(COLORS.rough) < r(mid) && r(mid) < r(DRY_PALETTE.rough)); // warms monotonically
});

test('blendPalette clamps t outside [0,1]', () => {
  assert.deepEqual(blendPalette(COLORS, DRY_PALETTE, 2), blendPalette(COLORS, DRY_PALETTE, 1));
  assert.deepEqual(blendPalette(COLORS, DRY_PALETTE, -1), COLORS);
});
