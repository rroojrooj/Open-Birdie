// High-resolution terrain mesh + a coarse mesh with the HD interior removed.
//
// The HD rectangle was compiler-snapped to coarse cell lines, so whole coarse
// cells inside it are dropped and the HD mesh fills the cutout — a shared
// boundary with ZERO positive-area overlap (a plain overlay is forbidden: lower
// HD relief could be occluded by the coarse surface). Vertex layout matches the
// runtime base mesh: pos = (minX+i·cellM, height, -(minY+j·cellM)) (THREE z is
// -localY), uv = (i/(nx-1), j/(ny-1)).

import * as THREE from 'three';

function gridGeometry(grid, skip, uvBounds) {
  const { minX, minY, cellM, nx, ny, heights } = grid;
  // UVs are course-relative when uvBounds is given (so a course-wide splat/mask
  // aligns over an HD sub-mesh); otherwise self-relative (i/(nx-1)).
  const ub = uvBounds || { minX, minY, maxX: minX + (nx - 1) * cellM, maxY: minY + (ny - 1) * cellM };
  const uExtX = ub.maxX - ub.minX; const uExtY = ub.maxY - ub.minY;
  const pos = new Float32Array(nx * ny * 3);
  const uv = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const k = j * nx + i;
      pos[k * 3] = minX + i * cellM;
      pos[k * 3 + 1] = heights[k];
      pos[k * 3 + 2] = -(minY + j * cellM);
      uv[k * 2] = (minX + i * cellM - ub.minX) / uExtX;
      uv[k * 2 + 1] = (minY + j * cellM - ub.minY) / uExtY;
    }
  }
  const idx = [];
  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      if (skip && skip(i, j)) continue;
      const a = j * nx + i; const c = a + nx;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  return geom;
}

// True when grid cell (i,j)'s WHOLE footprint lies inside any of `rects`. HD rects
// are snapped to coarse cell lines, so a cell is fully in or fully out — no partial
// cells. Shared by the coarse cutout (drop cells under any HD patch) and the HD
// skip-overlap clip (drop cells already covered by an earlier patch).
export function cellInAnyRect(grid, i, j, rects) {
  if (!rects || !rects.length) return false;
  const { minX, minY, cellM } = grid;
  const eps = cellM * 1e-6;
  const x0 = minX + i * cellM; const x1 = minX + (i + 1) * cellM;
  const y0 = minY + j * cellM; const y1 = minY + (j + 1) * cellM;
  for (const r of rects) {
    if (x0 >= r.minX - eps && x1 <= r.maxX + eps && y0 >= r.minY - eps && y1 <= r.maxY + eps) return true;
  }
  return false;
}

// One HD patch mesh. `skipBounds` (rects of EARLIER patches) drops cells already
// covered upstream, so overlapping padded hole rects don't double-cover / z-fight;
// the kept patch matches the sampler's first-match order (visuals == physics).
export function buildHdTerrain({ grid, material, uvBounds, skipBounds }) {
  const skip = (skipBounds && skipBounds.length) ? (i, j) => cellInAnyRect(grid, i, j, skipBounds) : null;
  const mesh = new THREE.Mesh(gridGeometry(grid, skip, uvBounds), material);
  mesh.receiveShadow = true;
  return mesh;
}

export function buildCoarseTerrain({ grid, cutouts, material }) {
  // Remove a coarse cell if its whole footprint lies inside ANY HD patch rect, so
  // the HD meshes fill the union of cutouts with zero positive-area overlap.
  const inCutout = (cutouts && cutouts.length) ? (i, j) => cellInAnyRect(grid, i, j, cutouts) : null;
  const mesh = new THREE.Mesh(gridGeometry(grid, inCutout), material);
  mesh.receiveShadow = true;
  return mesh;
}
