// Shared coordinate transforms for the HD compiler.
//
// Local metres use the SAME equirectangular convention as the runtime
// (lib/course.js): x = east, y = north, anchored at the course origin. WGS84 <->
// UTM goes through proj4 (NAIP imagery at Bandon is EPSG:26910, UTM zone 10N).
// Web Mercator helpers match lib/lidar.js (3DEP is served in EPSG:3857).

import proj4 from 'proj4';
import { HdCompileError } from './errors.mjs';

const M_PER_LAT = 111132.95;
const mPerLon = (lat0) => 111319.49 * Math.cos((lat0 * Math.PI) / 180);
const R = 6378137; // WGS84 radius, matching lib/lidar.js

// EPSG:4326 / EPSG:3857 ship with proj4; register NAIP UTM zones on demand so any
// US course works, not just Bandon (zone 10N). NAIP is NAD83 UTM (EPSG:269ZZ, north
// zones 1-23 cover CONUS); also accept WGS84 UTM north (EPSG:326ZZ).
function ensureUtmZone(epsg) {
  if (proj4.defs(epsg)) return true;
  let m = /^EPSG:269(\d{2})$/.exec(epsg);
  if (m && +m[1] >= 1 && +m[1] <= 23) { proj4.defs(epsg, `+proj=utm +zone=${+m[1]} +datum=NAD83 +units=m +no_defs`); return true; }
  m = /^EPSG:326(\d{2})$/.exec(epsg);
  if (m && +m[1] >= 1 && +m[1] <= 60) { proj4.defs(epsg, `+proj=utm +zone=${+m[1]} +datum=WGS84 +units=m +no_defs`); return true; }
  return false;
}

function assertFinite(...vals) {
  for (const v of vals) {
    if (!Number.isFinite(v)) throw new HdCompileError('reproject', 'HD_COORD_NONFINITE', { v: String(v) });
  }
}

export function localToWgs84({ x, y }, origin) {
  assertFinite(x, y, origin.lat, origin.lon);
  return { lat: origin.lat + y / M_PER_LAT, lon: origin.lon + x / mPerLon(origin.lat) };
}

export function wgs84ToLocal({ lat, lon }, origin) {
  assertFinite(lat, lon, origin.lat, origin.lon);
  return { x: (lon - origin.lon) * mPerLon(origin.lat), y: (lat - origin.lat) * M_PER_LAT };
}

export function wgs84ToUtm({ lat, lon }, epsg) {
  assertFinite(lat, lon);
  if (!ensureUtmZone(epsg)) throw new HdCompileError('reproject', 'HD_CRS_UNKNOWN', { epsg });
  const [x, y] = proj4('EPSG:4326', epsg, [lon, lat]);
  return { x, y };
}

export function utmToWgs84({ x, y }, epsg) {
  assertFinite(x, y);
  if (!ensureUtmZone(epsg)) throw new HdCompileError('reproject', 'HD_CRS_UNKNOWN', { epsg });
  const [lon, lat] = proj4(epsg, 'EPSG:4326', [x, y]);
  return { lat, lon };
}

export const lonToMerc = (lon) => ((lon * Math.PI) / 180) * R;
export const latToMerc = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));

export const constants = { M_PER_LAT, mPerLon, R };
