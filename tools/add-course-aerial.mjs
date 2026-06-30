// Fetch ONE course-wide aerial covering the whole course and attach it as
// `course.aerial = { file, bounds }`. This becomes the ground texture for the
// ENTIRE course, so surfaces (greens / sand / bunkers / paths) read as the real
// photo over the 1 m relief instead of a smooth green sheet.
//
// Source: USGS NAIPPlus (public domain) — mosaics High-Resolution Orthoimagery
// (~0.3 m over urban areas like Tacoma) over NAIP (0.6 m) elsewhere. 0.3 m is 2x
// sharper than plain NAIP. A full course at 0.3 m exceeds the service's single-
// request pixel cap, so the bbox is TILED and mosaicked with sharp. Falls back to
// a single NAIP 0.6 m request if a tile fails.
//
// Registration is linear: tiles are requested in EPSG:4326 over the course's
// lat/lon bbox, which maps 1:1 to the course's equirectangular local metres (same
// frame parseOsm uses), so local bounds == the image extent.
//
// Aerial is non-fingerprinted scenery (not in canonicalCourse), like buildings /
// elevation.patches — safe to attach to a course that already has an HD bundle.
//
//   node tools/add-course-aerial.mjs data/courses/<slug>.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const file = process.argv[2];
if (!file) { console.error('usage: node tools/add-course-aerial.mjs <course.json>'); process.exit(1); }
const course = JSON.parse(fs.readFileSync(file, 'utf8'));
const { lat: lat0, lon: lon0 } = course.origin;
const mPerLat = 111132.95;
const mPerLon = 111319.49 * Math.cos((lat0 * Math.PI) / 180);

let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const eat = (pts) => { for (const [x, y] of pts || []) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
for (const s of course.surfaces || []) eat(s.poly);
for (const h of course.holes || []) eat(h.line);
if (course.boundary) eat(course.boundary);
const pad = 60;
minX -= pad; minY -= pad; maxX += pad; maxY += pad;

const PLUS = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage';
const NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
const GSD_M = 0.3;     // NAIPPlus HRO native over urban areas
const TILE_M = 1100;   // ~3700 px/tile at 0.3 m — under the exportImage cap (~4100)
const MAX_DIM = 8192;  // texture/GPU ceiling for the mosaic long axis

const wm = maxX - minX, hm = maxY - minY;
// Coarsen gsd only if the course is so large the mosaic would exceed MAX_DIM.
const gsd = Math.max(GSD_M, Math.max(wm, hm) / MAX_DIM);
const W = Math.round(wm / gsd), H = Math.round(hm / gsd);

async function exportTile(base, tx0, ty0, tx1, ty1, pw, ph) {
  const bw = lon0 + tx0 / mPerLon, be = lon0 + tx1 / mPerLon;
  const bs = lat0 + ty0 / mPerLat, bn = lat0 + ty1 / mPerLat;
  const u = `${base}?bbox=${bw},${bs},${be},${bn}&bboxSR=4326&imageSR=4326&size=${pw},${ph}&format=jpgpng&f=image`;
  const r = await fetch(u, { headers: { 'User-Agent': 'Open-Birdie/0.8 (course aerial)' } });
  if (!r.ok) throw new Error(`exportImage HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length < 2000 || !(b[0] === 0xff || b[0] === 0x89)) throw new Error(`bad image (len ${b.length})`);
  return sharp(b).resize(pw, ph, { fit: 'fill' }).toBuffer(); // snap to exact tile px so the mosaic aligns
}

let composites = [];
let provider = `NAIPPlus ${gsd.toFixed(2)}m`;
try {
  for (let ty = minY; ty < maxY - 1e-6; ty += TILE_M) {
    for (let tx = minX; tx < maxX - 1e-6; tx += TILE_M) {
      const tx1 = Math.min(tx + TILE_M, maxX), ty1 = Math.min(ty + TILE_M, maxY);
      const pw = Math.max(1, Math.round((tx1 - tx) / gsd)), ph = Math.max(1, Math.round((ty1 - ty) / gsd));
      const left = Math.round((tx - minX) / gsd);
      const top = Math.round((maxY - ty1) / gsd); // image row 0 = north = maxY
      composites.push({ input: await exportTile(PLUS, tx, ty, tx1, ty1, pw, ph), left, top });
    }
  }
} catch (err) {
  console.error(`tiled NAIPPlus failed (${err.message}) — falling back to single NAIP 0.6 m`);
  const sc = Math.min(1 / 0.6, 4000 / Math.max(wm, hm));
  const fw = Math.round(wm * sc), fh = Math.round(hm * sc);
  const buf = await exportTile(NAIP, minX, minY, maxX, maxY, fw, fh);
  composites = [{ input: await sharp(buf).resize(W, H, { fit: 'fill' }).toBuffer(), left: 0, top: 0 }];
  provider = 'NAIP 0.6m (fallback)';
}

const mosaic = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 70, g: 95, b: 65 } } })
  .composite(composites).jpeg({ quality: 88 }).toBuffer();

const slug = path.basename(file).replace(/\.json$/i, '');
const aerialName = `${slug}.aerial.jpg`;
fs.writeFileSync(path.join(path.dirname(file), aerialName), mosaic);

course.aerial = { file: aerialName, bounds: { minX: +minX.toFixed(2), minY: +minY.toFixed(2), maxX: +maxX.toFixed(2), maxY: +maxY.toFixed(2) } };
fs.writeFileSync(file, JSON.stringify(course));
console.log(`saved ${aerialName} (${W}x${H}, ${(mosaic.length / 1024 | 0)} KB, ${provider}) covering ${wm.toFixed(0)}x${hm.toFixed(0)} m @ ${gsd.toFixed(2)} m/px`);
console.log(`course.aerial.bounds = ${JSON.stringify(course.aerial.bounds)}`);
