// Fetch OSM building footprints for an already-cached course and attach them as
// `course.buildings` (footprint polygon in local metres + estimated height +
// clubhouse flag). Buildings are a NON-fingerprinted scenery layer (not in
// canonicalCourse, like elevation.patches), so this is safe to run on a course
// that already has a built HD bundle — the fingerprint is unchanged.
//
//   node tools/add-buildings.mjs data/courses/<slug>.json
import fs from 'node:fs';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const file = process.argv[2];
if (!file) { console.error('usage: node tools/add-buildings.mjs <course.json>'); process.exit(1); }
const course = JSON.parse(fs.readFileSync(file, 'utf8'));
const { lat: lat0, lon: lon0 } = course.origin;
const mPerLat = 111132.95;
const mPerLon = 111319.49 * Math.cos((lat0 * Math.PI) / 180);

// local-metre extent of the course -> padded lat/lon bbox
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const eat = (pts) => { for (const [x, y] of pts || []) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
for (const s of course.surfaces || []) eat(s.poly);
for (const h of course.holes || []) eat(h.line);
if (course.boundary) eat(course.boundary);
const padM = 150;
const toLat = (y) => lat0 + y / mPerLat;
const toLon = (x) => lon0 + x / mPerLon;
const s = toLat(minY - padM), n = toLat(maxY + padM), w = toLon(minX - padM), e = toLon(maxX + padM);

const q = `[out:json][timeout:90];(way["building"](${s},${w},${n},${e});relation["building"](${s},${w},${n},${e}););out tags geom;`;

async function overpass(query) {
  let lastErr;
  for (const endpoint of OVERPASS) {
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Open-Birdie/0.8 (buildings)' }, body: 'data=' + encodeURIComponent(query) });
      if (res.ok) return res.json();
      lastErr = new Error(`Overpass ${res.status} @ ${new URL(endpoint).host}`);
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

const proj = (c) => [+((c.lon - lon0) * mPerLon).toFixed(2), +((c.lat - lat0) * mPerLat).toFixed(2)];

const osm = await overpass(q);
const buildings = [];
for (const el of osm.elements || []) {
  const tags = el.tags || {};
  let geom = el.geometry;
  if (!geom && el.members) geom = (el.members.find((m) => m.role === 'outer' || !m.role) || {}).geometry;
  if (!geom || geom.length < 3) continue;
  const levels = parseFloat(tags['building:levels']) || 0;
  const heightTag = parseFloat(tags.height) || 0;
  const bt = (tags.building || '').toLowerCase();
  const clubhouse = bt === 'clubhouse' || tags.golf === 'clubhouse' || tags.amenity === 'clubhouse'
    || /club\s*house|pro\s*shop/i.test(tags.name || '');
  const heightM = heightTag || (levels ? levels * 3.2 : (clubhouse ? 9 : 5));
  buildings.push({
    poly: geom.map(proj),
    heightM: +heightM.toFixed(1),
    kind: bt || 'yes',
    name: tags.name || null,
    clubhouse,
  });
}

// Largest building near the course centre, if nothing is tagged clubhouse, is a
// good hero candidate — promote it so every course gets one "feature" building.
if (buildings.length && !buildings.some((b) => b.clubhouse)) {
  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
  let best = null, bestA = 0;
  for (const b of buildings) { const a = area(b.poly); if (a > bestA) { bestA = a; best = b; } }
  if (best && bestA > 60) { best.clubhouse = true; best.heightM = Math.max(best.heightM, 8); }
}

course.buildings = buildings;
fs.writeFileSync(file, JSON.stringify(course));
const ch = buildings.filter((b) => b.clubhouse).length;
console.log(`injected ${buildings.length} buildings (${ch} hero/clubhouse) into ${file}`);
for (const b of buildings.filter((x) => x.clubhouse).slice(0, 4)) console.log(`  hero: ${b.name || b.kind} ~${b.heightM}m, ${b.poly.length}pts`);