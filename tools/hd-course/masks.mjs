// Build-time semantic mask rasterizer (pure JS — no Canvas in Node).
//
// Rasterizes OSM surface polygons into the schema-v1 mask channels, north-up
// (row 0 = maxY), supersampled then box-downsampled for clean edges. Surface
// priority matches the runtime lookup (lib/course.js:413). NOTE: this duplicates
// the runtime painter public/render/scene.js `_paintMask`; a shared polygon-to-
// mask core is a post-prototype TODO.

import { HdCompileError } from './errors.mjs';

const PRIORITY = ['water', 'bunker', 'green', 'tee', 'fairway'];

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]; const yi = poly[i][1];
    const xj = poly[j][0]; const yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function surfaceAt(x, y, byKind) {
  for (const kind of PRIORITY) {
    for (const poly of byKind[kind] || []) {
      if (pointInPoly(x, y, poly)) return kind;
    }
  }
  return null; // rough is implicit
}

export function rasterizeMasks({ surfaces, snapped, width, height, ss = 4 }) {
  const W = width; const H = height;
  const { minX, minY, maxX, maxY } = snapped;
  if (!(W > 0) || !(H > 0)) throw new HdCompileError('rasterize-masks', 'HD_MASK_DIMS', { W, H });

  const byKind = {};
  for (const s of surfaces || []) (byKind[s.kind] ||= []).push(s.poly);

  const counts = {
    fairway: new Uint16Array(W * H), green: new Uint16Array(W * H),
    tee: new Uint16Array(W * H), bunker: new Uint16Array(W * H), water: new Uint16Array(W * H),
  };
  const ssW = W * ss; const ssH = H * ss;
  for (let sj = 0; sj < ssH; sj += 1) {
    const y = maxY - ((sj + 0.5) / ssH) * (maxY - minY); // north-up: top row = maxY
    const oj = (sj / ss) | 0;
    for (let si = 0; si < ssW; si += 1) {
      const x = minX + ((si + 0.5) / ssW) * (maxX - minX);
      const kind = surfaceAt(x, y, byKind);
      if (kind && counts[kind]) counts[kind][oj * W + ((si / ss) | 0)] += 1;
    }
  }

  const per = ss * ss;
  const scale = (c) => Math.round((255 * c) / per);
  const surfacesRgba = Buffer.alloc(W * H * 4);
  const coverageRgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i += 1) {
    surfacesRgba[i * 4 + 0] = scale(counts.fairway[i]);
    surfacesRgba[i * 4 + 1] = scale(counts.green[i]);
    surfacesRgba[i * 4 + 2] = scale(counts.tee[i]);
    surfacesRgba[i * 4 + 3] = scale(counts.bunker[i]);
    coverageRgba[i * 4 + 0] = 255; // imagery validity (a successful build has full coverage)
    coverageRgba[i * 4 + 1] = scale(counts.water[i]);
    coverageRgba[i * 4 + 2] = 0;
    coverageRgba[i * 4 + 3] = 255;
  }
  return { width: W, height: H, surfaces: surfacesRgba, coverage: coverageRgba };
}

export { PRIORITY };
