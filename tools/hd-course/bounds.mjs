// Compilation-extent computation and grid snapping.
//
// The HD patch covers the hole routing plus a configurable padding, snapped
// OUTWARD so its rectangle edges land on the coarse grid's cell lines (so the
// runtime can excise whole coarse cells with a shared boundary) AND so the HD
// grid tiles the extent with a single, exact cell size — the consistency the
// lib/hd-bundle.js validator enforces ((nx-1)*cellM == width).

import { HdCompileError } from './errors.mjs';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;

export function computeHoleBounds(course, holeRef, paddingM) {
  const hole = (course.holes || []).find((h) => h.ref === holeRef);
  if (!hole) throw new HdCompileError('compute-bounds', 'HD_HOLE_NOT_FOUND', { holeRef });

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of hole.line || []) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new HdCompileError('compute-bounds', 'HD_BOUNDS_NONFINITE', {});
    }
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) throw new HdCompileError('compute-bounds', 'HD_NO_GEOMETRY', { holeRef });

  return { minX: minX - paddingM, minY: minY - paddingM, maxX: maxX + paddingM, maxY: maxY + paddingM };
}

export function snapHdBounds(raw, { coarse, targetSpacingM, maxDim = 20000, maxPixels = 2_000_000_000 }) {
  const hdInt = Math.round(targetSpacingM);
  const coarseInt = Math.round(coarse.cellM);
  if (hdInt <= 0 || coarseInt <= 0) throw new HdCompileError('compute-bounds', 'HD_BAD_CELL', { targetSpacingM, coarse: coarse.cellM });
  const snap = lcm(hdInt, coarseInt); // 15 for HD 3 m over coarse 5 m

  const snapEdge = (v, origin, dir) => {
    const k = (v - origin) / snap;
    return origin + (dir < 0 ? Math.floor(k) : Math.ceil(k)) * snap;
  };
  const minX = snapEdge(raw.minX, coarse.minX, -1);
  const maxX = snapEdge(raw.maxX, coarse.minX, +1);
  const minY = snapEdge(raw.minY, coarse.minY, -1);
  const maxY = snapEdge(raw.maxY, coarse.minY, +1);

  const cellM = targetSpacingM;
  const nx = Math.round((maxX - minX) / cellM) + 1;
  const ny = Math.round((maxY - minY) / cellM) + 1;
  if (nx > maxDim || ny > maxDim || nx * ny > maxPixels) {
    throw new HdCompileError('compute-bounds', 'HD_BOUNDS_TOO_LARGE', { nx, ny, maxDim, maxPixels });
  }
  return { minX, minY, maxX, maxY, cellM, nx, ny };
}
