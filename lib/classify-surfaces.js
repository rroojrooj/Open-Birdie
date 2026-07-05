'use strict';
// Runtime NDVI surface classifier: turns co-registered infrared bands (from
// lib/ndvi-fetch.js) into a small RGBA class-map PNG that supplements OSM.
//   R = 255 where a pixel classifies 'fairway'  -> mown-detect, adds mow stripes
//                                                    + fairway material where OSM's
//                                                    fairway coverage is sparse.
//   B = 255 where a pixel classifies 'sand' (post-S1) -> tiled sand for dune/waste
//                                                    OSM never mapped.
//   G = 0, A = 255.
// NDVI only ever ADDS coverage OSM missed; the shader unions these channels with
// the OSM masks and greens stay 100% OSM-driven.
//
// Two calibrated safeguards (numbers pinned by the Task-0 spike, do not change):
//   S1 - suppress sand wherever OSM marks the ground mown (fairway/tee/green). Bright
//        low-NDVI is exactly dry links fairway fescue (Chambers' tan-gold fairways);
//        without S1 they'd tile as sand on the fairway.
//   S2 - coverage-sanity abort over the inside-course mask:
//        PRIMARY   abort if mownPct < 0.03  (the real failure - NIR silently degrading
//                  to the red band - collapses mown to ~0 while leaving sand plausible;
//                  real courses: chambers 22.8%, sawgrass 7.4%).
//        SECONDARY abort if sandPct > 0.55  (catches an all-sand nodata tile; real max
//                  ~18%, so a legit sandy links never trips).
//
// Runtime-safe: pngjs only (already a runtime dep). NO sharp / geotiff / browser
// canvas. Never throws on bad input - returns an aborted result instead.

const { PNG } = require('pngjs');
const { segmentWindow } = require('./segment-core');

// S2 thresholds - calibrated by the Task-0 spike. Do NOT change.
const MOWN_FLOOR = 0.03;   // PRIMARY: below this the capture is degraded (NIR->R).
const SAND_CEIL = 0.55;    // SECONDARY: above this it's an all-sand nodata tile.
const DILATE_M = 25;       // inside-course mask dilation when boundary is null.
const DENOISE_MIN = 5;     // 3x3 majority: keep a class pixel only if >= this many of
                           // its 9-neighborhood (self + 8) share the class. Kills the
                           // per-pixel NDVI speckle (dry-fescue / tree-shadow false
                           // positives) that renders as blocky tan/striped specks;
                           // solid bunkers + fairways survive. Encode-only (below).
const FEATHER_M = 3.5;     // feather the class edges over ~this many metres so the low-res
                           // texel boundaries (~2.4-5.7 m/texel over a whole course) don't
                           // render as hard "Minecraft" tiles at close range. Blur radius is
                           // derived from the real texel size so big courses don't oversoften.

const MOWN_KINDS = new Set(['fairway', 'tee', 'green']);

// --- Node-safe geometry (copied from lib/course.js; browser canvas is unavailable here) ---

// point-in-polygon (ray cast)
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// shortest distance from a point to a line segment
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// shortest distance from a point to a polygon's edges
function distToPolyEdges(x, y, poly) {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = distToSeg(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
    if (d < min) min = d;
  }
  return min;
}

const isPoly = (p) => Array.isArray(p) && p.length >= 3;

// axis-aligned bbox of a poly in local metres, expanded outward by `margin`.
// Used as a cheap 4-comparison pre-reject before the O(edges) point-in-poly /
// distance tests: a pixel outside the (margin-expanded) box can never be inside
// the (margin-dilated) polygon, so it's skipped without flipping any in/out result.
function polyBBox(poly, margin) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const x = poly[i][0], y = poly[i][1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}
const outsideBBox = (x, y, b) => x < b.minX || x > b.maxX || y < b.minY || y > b.maxY;

// 3x3 majority denoise: out[i]=1 iff >= minCount of the pixel's 9-neighborhood
// (self + 8, edge-clamped) are set. Single pass — removes isolated speckle and
// 1-px strings, fills pinholes, preserves solid blobs. Cleans the per-pixel class
// rasters before encode so lone false-positive pixels don't tile as blocky specks.
function majorityDenoise(mask, width, height, minCount) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (mask[yy * width + xx]) n++;
        }
      }
      if (n >= minCount) out[y * width + x] = 1;
    }
  }
  return out;
}

// Box-blur a 0/1 mask to 0..255 COVERAGE (edge-clamped KxK average). Softens the
// class-map's low-res texel boundaries so the shader's linear sand/mown blend fades
// across the edge instead of stair-stepping into hard tiles at close range. Solid-blob
// interiors stay ~255; only the boundaries ramp.
function boxBlurCoverage(mask, width, height, radius) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += mask[yy * width + xx]; cnt++;
        }
      }
      out[y * width + x] = (255 * sum / cnt + 0.5) | 0;
    }
  }
  return out;
}

// px -> local-metre center of a pixel. Row 0 = north = maxY (matches the aerial drape).
function pxToMetre(px, py, width, height, bounds) {
  const x = bounds.minX + ((px + 0.5) / width) * (bounds.maxX - bounds.minX);
  const y = bounds.maxY - ((py + 0.5) / height) * (bounds.maxY - bounds.minY);
  return [x, y];
}

