// Pure color helpers for the aerial tint layer. Kept DOM-free so node:test can
// exercise them headless (the canvas glue lives in scene.js).

// sRGB byte [0,255] -> linear [0,1]. The tint texture is sampled as sRGB (decoded
// to linear by the GPU), so the normalizing average MUST be computed in linear
// space too, or the tint skews dark.
export function srgbToLinear(c8) {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// Mean linear RGB of an RGBA pixel buffer (Uint8ClampedArray from getImageData).
export function averageLinearColor(data) {
  let r = 0, g = 0, b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += srgbToLinear(data[i]); g += srgbToLinear(data[i + 1]); b += srgbToLinear(data[i + 2]);
  }
  return { r: r / n, g: g / n, b: b / n };
}
