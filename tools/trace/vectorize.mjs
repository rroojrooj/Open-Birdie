// Binary mask -> simplified polygon rings (one per connected blob).
//   1. 4-connected components (drop blobs below minArea = noise specks)
//   2. Moore-neighbor boundary trace (clockwise) of each blob
//   3. Douglas-Peucker simplify, escalating epsilon until <= maxPts (the
//      precision cap from the trace schema)
// Pure: pixel-space in, pixel-space rings out. Convert to local metres with
// aerial-xform after.

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; // CW from East

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
}

function dp(pts, eps) {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max > eps) return [...dp(pts.slice(0, idx + 1), eps).slice(0, -1), ...dp(pts.slice(idx), eps)];
  return [pts[0], pts[pts.length - 1]];
}

function components(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const comps = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    const stack = [s]; seen[s] = 1; const px = [];
    while (stack.length) {
      const p = stack.pop(); px.push(p);
      const x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    comps.push(px);
  }
  return comps;
}

// Moore-neighbor contour trace, clockwise, starting at the blob's topmost-then-
// leftmost pixel (entered from the West). Returns boundary pixels in order.
function traceContour(get, sx, sy, cap) {
  const boundary = [];
  let cx = sx, cy = sy, backtrack = 4; // 4 = West = where we came from
  let steps = 0;
  do {
    boundary.push([cx, cy]);
    let found = false;
    for (let k = 1; k <= 8; k++) {
      const d = (backtrack + k) % 8;
      const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
      if (get(nx, ny)) { backtrack = (d + 4) % 8; cx = nx; cy = ny; found = true; break; }
    }
    if (!found) break; // isolated pixel
  } while ((cx !== sx || cy !== sy) && ++steps < cap);
  return boundary;
}

export function vectorize(mask, w, h, opts = {}) {
  const { minArea = 12, eps = 1.0, maxPts = 40 } = opts;
  const rings = [];
  for (const comp of components(mask, w, h)) {
    if (comp.length < minArea) continue;
    const set = new Uint8Array(w * h);
    for (const p of comp) set[p] = 1;
    let sp = comp[0];
    for (const p of comp) {
      const y = (p / w) | 0, sy = (sp / w) | 0;
      if (y < sy || (y === sy && (p % w) < (sp % w))) sp = p;
    }
    const get = (x, y) => x >= 0 && y >= 0 && x < w && y < h && set[y * w + x];
    // traceContour returns an OPEN polyline (start .. last pixel before returning
    // to start). DP it as-is — do NOT re-append the start, or the degenerate
    // first==last base line makes every perpDist 0 and collapses the ring to 2 pts.
    const ring = traceContour(get, sp % w, (sp / w) | 0, w * h * 8 + 16);
    if (ring.length < 3) continue;
    let e = eps, simp = dp(ring, e);
    while (simp.length > maxPts && e < 1e6) { e *= 1.5; simp = dp(ring, e); }
    if (simp.length >= 3) rings.push(simp);
  }
  return rings;
}