function classifyToClassmap({ bands, width, height, bounds, boundary, surfaces } = {}) {
  // No throw on bad input - degrade to OSM-only.
  if (!bands || !Array.isArray(surfaces) || !width || !height || !bounds) {
    return { pngBuffer: null, aborted: true, stats: {} };
  }

  // 1. Pure per-pixel classification (the real classifier runs here).
  const classes = segmentWindow(bands, width, height);

  const mownPolys = surfaces.filter((s) => MOWN_KINDS.has(s.kind) && isPoly(s.poly));
  const allPolys = surfaces.filter((s) => isPoly(s.poly));

  // Per-poly expanded AABBs (local metres) used to spatially pre-reject the
  // per-pixel-per-poly tests below. Margin 0 for mown polys (pure point-in-poly,
  // no dilation); DILATE_M for the null-boundary dilation polys (a pixel up to
  // DILATE_M outside can still be "inside" via distToPolyEdges < DILATE_M). The
  // box is a conservative superset of the (dilated) poly -> no in/out pixel flips.
  const mownBoxes = mownPolys.map((s) => polyBBox(s.poly, 0));
  const dilateBoxes = allPolys.map((s) => polyBBox(s.poly, DILATE_M));

  // 2. Node-side OSM mown raster + 4. inside-course mask, both in ONE px sweep.
  const hasBoundary = isPoly(boundary);
  const mownMask = new Uint8Array(width * height);
  const inCourse = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = py * width + px;
      const [mx, my] = pxToMetre(px, py, width, height, bounds);

      // mown membership: inside the union of mown polys
      for (let k = 0; k < mownPolys.length; k++) {
        if (outsideBBox(mx, my, mownBoxes[k])) continue;
        if (pointInPoly(mx, my, mownPolys[k].poly)) { mownMask[i] = 1; break; }
      }

      // inside-course membership
      if (hasBoundary) {
        inCourse[i] = pointInPoly(mx, my, boundary) ? 1 : 0;
      } else {
        // null boundary (e.g. Sawgrass): dilated (25 m) union of ALL surface polys.
        let inside = 0;
        for (let k = 0; k < allPolys.length; k++) {
          if (outsideBBox(mx, my, dilateBoxes[k])) continue;
          if (pointInPoly(mx, my, allPolys[k].poly) || distToPolyEdges(mx, my, allPolys[k].poly) < DILATE_M) {
            inside = 1; break;
          }
        }
        inCourse[i] = inside;
      }
    }
  }

  // 3. S1: force sand off wherever the ground is OSM-mown.
  for (let i = 0; i < classes.length; i++) {
    if (mownMask[i] && classes[i] === 'sand') classes[i] = 'rough';
  }

  // 5. S2 stats over the inside-course mask.
  let inCount = 0, mownCount = 0, sandCount = 0;
  for (let i = 0; i < classes.length; i++) {
    if (!inCourse[i]) continue;
    inCount++;
    const c = classes[i];
    if (c === 'fairway' || c === 'green') mownCount++;
    else if (c === 'sand') sandCount++;
  }
  const mownPct = inCount ? mownCount / inCount : 0;
  const sandPct = inCount ? sandCount / inCount : 0;
  const stats = { mownPct, sandPct };

  // PRIMARY then SECONDARY abort.
  if (mownPct < MOWN_FLOOR || sandPct > SAND_CEIL) {
    return { pngBuffer: null, stats, aborted: true };
  }

  // 6. Denoise the per-pixel class rasters, then encode RGBA (R=255 fairway
  // mown-detect, B=255 sand post-S1, G=0, A=255). Build each raster clipped to the
  // inside-course mask FIRST (off-course beach / parking / bare ground stays 0 so the
  // far-field aerial shows through), majority-denoise to drop lone false-positive
  // specks, then re-clip to inCourse so the pinhole-fill can't bleed past the course
  // edge. Denoise is encode-only — the S2 stats above run on the raw classes, so the
  // calibrated abort thresholds are unchanged.
  const fairRaw = new Uint8Array(width * height);
  const sandRaw = new Uint8Array(width * height);
  for (let i = 0; i < classes.length; i++) {
    if (!inCourse[i]) continue;
    if (classes[i] === 'fairway') fairRaw[i] = 1;
    else if (classes[i] === 'sand') sandRaw[i] = 1;
  }
  const fair = majorityDenoise(fairRaw, width, height, DENOISE_MIN);
  const sand = majorityDenoise(sandRaw, width, height, DENOISE_MIN);
  // Feather the denoised masks to 0..255 coverage so the shader's linear sand/mown
  // blend fades across the low-res class edges instead of stair-stepping into hard
  // "Minecraft" tiles at close range. Blur radius derived from the real texel size
  // (metres/px) so a big course doesn't oversoften. Re-clipped to inCourse below.
  const texelM = (bounds.maxX - bounds.minX) / width;
  const featherR = Math.max(1, Math.min(3, Math.round(FEATHER_M / Math.max(texelM, 0.1))));
  const fairCov = boxBlurCoverage(fair, width, height, featherR);
  const sandCov = boxBlurCoverage(sand, width, height, featherR);

  const png = new PNG({ width, height });
  for (let i = 0; i < classes.length; i++) {
    const o = i * 4;
    const on = inCourse[i] ? 1 : 0;   // off-course beach/parking stays 0
    png.data[o] = on * fairCov[i];
    png.data[o + 1] = 0;
    png.data[o + 2] = on * sandCov[i];
    png.data[o + 3] = 255;
  }
  return { pngBuffer: PNG.sync.write(png), stats, aborted: false };
}

module.exports = { classifyToClassmap };
