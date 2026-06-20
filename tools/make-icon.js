'use strict';
// Generates build/icon.ico — the Windows installer + app/taskbar icon.
// Draws a flag-on-green mark in the app accent and packs a multi-resolution,
// PNG-embedded .ico. Uses only pngjs (already a dependency), so it stays
// offline with no extra image tooling.  Run: npm run make-icon

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const GREEN = [0x2f, 0x9e, 0x54]; // app accent
const WHITE = [0xf8, 0xfa, 0xf8];
const SIZES = [16, 32, 48, 64, 128, 256];
const SS = 4; // supersamples per axis for anti-aliasing

// --- shape membership in normalized 0..1 coords (origin top-left) ---
function inRoundedRect(u, v, rc) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  const cx = u < rc ? rc : u > 1 - rc ? 1 - rc : u;
  const cy = v < rc ? rc : v > 1 - rc ? 1 - rc : v;
  const dx = u - cx, dy = v - cy;
  return dx * dx + dy * dy <= rc * rc;
}
function inRect(u, v, x0, y0, x1, y1) {
  return u >= x0 && u <= x1 && v >= y0 && v <= y1;
}
function inCircle(u, v, cx, cy, r) {
  const dx = u - cx, dy = v - cy;
  return dx * dx + dy * dy <= r * r;
}
function inTri(u, v, a, b, c) {
  const sign = (p, q, r) =>
    (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = sign([u, v], a, b);
  const d2 = sign([u, v], b, c);
  const d3 = sign([u, v], c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// flag geometry (normalized): a pin, a right-pointing flag, a ball at the base
const PIN = [0.355, 0.17, 0.405, 0.85];
const FLAG = [[0.405, 0.20], [0.70, 0.30], [0.405, 0.40]];
const BALL = [0.63, 0.81, 0.055];

function fg(u, v) {
  return (
    inRect(u, v, ...PIN) ||
    inTri(u, v, FLAG[0], FLAG[1], FLAG[2]) ||
    inCircle(u, v, BALL[0], BALL[1], BALL[2])
  );
}

function render(size) {
  const png = new PNG({ width: size, height: size });
  const rc = 0.22; // corner radius (normalized)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // premultiplied accumulation avoids a dark fringe on AA edges
      let pr = 0, pg = 0, pb = 0, pa = 0, n = SS * SS;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const bg = inRoundedRect(u, v, rc);
          if (!bg) continue;
          const col = fg(u, v) ? WHITE : GREEN;
          pr += col[0]; pg += col[1]; pb += col[2]; pa += 255;
        }
      }
      const i = (y * size + x) * 4;
      if (pa === 0) {
        png.data[i] = png.data[i + 1] = png.data[i + 2] = png.data[i + 3] = 0;
      } else {
        png.data[i] = Math.round(pr / (pa / 255));
        png.data[i + 1] = Math.round(pg / (pa / 255));
        png.data[i + 2] = Math.round(pb / (pa / 255));
        png.data[i + 3] = Math.round(pa / n);
      }
    }
  }
  return PNG.sync.write(png);
}

// --- pack PNGs into a multi-resolution ICO (PNG-embedded, Vista+) ---
function packIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  images.forEach((img, idx) => {
    const o = idx * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o + 0); // width (0 => 256)
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o + 1); // height
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(img.png.length, o + 8); // bytes in resource
    dir.writeUInt32LE(offset, o + 12); // offset
    offset += img.png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

const images = SIZES.map((size) => ({ size, png: render(size) }));
const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'icon.ico');
fs.writeFileSync(out, packIco(images));
console.log(`icon.ico written (${SIZES.join('/')} px) → ${out}`);
