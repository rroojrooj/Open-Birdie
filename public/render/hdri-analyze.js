// Pure analysis of an equirectangular HDRI's float pixel data.
// No three.js import so it runs in node tests and the browser alike.
// data: Float32Array RGBA, row-major. Row 0 = zenith, last row = nadir.

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Brightest texel -> { azimuth (rad, 0..2π), altitude (rad, -π/2..π/2) }.
// step samples a subset for speed on large (4K) images.
export function sunSphericalFromEquirect(data, width, height, step = 2) {
  let best = -Infinity, bx = 0, by = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const L = lum(data[i], data[i + 1], data[i + 2]);
      if (L > best) { best = L; bx = x; by = y; }
    }
  }
  const azimuth = ((bx + 0.5) / width) * Math.PI * 2;
  const colatitude = ((by + 0.5) / height) * Math.PI; // 0 = zenith
  const altitude = Math.PI / 2 - colatitude;           // + above horizon
  return { azimuth, altitude };
}

// Spherical (azimuth, altitude in rad) -> unit direction in THREE space.
// Sim axes x=east, y=north, z=up map to THREE as (x, z, -y), so:
//   east -> +X, straight up -> +Y, north -> -Z. (Unit-tested for handedness — D3.)
export function sunDirectionVec(azimuth, altitude) {
  const ca = Math.cos(altitude);
  return { x: ca * Math.sin(azimuth), y: Math.sin(altitude), z: -ca * Math.cos(azimuth) };
}

// Average color of the rows near the horizon (v ≈ 0.5), tone-mapped to 0xRRGGBB.
export function horizonColorFromEquirect(data, width, height) {
  const y0 = Math.floor(height * 0.46), y1 = Math.ceil(height * 0.54);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  r /= n; g /= n; b /= n;
  // simple Reinhard + gamma so the fog tint matches the displayed sky, not raw HDR
  const enc = (c) => Math.min(255, Math.round(Math.pow(c / (1 + c), 1 / 2.2) * 255));
  return (enc(r) << 16) | (enc(g) << 8) | enc(b);
}
