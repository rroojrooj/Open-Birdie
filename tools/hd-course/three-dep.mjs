// Strict 3DEP elevation adapter.
//
// Wraps lib/lidar.js `fetchPatchStrict` (which throws plain stage-coded errors)
// into the compiler's `HdCompileError` world, computes acquisition stats, and
// guards against the service returning data coarser than the pinned native
// spacing — never silently upsampling and labeling it HD.

import lidar from '../../lib/lidar.js';
import { HdCompileError } from './errors.mjs';
import { constants } from './coordinates.mjs';

const isNoData = (v) => !Number.isFinite(v) || v < -1e30;

export async function acquireElevation(bbox, { fetchImpl, targetM = 1, maxPx, nativeSpacingM, timeoutMs }) {
  let patch;
  try {
    patch = await lidar.fetchPatchStrict(bbox, { fetchImpl, targetM, maxPx, timeoutMs });
  } catch (e) {
    throw new HdCompileError('download-elevation', e.code || 'HD_3DEP_FETCH', { bbox }, e);
  }

  // Web Mercator metres are inflated by 1/cos(lat); multiply back to ground metres.
  const midLat = (bbox.north + bbox.south) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const mercSpacing = (patch.xmax - patch.xmin) / Math.max(1, patch.width - 1);
  const groundSpacingM = mercSpacing * cosLat;
  if (nativeSpacingM && groundSpacingM > nativeSpacingM * 1.5) {
    throw new HdCompileError('download-elevation', 'HD_3DEP_COARSE', {
      groundSpacingM: +groundSpacingM.toFixed(3), nativeSpacingM,
    });
  }

  let min = Infinity; let max = -Infinity; let valid = 0;
  for (const v of patch.heights) {
    if (isNoData(v)) continue;
    valid += 1;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  return {
    patch,
    stats: {
      width: patch.width,
      height: patch.height,
      validRatio: valid / patch.heights.length,
      min: valid ? min : null,
      max: valid ? max : null,
      groundSpacingM: +groundSpacingM.toFixed(3),
      nativeSpacingM: nativeSpacingM ?? null,
    },
  };
}

export { constants };
