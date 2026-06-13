'use strict';
// Dev check: search a course on Nominatim, load it via Overpass + terrain tiles,
// print a summary. Usage: node tools/test-load.js "Old Course St Andrews"
const { searchCourses, loadCourse, makeSurfaceLookup } = require('../lib/course');
const { makeTerrain, flatTerrain } = require('../lib/elevation');

(async () => {
  const query = process.argv[2] || 'St Andrews Old Course';
  console.log(`searching: ${query}`);
  const results = await searchCourses(query);
  for (const r of results.slice(0, 5)) console.log(`  - [${r.osmType}/${r.type}] ${r.name}`);
  if (!results.length) throw new Error('no results');
  const pick = results.find((r) => r.type === 'golf_course') || results[0];
  console.log(`loading: ${pick.name}`);

  const t0 = Date.now();
  const course = await loadCourse({ name: query, bbox: pick.bbox, osmType: pick.osmType, osmId: pick.osmId });
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`holes: ${course.holes.length}`);
  for (const h of course.holes.slice(0, 18)) {
    console.log(`  #${h.ref ?? '?'} par ${h.par} ${h.lengthYd} yd`);
  }
  const kinds = {};
  for (const s of course.surfaces) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
  console.log('surfaces:', kinds);
  console.log(`trees: ${course.trees.length}, woods: ${course.woods.length}, boundary: ${course.boundary ? 'yes' : 'no'}`);

  if (course.elevation) {
    const g = course.elevation;
    console.log(`elevation grid: ${g.nx}x${g.ny} @ ${g.cellM}m, base ${g.baseM}m ASL`);
    const terrain = makeTerrain(g);
    const h1 = course.holes[0];
    console.log(`  h(tee1)=${terrain.h(h1.tee[0], h1.tee[1]).toFixed(1)}m  h(pin1)=${terrain.h(h1.pin[0], h1.pin[1]).toFixed(1)}m (relative)`);
    let min = Infinity, max = -Infinity;
    for (const v of g.heights) { if (v < min) min = v; if (v > max) max = v; }
    console.log(`  height range across course: ${min.toFixed(1)} .. ${max.toFixed(1)} m`);
  } else {
    console.log('elevation: NONE (flat fallback)');
  }

  const surfaceAt = makeSurfaceLookup(course);
  const h1 = course.holes[0];
  console.log(`surface at tee1: ${surfaceAt(h1.tee[0], h1.tee[1])}, at pin1: ${surfaceAt(h1.pin[0], h1.pin[1])}`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
