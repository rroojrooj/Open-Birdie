// Course character: one manual per-course "dryness" scalar (0 = lush green
// parkland, 1 = firm tan-gold links) that drives the turf palette + shader.
//
// WHY a client-side map (not a course-JSON field): a courseDry field on the
// course object is silently dropped in transit — courseGeometry() (server.js)
// and loadCourse() (lib/course.js) both return fixed field allow-lists, and old
// caches would lack it until re-fetch. A map keyed by course name lives entirely
// client-side, never touches the cache / server payload / courseFingerprint.
//
// The palette (COLORS) lives here — not in scene.js — so both scene.js and this
// module's blender share one source of truth with no circular import.

// Surfaces separated by VALUE (dark rough -> light fairway -> lighter green) so
// the hole reads as a golf hole, not one flat carpet, while staying muted enough
// that the regraded lighting doesn't push them neon. THIS IS THE LUSH PALETTE.
export const COLORS = {
  base: '#3c6736',  // lusher corridor/base (much of the visible play ground is unlabeled base)
  rough: '#4a8038', // lush green rough (Augusta second cut) — deeper than the fairway
  wood: '#2b4124',
  range: '#52883f',
  fairwayA: '#5aa848', fairwayB: '#4f9a40', // vivid lush fairway (mow stripes added in shader)
  // Greens: muted since material-first (v25) — the splat is the ACTUAL albedo, not a
  // 10% residue under the photo drape. The color stays in the fairway family.
  greenA: '#4c8f42', greenB: '#447f38',
  tee: '#63a84f',
  bunker: '#cbb583',
  water: '#2f6d97',
};

// Dry tan-links targets (from reference/chambers-bay/CATALOG.md). Only the GRASS
// zones get a dry target — greens stay green, sand is greige via makeSandMaterial,
// water/wood are unchanged. Non-grass keys are omitted (pinned to lush by the blend).
export const DRY_PALETTE = {
  base: '#a2914f',     // dry fescue base — tan, the dominant off-fairway ground
  rough: '#c0a666',    // gold-tan fescue rough — should DOMINATE the frame
  range: '#8f9a54',
  fairwayA: '#5e7d3d', fairwayB: '#54703a', // cool olive mown fairway
  tee: '#6a8544',
};

// Only these palette keys blend toward DRY_PALETTE. Everything else (greenA/B,
// wood, bunker, water) stays at the lush value at every courseDry.
export const BLEND_KEYS = ['base', 'rough', 'range', 'fairwayA', 'fairwayB', 'tee'];

// Manual per-course dryness, keyed by the course `name` (as it arrives from
// loadCourse). Auto-detection from fairway warmth is a deferred STRETCH (T5).
export const COURSE_DRY = {
  'Chambers Bay': 0.85,
  'TPC Sawgrass': 0.0,
  'St Andrews Old Course': 0.7,
  'Bandon Dunes Golf Resort, Round Lake Drive, Coos County, Oregon, United States': 0.8,
};

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);

// Dryness for a course name — clamped to [0,1], 0 (lush) for unknown/missing.
export function courseDryFor(name) {
  return clamp01(COURSE_DRY[name]);
}

const H = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
const lerpHex = (a, b, t) => { const A = H(a), B = H(b); return '#' + hex2(A[0] + (B[0] - A[0]) * t) + hex2(A[1] + (B[1] - A[1]) * t) + hex2(A[2] + (B[2] - A[2]) * t); };

// Blend the lush palette toward the dry one by t. Grass zones (BLEND_KEYS)
// interpolate; all other keys stay lush. t=0 returns a byte-identical copy of
// lush (no lush-course regression); t=1 returns the exact dry targets.
export function blendPalette(lush, dry, t) {
  t = clamp01(t);
  const out = { ...lush };
  if (t === 0) return out;
  for (const k of BLEND_KEYS) out[k] = (t === 1) ? dry[k] : lerpHex(lush[k], dry[k], t);
  return out;
}
