// Fetch ONE course-wide aerial (USGS NAIP, public domain) covering the whole
// course and attach it as `course.aerial = { file, bounds }`. This becomes the
// ground texture for the ENTIRE course so the HD hole stops looking like a lone
// photographic tile on green felt — everything is the real photo, the HD hole is
// just a sharper-relief region within it.
//
// Registration is linear: the image is requested for the course's lat/lon bbox in
// EPSG:4326, which maps 1:1 to the course's equirectangular local metres (same
// frame parseOsm uses), so local bounds == the image extent.
//
// Aerial is non-fingerprinted scenery (not in canonicalCourse), like buildings /
// elevation.patches — safe to attach to a course that already has an HD bundle.
//
//   node tools/add-course-aerial.mjs data/courses/<slug>.json
import fs from 'node:fs';
import path from 'node:path';

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
const w = lon0 + minX / mPerLon, e = lon0 + maxX / mPerLon, s = lat0 + minY / mPerLat, n = lat0 + maxY / mPerLat;

const wm = maxX - minX, hm = maxY - minY;
const maxPx = 2048;
const sc = maxPx / Math.max(wm, hm);
const W = Math.round(wm * sc), H = Math.round(hm * sc);

// USGS NAIP ImageServer (public domain). exportImage returns a JPEG for the bbox.
const url = `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage`
  + `?bbox=${w},${s},${e},${n}&bboxSR=4326&imageSR=4326&size=${W},${H}&format=jpgpng&f=image`;

const res = await fetch(url, { headers: { 'User-Agent': 'Open-Birdie/0.8 (course aerial)' } });
if (!res.ok) { console.error(`exportImage HTTP ${res.status}`); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
const isPng = buf[0] === 0x89 && buf[1] === 0x50;
if (buf.length < 2000 || (!isJpg && !isPng)) { console.error('not a valid image', buf.length, buf.slice(0, 16).toString('hex')); process.exit(1); }

const slug = path.basename(file).replace(/\.json$/i, '');
const aerialName = `${slug}.aerial.${isPng ? 'png' : 'jpg'}`;
fs.writeFileSync(path.join(path.dirname(file), aerialName), buf);

course.aerial = { file: aerialName, bounds: { minX: +minX.toFixed(2), minY: +minY.toFixed(2), maxX: +maxX.toFixed(2), maxY: +maxY.toFixed(2) } };
fs.writeFileSync(file, JSON.stringify(course));
console.log(`saved ${aerialName} (${W}x${H}, ${(buf.length / 1024 | 0)} KB) covering ${wm.toFixed(0)}x${hm.toFixed(0)} m`);
console.log(`course.aerial.bounds = ${JSON.stringify(course.aerial.bounds)}`);