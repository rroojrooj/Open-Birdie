// Procedural, tileable detail textures for the terrain — generated in-canvas so
// the app stays zero-asset / offline (no external texture files to bundle). The
// terrain albedo is the low-frequency "which surface is where" splat; these add
// the high-frequency, per-meter relief that was missing (the splat was a single
// 0..1 stretch over the whole course, so the turf read as flat carpet). Tiled at
// world scale and lit by the directional sun, this relief is what makes grass
// and sand catch light instead of looking painted.
import * as THREE from 'three';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box blur with wrap-around sampling, so the resulting field tiles seamlessly.
function wrapBlur(src, size, passes) {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let s = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            s += a[((y + j + size) % size) * size + ((x + i + size) % size)];
        } }
        b[y * size + x] = s / 9;
      }
    }
    a = b;
  }
  return a;
}

// Tileable grass-relief normal map: a soft clump layer (blurred noise) plus a
// sharp blade-speckle layer, Sobel-differentiated into a tangent-space normal.
let _grassNormal = null;
export function grassNormalTexture(size = 256) {
  if (_grassNormal) return _grassNormal;
  const rnd = mulberry32(1337);
  const rough = new Float32Array(size * size);
  for (let i = 0; i < rough.length; i++) rough[i] = rnd();
  const clumps = wrapBlur(rough, size, 2);
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) height[i] = clumps[i] * 0.72 + rough[i] * 0.28;

  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  const strength = 2.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      img.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace; // normal vectors are linear data
  _grassNormal = tex;
  return tex;
}
