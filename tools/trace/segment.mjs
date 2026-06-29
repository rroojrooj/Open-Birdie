// NDVI + texture pixel classifier, lifted from the pure core of
// tools/spike-segment.mjs. NDVI = (NIR - R) / (NIR + R) separates vegetation
// from bare ground, which is the fescue-vs-sand disambiguation that an RGB-only
// image (the draped course aerial) cannot do. The native NAIP COG carries the
// NIR band (band 4), so segmentation runs on that, not the drape.
//
// Output classes feed the vectorizer as candidate masks. A vision pass then
// LABELS which candidate is green/bunker/fairway and fixes edges; this stage
// only proposes regions, it is deliberately not the final say.

export function ndvi(R, N) { return (N - R) / (N + R + 1e-6); }

// thresholds are the spike's, kept verbatim so behaviour matches the validated spike
export function classifyPixel({ R, G, B, N }, texture) {
  const nd = ndvi(R, N);
  const brightness = (R + G + B) / 3;
  if (nd < 0.05 && brightness > 145) return 'sand';   // bright, non-veg -> bunker / waste
  if (nd < 0.02) return 'water';                       // dark, non-veg (or deep shadow)
  if (nd > 0.30 && texture < 9) return 'green';        // high vigor + smooth -> putting surface
  if (nd > 0.22 && texture < 16) return 'fairway';     // mown, medium texture
  return 'rough';                                      // native fescue / everything else
}

// 7px (r=3) local std-dev of grayscale, the spike's texture metric.
export function textureStd(gray, w, h, r = 3) {
  const tex = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0, s2 = 0, n = 0;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const jj = j + dj, ii = i + di;
      if (jj < 0 || jj >= h || ii < 0 || ii >= w) continue;
      const v = gray[jj * w + ii]; s += v; s2 += v * v; n++;
    }
    const m = s / n; tex[j * w + i] = Math.sqrt(Math.max(0, s2 / n - m * m));
  }
  return tex;
}

// bands: flat array length w*h*4, interleaved R,G,B,N per pixel. Returns a flat
// class-name array (length w*h).
export function segmentWindow(bands, w, h) {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = (bands[i * 4] + bands[i * 4 + 1] + bands[i * 4 + 2]) / 3;
  const tex = textureStd(gray, w, h);
  const out = new Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = classifyPixel(
      { R: bands[i * 4], G: bands[i * 4 + 1], B: bands[i * 4 + 2], N: bands[i * 4 + 3] },
      tex[i],
    );
  }
  return out;
}

// Build a binary mask (Uint8) for one class from a class array.
export const maskOf = (classes, kind) => Uint8Array.from(classes, (c) => (c === kind ? 1 : 0));
