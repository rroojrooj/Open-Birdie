'use strict';
// Loads real golf courses from OpenStreetMap (open data).
//  - Nominatim: free geocoder, finds the course by name
//  - Overpass API: fetches golf features (tees, fairways, greens, bunkers,
//    water, hole routing lines) inside the course bounding box
// Results are cached to data/courses/*.json so a course is fetched once.

const fs = require('fs');
const path = require('path');
const { fetchElevationGrid } = require('./elevation');

const UA = 'Open-Birdie/0.1 (open-source golf sim; personal use)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const CACHE_DIR = path.join(__dirname, '..', 'data', 'courses');
const CACHE_VERSION = 2;

async function nominatim(query) {
  const url = `${NOMINATIM}?format=jsonv2&limit=8&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = await res.json();
  return rows.map((r) => ({
    name: r.display_name,
    type: r.type,
    osmType: r.osm_type,
    osmId: r.osm_id,
    bbox: r.boundingbox.map(Number), // [south, north, west, east]
    lat: +r.lat, lon: +r.lon,
  }));
}

async function searchCourses(query) {
  let rows = await nominatim(query);
  // we want actual golf_course objects, not clubhouses/starter huts/restaurants
  if (!rows.some((r) => r.type === 'golf_course') && !/golf/i.test(query)) {
    await new Promise((s) => setTimeout(s, 1100)); // Nominatim rate limit: 1 req/s
    const extra = await nominatim(query + ' golf course');
    const seen = new Set(rows.map((r) => r.osmType + r.osmId));
    rows = rows.concat(extra.filter((r) => !seen.has(r.osmType + r.osmId)));
  }
  rows.sort((a, b) => (b.type === 'golf_course') - (a.type === 'golf_course'));
  return rows;
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

const FEATURES = (filter) => `
  way["golf"](${filter});
  relation["golf"](${filter});
  way["natural"="water"](${filter});
  way["natural"="sand"](${filter});
  way["leisure"="golf_course"](${filter});
  relation["leisure"="golf_course"](${filter});
  node["natural"="tree"](${filter});
  way["natural"="wood"](${filter});
  relation["natural"="wood"](${filter});
  way["landuse"="forest"](${filter});`;

async function overpass(q) {
  let lastErr = null;
  for (let round = 0; round < 2; round++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q),
        });
        if (res.ok) return await res.json();
        lastErr = new Error(`Overpass ${res.status} at ${new URL(endpoint).host}`);
        // 429/504 = busy mirror, try the next one; other codes likely a bad query
        if (res.status !== 429 && res.status !== 504 && res.status !== 502) {
          throw new Error(`${lastErr.message}: ${(await res.text()).slice(0, 200)}`);
        }
      } catch (err) {
        if (err.message.startsWith('Overpass') && !/429|504|502/.test(err.message)) throw err;
        lastErr = err;
      }
    }
    await new Promise((s) => setTimeout(s, 2500));
  }
  throw lastErr || new Error('Overpass: all mirrors failed');
}

async function loadCourse({ name, bbox, osmType, osmId }) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, slug(name) + '.json');
  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (cached.version === CACHE_VERSION) return cached;
  }

  // The course's own OSM polygon is the ground truth: hole routings are taken
  // strictly inside it (poly filter), so adjacent courses on shared land
  // (e.g. St Andrews Links) don't leak in. Surfaces/trees come from the padded
  // bbox so neighboring fairways still render as scenery.
  let outline = null;
  if (osmId && (osmType === 'way' || osmType === 'relation')) {
    try { outline = await fetchCourseOutline(osmType, osmId); }
    catch (err) { console.error('[course] outline fetch failed:', err.message); }
  }

  const padLat = 0.002, padLon = 0.003;
  let s, n, w, e;
  if (outline) {
    const lats = outline.map((g) => g.lat), lons = outline.map((g) => g.lon);
    s = Math.min(...lats) - padLat; n = Math.max(...lats) + padLat;
    w = Math.min(...lons) - padLon; e = Math.max(...lons) + padLon;
  } else if (bbox) {
    s = bbox[0] - padLat; n = bbox[1] + padLat; w = bbox[2] - padLon; e = bbox[3] + padLon;
  } else {
    throw new Error('course not found (no outline and no bounding box)');
  }
  const osm = await overpass(`[out:json][timeout:90];\n(${FEATURES(`${s},${w},${n},${e}`)}\n);\nout tags geom;`);

  if (outline) {
    const step = Math.ceil(outline.length / 150);
    const polyStr = outline.filter((_, i) => i % step === 0).map((g) => `${g.lat} ${g.lon}`).join(' ');
    try {
      const inPoly = await overpass(`[out:json][timeout:60];way["golf"="hole"](poly:"${polyStr}");out tags geom;`);
      if (inPoly.elements.length) {
        osm.elements = osm.elements
          .filter((el) => (el.tags || {}).golf !== 'hole')
          .concat(inPoly.elements);
      }
    } catch (err) {
      console.error('[course] poly hole query failed, keeping bbox holes:', err.message);
    }
  }

  const course = parseOsm(osm, name, outline);

  // real elevation (best effort — flat terrain if the fetch fails)
  try {
    const b = courseBounds(course);
    const mPerLat = 111132.95;
    const mPerLon = 111319.49 * Math.cos(course.origin.lat * Math.PI / 180);
    course.elevation = await fetchElevationGrid({
      lat0: course.origin.lat, lon0: course.origin.lon, mPerLat, mPerLon, ...b,
    });
  } catch (err) {
    console.error('[elevation] falling back to flat terrain:', err.message);
    course.elevation = null;
  }

  fs.writeFileSync(cacheFile, JSON.stringify(course));
  return course;
}

async function fetchCourseOutline(osmType, osmId) {
  const r = await overpass(`[out:json];${osmType}(${osmId});out tags geom;`);
  const el = r.elements && r.elements[0];
  if (!el) return null;
  let ring = null;
  if (el.type === 'way') ring = el.geometry;
  else if (el.type === 'relation') {
    let bestLen = 0;
    for (const m of el.members || []) {
      if ((m.role === 'outer' || !m.role) && m.geometry && m.geometry.length > bestLen) {
        bestLen = m.geometry.length; ring = m.geometry;
      }
    }
  }
  return ring && ring.length >= 4 ? ring : null;
}

function courseBounds(course) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (pts) => {
    for (const [x, y] of pts || []) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  };
  for (const s of course.surfaces) eat(s.poly);
  for (const h of course.holes) eat(h.line);
  eat(course.boundary);
  if (!isFinite(minX)) throw new Error('no geometry for bounds');
  return { minX, minY, maxX, maxY };
}

function parseOsm(osm, name, outline) {
  // collect every coordinate to find the projection origin
  const allCoords = [];
  const collect = (geom) => { for (const g of geom || []) allCoords.push(g); };
  for (const el of osm.elements) {
    if (el.type === 'way') collect(el.geometry);
    else if (el.type === 'relation') for (const m of el.members || []) collect(m.geometry);
  }
  if (!allCoords.length) throw new Error('No OSM data found in this area.');
  let lat0 = 0, lon0 = 0;
  for (const c of allCoords) { lat0 += c.lat; lon0 += c.lon; }
  lat0 /= allCoords.length; lon0 /= allCoords.length;

  const mPerLat = 111132.95;
  const mPerLon = 111319.49 * Math.cos(lat0 * Math.PI / 180);
  const proj = (c) => [
    +((c.lon - lon0) * mPerLon).toFixed(2),
    +((c.lat - lat0) * mPerLat).toFixed(2),
  ];

  const surfaces = [];   // {kind, poly: [[x,y],...]}
  const holeLines = [];  // {ref, par, name, line: [[x,y],...]}
  const trees = [];      // individual trees: [x,y]
  const woods = [];      // wooded-area polygons
  let boundary = outline ? outline.map(proj) : null;

  const addPoly = (kind, geometry) => {
    if (!geometry || geometry.length < 3) return;
    surfaces.push({ kind, poly: geometry.map(proj) });
  };

  const kindOf = (tags) => {
    const g = tags.golf;
    if (g === 'green') return 'green';
    if (g === 'tee') return 'tee';
    if (g === 'fairway') return 'fairway';
    if (g === 'bunker' || tags.natural === 'sand') return 'bunker';
    if (g === 'rough' || g === 'semi_rough') return 'rough';
    if (g === 'water_hazard' || g === 'lateral_water_hazard' || tags.natural === 'water') return 'water';
    if (g === 'driving_range') return 'range';
    return null;
  };

  const isWood = (tags) => tags.natural === 'wood' || tags.landuse === 'forest';

  for (const el of osm.elements) {
    const tags = el.tags || {};
    if (el.type === 'node') {
      if (tags.natural === 'tree' && el.lat != null) trees.push(proj(el));
    } else if (el.type === 'way') {
      if (isWood(tags)) {
        if ((el.geometry || []).length >= 3) woods.push(el.geometry.map(proj));
      } else if (tags.golf === 'hole') {
        holeLines.push({
          ref: parseInt(tags.ref, 10) || null,
          par: parseInt(tags.par, 10) || null,
          name: tags.name || null,
          line: (el.geometry || []).map(proj),
        });
      } else if (tags.leisure === 'golf_course') {
        if (!boundary) boundary = (el.geometry || []).map(proj);
      } else {
        const k = kindOf(tags);
        if (k) addPoly(k, el.geometry);
      }
    } else if (el.type === 'relation') {
      const k = tags.leisure === 'golf_course' ? 'boundary' : isWood(tags) ? 'wood' : kindOf(tags);
      if (!k) continue;
      for (const m of el.members || []) {
        if (m.role === 'outer' || !m.role) {
          if (k === 'boundary') { if (!boundary) boundary = (m.geometry || []).map(proj); }
          else if (k === 'wood') { if ((m.geometry || []).length >= 3) woods.push(m.geometry.map(proj)); }
          else addPoly(k, m.geometry);
        }
      }
    }
  }

  if (!holeLines.length) {
    const kinds = [...new Set(surfaces.map((s) => s.kind))].join(', ') || 'none';
    throw new Error(
      `This course has no hole routing lines (golf=hole) mapped in OpenStreetMap, so it isn't playable. ` +
      `Features found: ${kinds}. Try another course (St Andrews, Pebble Beach, and most famous courses are fully mapped).`
    );
  }

  // Build playable holes: tee = line start, pin = line end (snapped to its green)
  const greens = surfaces.filter((s) => s.kind === 'green');
  const holes = selectRound(holeLines.filter((h) => h.line.length >= 2))
    .map((h) => {
      const tee = h.line[0];
      let pin = h.line[h.line.length - 1];
      // keep the mapped pin if it already sits on a green (handles double
      // greens, where the shared green's centroid would be the wrong spot)
      const onGreen = greens.some((g) => pointInPoly(pin[0], pin[1], g.poly));
      if (!onGreen) {
        let best = null, bestD = 80 * 80;
        for (const g of greens) {
          const c = centroid(g.poly);
          const d = (c[0] - pin[0]) ** 2 + (c[1] - pin[1]) ** 2;
          if (d < bestD) { bestD = d; best = c; }
        }
        if (best) pin = best;
      }
      const lenM = polylineLen(h.line);
      const lenYd = lenM / 0.9144;
      const par = h.par || (lenYd < 250 ? 3 : lenYd < 471 ? 4 : 5);
      return { ref: h.ref, par, name: h.name, tee, pin, line: h.line, lengthYd: Math.round(lenYd) };
    });

  return { version: CACHE_VERSION, name, origin: { lat: lat0, lon: lon0 }, surfaces, boundary, holes, trees, woods };
}

