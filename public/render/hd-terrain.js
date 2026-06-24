// High-resolution terrain mesh + a coarse mesh with the HD interior removed.
//
// The HD rectangle was compiler-snapped to coarse cell lines, so whole coarse
// cells inside it are dropped and the HD mesh fills the cutout — a shared
// boundary with ZERO positive-area overlap (a plain overlay is forbidden: lower
// HD relief could be occluded by the coarse surface). Vertex layout matches the
// runtime base mesh: pos = (minX+i·cellM, height, -(minY+j·cellM)) (THREE z is
// -localY), uv = (i/(nx-1), j/(ny-1)).

import * as THREE from 'three';

function gridGeometry(grid, skip) {
  const { minX, minY, cellM, nx, ny, heights } = grid;
  const pos = new Float32Array(nx * ny * 3);
  const uv = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const k = j * nx + i;
      pos[k * 3] = minX + i * cellM;
      pos[k * 3 + 1] = heights[k];
      pos[k * 3 + 2] = -(minY + j * cellM);
      uv[k * 2] = i / (nx - 1);
      uv[k * 2 + 1] = j / (ny - 1);
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

export function buildHdTerrain({ grid, material }) {
  const mesh = new THREE.Mesh(gridGeometry(grid), material);
  mesh.receiveShadow = true;
  return mesh;
}

export function buildCoarseTerrain({ grid, cutout, material }) {
  const { minX, minY, cellM } = grid;
  const eps = cellM * 1e-6;
  // Remove a coarse cell only if its WHOLE footprint lies inside the HD rect.
  // (The HD rect is snapped to cell lines, so cells are fully in or fully out.)
  const inCutout = cutout ? (i, j) => {
    const x0 = minX + i * cellM; const x1 = minX + (i + 1) * cellM;
    const y0 = minY + j * cellM; const y1 = minY + (j + 1) * cellM;
    return x0 >= cutout.minX - eps && x1 <= cutout.maxX + eps && y0 >= cutout.minY - eps && y1 <= cutout.maxY + eps;
  } : null;
  const mesh = new THREE.Mesh(gridGeometry(grid, inCutout), material);
  mesh.receiveShadow = true;
  return mesh;
}
