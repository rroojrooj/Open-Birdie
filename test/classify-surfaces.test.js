'use strict';
// Offline tests for the runtime NDVI surface classifier (lib/classify-surfaces.js).
// These drive the pure classify -> S1 (mown suppresses sand) -> S2 (coverage-sanity
// abort) -> RGBA PNG encode pipeline with SYNTHETIC band windows + OSM polys, so the
// real classifier (lib/segment-core.js segmentWindow) runs for real (not stubbed).
//
// Pixel recipes (against segment-core classifyPixel thresholds):
//   sand    R=G=B=N=200      -> nd=0,    brightness=200>145           -> 'sand'
//   fairway R=60 G=95 B=45 N=100 -> nd=0.25>0.22, tex(uniform)=0<16   -> 'fairway'
//   rough   R=70 G=90 B=50 N=95  -> nd=0.15 (not >0.22, not sand/water) -> 'rough'
// Texture is a 7px (r=3) local std-dev; uniform blocks read tex=0. We probe pixels
// in the INTERIOR of uniform blocks so boundary texture spikes never flip a class.
const { test } = require('node:test');
const assert = require('node:assert');
const { PNG } = require('pngjs');
const { classifyToClassmap } = require('../lib/classify-surfaces');

// Per-pixel band values keyed by intended class. Uniform => texture 0.
const RECIPE = {
  sand: [200, 200, 200, 200],
  fairway: [60, 95, 45, 100],
  rough: [70, 90, 50, 95],
};

// Build an interleaved [R,G,B,NIR,...] band array width*height, filled from a
// per-pixel class picker fn(px,py) -> one of RECIPE's keys.
function buildBands(width, height, pick) {
  const bands = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const [r, g, b, n] = RECIPE[pick(px, py)];
      const o = (py * width + px) * 4;
      bands[o] = r; bands[o + 1] = g; bands[o + 2] = b; bands[o + 3] = n;
    }
  }
  return bands;
}