// When an area contains several courses (e.g. St Andrews Links), the fetch
// returns holes from all of them, with duplicate ref numbers. A real round
// chains together: hole N's tee is a short walk from hole N-1's green. Pick,
// per ref, the candidate that minimizes total green->next-tee distance.
function selectRound(holeLines) {
  const byRef = new Map();
  for (const h of holeLines) {
    const r = h.ref || 0;
    if (!byRef.has(r)) byRef.set(r, []);
    byRef.get(r).push(h);
  }
  const refs = [...byRef.keys()].filter((r) => r > 0).sort((a, b) => a - b);
  if (!refs.length) return holeLines;                    // unnumbered: keep all
  if (refs.every((r) => byRef.get(r).length === 1)) {    // one course: trivial
    return refs.map((r) => byRef.get(r)[0]);
  }
  let best = null, bestCost = Infinity;
  for (const start of byRef.get(refs[0])) {
    const chain = [start];
    let cost = 0, cur = start;
    for (let i = 1; i < refs.length; i++) {
      const end = cur.line[cur.line.length - 1];
      let pick = null, pd = Infinity;
      for (const c of byRef.get(refs[i])) {
        const d = Math.hypot(c.line[0][0] - end[0], c.line[0][1] - end[1]);
        if (d < pd) { pd = d; pick = c; }
      }
      chain.push(pick); cost += pd; cur = pick;
    }
    if (cost < bestCost) { bestCost = cost; best = chain; }
  }
  return best;
}

function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

function polylineLen(line) {
  let d = 0;
  for (let i = 1; i < line.length; i++) {
    d += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  return d;
}

// point-in-polygon (ray cast)
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Surface lookup with priority: water > bunker > green > tee > fairway > rough
const PRIORITY = ['water', 'bunker', 'green', 'tee', 'fairway'];
function makeSurfaceLookup(course) {
  const byKind = {};
  for (const s of course.surfaces) (byKind[s.kind] ||= []).push(s.poly);
  return (x, y) => {
    for (const kind of PRIORITY) {
      for (const poly of byKind[kind] || []) {
        if (pointInPoly(x, y, poly)) return kind;
      }
    }
    if (course.boundary && !pointInPoly(x, y, course.boundary)) return 'ob';
    return 'rough';
  };
}

function listCached() {
  if (!fs.existsSync(CACHE_DIR)) return [];
  return fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    try { return { file: f, name: JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8')).name }; }
    catch (_) { return null; }
  }).filter(Boolean);
}

function loadCached(file) {
  return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, path.basename(file)), 'utf8'));
}

module.exports = { searchCourses, loadCourse, makeSurfaceLookup, pointInPoly, listCached, loadCached };
