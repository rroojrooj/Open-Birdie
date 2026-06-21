// Pure geometry helpers for "surface patches" — rendering a golf surface polygon
// (bunker/green/tee) as its own mesh draped on the terrain height field, so its
// boundary is a real geometric edge (crisp at any zoom) instead of a blurry
// low-res splat paint. No three / no DOM here, so it unit-tests under node;
// scene.js triangulates (THREE.ShapeUtils) and assembles the BufferGeometry.

// Split polygon edges longer than maxLen so the draped boundary follows terrain
// relief. Drops a closing-duplicate vertex (OSM rings often repeat point 0).
// Returns an open ring of [x, y] in local meters.
export function densifyRing(poly, maxLen) {
  const ring = poly.slice();
  if (ring.length > 1) {
    const a = ring[0], b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) ring.pop();
  }
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    out.push([a[0], a[1]]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const segs = Math.max(1, Math.floor(len / maxLen));
    for (let s = 1; s < segs; s++) {
      const t = s / segs;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// Drape a ring onto sampler(x,y)->height, emitting positions in three coords
// (x, h+offset, -y) and UVs normalized over `bounds` (same UV space as the base
// terrain, so the tiled PBR detail lines up). Returns {pos:Float32Array, uv:Float32Array}.
export function drapeRing(ring, sampler, bounds, offset = 0) {
  const n = ring.length;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const extX = bounds.maxX - bounds.minX, extY = bounds.maxY - bounds.minY;
  for (let i = 0; i < n; i++) {
    const x = ring[i][0], y = ring[i][1];
    pos[i * 3] = x;
    pos[i * 3 + 1] = sampler(x, y) + offset;
    pos[i * 3 + 2] = -y;
    uv[i * 2] = (x - bounds.minX) / extX;
    uv[i * 2 + 1] = (y - bounds.minY) / extY;
  }
  return { pos, uv };
}