// bounds where 1 px == 1 metre and row 0 == north (maxY), matching the aerial mapping
// x = minX + (px/width)*(maxX-minX);  y = maxY - (py/height)*(maxY-minY)
function unitBounds(width, height) {
  return { minX: 0, minY: 0, maxX: width, maxY: height };
}
// Axis-aligned rectangle poly in local metres, given pixel corner box (inclusive-ish).
// With unitBounds, pixel (px,py) center maps to metre (px+0.5, height-py-0.5).
function rectPoly(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

test('S1: a sand-classified pixel INSIDE an OSM mown poly has its B channel forced to 0', () => {
  const W = 32, H = 32;
  // Left half sand, right half fairway. A mown fairway poly covers ONLY the LEFT (sand)
  // region, so those bright-dry pixels must NOT be emitted as sand (B=0) after S1. The
  // right-half fairway supplies enough mown fraction to clear the S2 primary floor
  // (otherwise the window would abort before we can inspect S1).
  const bands = buildBands(W, H, (px) => (px < 16 ? 'sand' : 'fairway'));
  const bounds = unitBounds(W, H);
  // Mown poly over the whole left half in metres: x in [0,16], y in [0,H].
  const surfaces = [{ kind: 'fairway', poly: rectPoly(0, 0, 16, H) }];
  const boundary = rectPoly(0, 0, W, H); // whole window in-course
  const { pngBuffer, aborted } = classifyToClassmap({
    bands, width: W, height: H, bounds, boundary, surfaces,
  });
  assert.equal(aborted, false, 'not aborted');
  assert.ok(pngBuffer, 'returns a png buffer');
  const img = PNG.sync.read(pngBuffer);
  // Interior sand pixel (4,4) is inside the mown poly -> S1 forces sand off -> B=0.
  const oInside = (4 * W + 4) * 4;
  assert.equal(img.data[oInside + 2], 0, 'sand suppressed (B=0) inside mown poly');
});

test('c: a fairway-classified pixel OUTSIDE any OSM poly -> R channel 255 (coverage-add)', () => {
  const W = 32, H = 32;
  // Whole window is fairway-classified, but NO OSM surfaces cover it. The NDVI mown
  // detect must still paint R=255 (this is the sparse-stripe coverage add).
  const bands = buildBands(W, H, () => 'fairway');
  const bounds = unitBounds(W, H);
  const surfaces = [{ kind: 'rough', poly: rectPoly(0, 0, W, H) }]; // rough covers it (in-course), NOT mown
  const boundary = rectPoly(0, 0, W, H);
  const { pngBuffer, aborted } = classifyToClassmap({
    bands, width: W, height: H, bounds, boundary, surfaces,
  });
  assert.equal(aborted, false, 'realistic mown -> not aborted');
  const img = PNG.sync.read(pngBuffer);
  const o = (10 * W + 10) * 4;
  assert.equal(img.data[o + 0], 255, 'fairway detected -> R=255');
  assert.equal(img.data[o + 2], 0, 'not sand -> B=0');
});

test('b1: S2 PRIMARY abort when in-mask mownPct < 3% (NIR-degraded-to-R failure)', () => {
  const W = 32, H = 32;
  // Almost all rough, no mown detected -> mownPct ~ 0 < 0.03 -> abort.
  const bands = buildBands(W, H, () => 'rough');
  const bounds = unitBounds(W, H);
  const surfaces = [{ kind: 'rough', poly: rectPoly(0, 0, W, H) }];
  const boundary = rectPoly(0, 0, W, H);
  const { pngBuffer, stats, aborted } = classifyToClassmap({
    bands, width: W, height: H, bounds, boundary, surfaces,
  });
  assert.equal(aborted, true, 'aborted on mown-floor breach');
  assert.equal(pngBuffer, null, 'no png buffer on abort');
  assert.ok(stats.mownPct < 0.03, 'stats report the low mown fraction');
});

test('b2: S2 SECONDARY abort when in-mask sandPct > 55% (nodata all-sand tile)', () => {
  const W = 32, H = 32;
  // ~70% sand (rows 0..21), ~30% fairway (rows 22..31) so mown floor is cleared but
  // sand exceeds 0.55 -> secondary abort. None of the sand sits under a mown poly.
  const bands = buildBands(W, H, (px, py) => (py < 22 ? 'sand' : 'fairway'));
  const bounds = unitBounds(W, H);
  // Mown poly only over the fairway band (bottom) so S1 never touches the sand.
  // Metres: py in [22,31] -> y in [0, H-22] = [0,10].
  const surfaces = [{ kind: 'fairway', poly: rectPoly(0, 0, W, 10) }];
  const boundary = rectPoly(0, 0, W, H);
  const { pngBuffer, stats, aborted } = classifyToClassmap({
    bands, width: W, height: H, bounds, boundary, surfaces,
  });
  assert.equal(aborted, true, 'aborted on sand ceiling breach');
  assert.equal(pngBuffer, null, 'no png buffer on abort');
  assert.ok(stats.sandPct > 0.55, 'stats report the high sand fraction');
});

test('b3: a realistic window (mown ~20%, sand ~15%) is NOT aborted and returns a buffer', () => {
  const W = 40, H = 40; // 1600 px
  // Rows 0..5 (240px, 15%) sand; rows 6..13 (320px, 20%) fairway; rest rough.
  const bands = buildBands(W, H, (px, py) => (py < 6 ? 'sand' : py < 14 ? 'fairway' : 'rough'));
  const bounds = unitBounds(W, H);
  // No mown poly over the sand band, so S1 leaves the ~15% sand intact.
  const surfaces = [{ kind: 'rough', poly: rectPoly(0, 0, W, H) }];
  const boundary = rectPoly(0, 0, W, H);
  const { pngBuffer, stats, aborted } = classifyToClassmap({
    bands, width: W, height: H, bounds, boundary, surfaces,
  });
  assert.equal(aborted, false, 'realistic capture -> not aborted');
  assert.ok(pngBuffer, 'returns a png buffer');
  assert.ok(stats.mownPct >= 0.03, `mownPct ${stats.mownPct} clears the floor`);
  assert.ok(stats.sandPct <= 0.55, `sandPct ${stats.sandPct} under the ceiling`);
});

test('d: encoded PNG round-trips - R/B channels match the intended classes at known pixels', () => {
  const W = 32, H = 32;
  // Top strip sand (rows 0..7), middle fairway (rows 8..19), rest rough. No mown polys
  // (so sand survives S1 and fairway shows as coverage-add). Enough mown to clear S2.
  const bands = buildBands(W, H, (px, py) => (py < 8 ? 'sand' : py < 20 ? 'fairway' : 'rough'));
  const bounds = unitBounds(W, H);
  const surfaces = [{ kind: 'rough', poly: rectPoly(0, 0, W, H) }];
  const boundary = rectPoly(0, 0, W, H);
  const { pngBuffer, aborted } = classifyToClassmap({
    bands, width: W, height: H, bounds, boundary, surfaces,
  });
  assert.equal(aborted, false);
  const img = PNG.sync.read(pngBuffer);
  assert.equal(img.width, W); assert.equal(img.height, H);
  const at = (px, py) => (py * W + px) * 4;
  // sand pixel (interior of top strip)
  let o = at(16, 3);
  assert.equal(img.data[o + 2], 255, 'sand -> B=255');
  assert.equal(img.data[o + 0], 0, 'sand -> R=0');
  // fairway pixel (interior of middle band)
  o = at(16, 13);
  assert.equal(img.data[o + 0], 255, 'fairway -> R=255');
  assert.equal(img.data[o + 2], 0, 'fairway -> B=0');
  // rough pixel (interior of bottom band)
  o = at(16, 27);
  assert.equal(img.data[o + 0], 0, 'rough -> R=0');
  assert.equal(img.data[o + 2], 0, 'rough -> B=0');
  // every pixel: G=0, A=255
  assert.equal(img.data[at(16, 13) + 1], 0, 'G always 0');
  assert.equal(img.data[at(16, 13) + 3], 255, 'A always 255');
});

test('e: a sand pixel OUTSIDE the inside-course mask is excluded from sandPct (does not trip S2)', () => {
  // boundary=null path: inside-course mask = dilated (25 m) union of surface polys.
  // Layout (1px = 1m, W=120): an IN-COURSE block x in [0,60] (covered by one surface
  // poly) that is mostly fairway with a sand sub-strip, then a FAR sand block x in
  // [85,120] whose nearest poly edge (x=60) is > 25 m away -> excluded. The 25 m ring
  // (x in [60,85]) is sand and IS counted. If the far sand ALSO counted, total sand
  // would exceed 0.55 and S2 secondary would fire; proving no-abort proves it's excluded.
  const W = 120, H = 40;
  const bands = buildBands(W, H, (px, py) => {
    if (px < 60) return py < 30 ? 'fairway' : 'sand'; // in-course block: 30 rows fairway, 10 sand
    return 'sand';                                    // ring (60..84) + far block (85..119): sand
  });
  const bounds = unitBounds(W, H); // 1px = 1m; poly A right edge at metre x=60
  // One in-course poly over the whole left block: metres x in [0,60], y in [0,40].
  const surfaces = [{ kind: 'rough', poly: rectPoly(0, 0, 60, 40) }];
  const boundary = null; // force the dilated-union inside-course mask
  const { pngBuffer, stats, aborted } = classifyToClassmap({
    bands, width: W, height: H, bounds, boundary, surfaces,
  });
  assert.equal(aborted, false, 'out-of-mask far sand excluded -> S2 does NOT trip');
  assert.ok(pngBuffer, 'returns a buffer');
  assert.ok(stats.sandPct <= 0.55, `sandPct ${stats.sandPct} counts only in-mask pixels`);
  assert.ok(stats.mownPct >= 0.03, `mownPct ${stats.mownPct} clears the primary floor`);
});

test('f: a sand pixel OUTSIDE the inside-course mask is ZEROED in the PNG (R=0,B=0); in-course sand stays B=255', () => {
  // Output-clip complement of test e. Same boundary=null dilated-union layout: an
  // in-course block x in [0,60] (fairway over most of it, a sand sub-strip) and a FAR
  // sand block x in [85,120] whose nearest poly edge (x=60) is > 25 m away -> outside
  // the inside-course mask. That far sand still classifies 'sand', but the classmap must
  // NOT mark it (R=0,B=0) or the renderer overpaints the far-field aerial. Meanwhile the
  // in-course sand sub-strip must still emit B=255.
  const W = 120, H = 40;
  const bands = buildBands(W, H, (px, py) => {
    if (px < 60) return py < 30 ? 'fairway' : 'sand'; // in-course block: 30 rows fairway, 10 sand
    return 'sand';                                    // ring (60..84) + far block (85..119): sand
  });
  const bounds = unitBounds(W, H);
  const surfaces = [{ kind: 'rough', poly: rectPoly(0, 0, 60, 40) }]; // in-course poly, right edge metre x=60
  const boundary = null; // force the dilated-union inside-course mask
  const { pngBuffer, aborted } = classifyToClassmap({
    bands, width: W, height: H, bounds, boundary, surfaces,
  });
  assert.equal(aborted, false, 'not aborted');
  assert.ok(pngBuffer, 'returns a buffer');
  const img = PNG.sync.read(pngBuffer);
  const at = (px, py) => (py * W + px) * 4;
  // FAR sand pixel (100,20): classifies sand but is > 25 m outside the mask -> zeroed.
  let o = at(100, 20);
  assert.equal(img.data[o + 2], 0, 'off-course sand -> B=0 (clipped, not overpainted)');
  assert.equal(img.data[o + 0], 0, 'off-course sand -> R=0');
  // IN-COURSE sand pixel (interior of the bottom sand sub-strip, x<60, py in [30,39]).
  o = at(20, 35);
  assert.equal(img.data[o + 2], 255, 'in-course sand still emits B=255');
});

test('denoise: a lone 1px sand speck is dropped; a solid sand block survives (encode-only)', () => {
  const W = 32, H = 32;
  // Rows 0..7 fairway (clears the mown floor). A solid 8x8 sand block at cols 4..11,
  // rows 20..27 (survives the 3x3 majority). A LONE sand pixel at (25,25) with only
  // rough neighbors (the exact per-pixel false-positive speckle the filter targets).
  // Everything else rough; whole window in-course.
  const inBlock = (px, py) => px >= 4 && px <= 11 && py >= 20 && py <= 27;
  const bands = buildBands(W, H, (px, py) => {
    if (py < 8) return 'fairway';
    if (inBlock(px, py)) return 'sand';
    if (px === 25 && py === 25) return 'sand';
    return 'rough';
  });
  const bounds = unitBounds(W, H);
  const surfaces = [{ kind: 'rough', poly: rectPoly(0, 0, W, H) }];
  const boundary = rectPoly(0, 0, W, H);
  const { pngBuffer, aborted } = classifyToClassmap({ bands, width: W, height: H, bounds, boundary, surfaces });
  assert.equal(aborted, false, 'realistic mown -> not aborted');
  const img = PNG.sync.read(pngBuffer);
  const at = (px, py) => (py * W + px) * 4;
  assert.equal(img.data[at(25, 25) + 2], 0, 'isolated sand speck denoised away (B=0)');
  assert.equal(img.data[at(7, 23) + 2], 255, 'solid sand block interior survives (B=255)');
});

test('bad input (missing bands / surfaces) returns {pngBuffer:null, aborted:true, stats:{}} without throwing', () => {
  assert.deepEqual(
    classifyToClassmap({ width: 8, height: 8, bounds: unitBounds(8, 8), boundary: null, surfaces: [] }),
    { pngBuffer: null, aborted: true, stats: {} },
  );
  assert.deepEqual(
    classifyToClassmap({ bands: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8, bounds: unitBounds(8, 8), boundary: null }),
    { pngBuffer: null, aborted: true, stats: {} },
  );
});
