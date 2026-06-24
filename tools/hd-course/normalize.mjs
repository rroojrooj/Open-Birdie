// Deterministic tone normalization via a pinned 256-entry LUT.
//
// The source orthophoto is a macro-albedo starting point, not a finished
// material: this caps black/white extremes that cause lighting artifacts using
// FIXED parameters — no AI enhancement, no adaptive auto-grade — so two compiles
// produce identical pixels.

export function buildPinnedLut({ blackPoint = 4, whitePoint = 251, gamma = 1.0 } = {}) {
  const lut = new Uint8Array(256);
  const span = whitePoint - blackPoint;
  for (let i = 0; i < 256; i += 1) {
    let v = (i - blackPoint) / span;
    v = Math.min(1, Math.max(0, v));
    if (gamma !== 1.0) v = v ** gamma;
    lut[i] = Math.round(v * 255);
  }
  return lut;
}

export function applyLut(rgb, lut) {
  const out = Buffer.alloc(rgb.length);
  for (let i = 0; i < rgb.length; i += 1) out[i] = lut[rgb[i]];
  return out;
}
