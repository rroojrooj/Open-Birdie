// Resample a 3DEP patch onto the local HD grid.
//
// Mirrors lib/elevation.js `resampleToLocal`: per output cell, project local
// metres -> WGS84 -> Web Mercator, sample the patch, store heights relative to
// baseM with the same 0.01 m quantization the base grid uses (so two compiles
// produce identical f32 bytes). NoData cells fall back to the coarse base height;
// a single edge-blend ring matches the patch boundary to the coarse surround.

import { HdCompileError } from './errors.mjs';
import { localToWgs84, lonToMerc, latToMerc } from './coordinates.mjs';

const quant = (h) => Math.round(h * 100) / 100;

export function resampleTerrain({ sampler, snapped, origin, baseM, baseHeightAt, featherM = 4, maxGapRatio = 0.5 }) {
  const { minX, minY, maxX, maxY, cellM, nx, ny } = snapped;
  const heights = new Float32Array(nx * ny);

  let gaps = 0;
  for (let j = 0; j < ny; j++) {
    const y = minY + j * cellM;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * cellM;
      const ll = localToWgs84({ x, y }, origin);
      const v = sampler(lonToMerc(ll.lon), latToMerc(ll.lat));
      if (v == null) { heights[j * nx + i] = quant(baseHeightAt(x, y)); gaps += 1; }
      else { heights[j * nx + i] = quant(v - baseM); }
    }
  }

  const gapRatio = gaps / (nx * ny);
  if (gapRatio > maxGapRatio) {
    throw new HdCompileError('download-elevation', 'HD_3DEP_GAPS', { gapRatio: +gapRatio.toFixed(3), maxGapRatio });
  }

  // One baked edge-blend ring toward the base so the patch boundary matches the
  // surrounding coarse grid — the runtime applies no second feather.
  for (let j = 0; j < ny; j++) {
    const y = minY + j * cellM;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * cellM;
      const dist = Math.min(x - minX, maxX - x, y - minY, maxY - y);
      if (dist < featherM) {
        const w = dist / featherM;
        const base = quant(baseHeightAt(x, y));
        heights[j * nx + i] = quant(base * (1 - w) + heights[j * nx + i] * w);
      }
    }
  }

  return { heights, nx, ny, cellM, minX, minY, baseM, gapRatio };
}
