'use strict';
// Course-wide aerial photo from USGS NAIPPlus (mosaics High-Resolution
// Orthoimagery ~0.3 m over urban areas, NAIP 0.6 m elsewhere — public domain).
//
// Runtime-safe: ONE exportImage request (no tiling, no image deps), so it can run
// on every course load inside the packaged Electron app where the zero-runtime-dep
// rule holds. A single request caps at maxPx (4000 px — the service rejects >=4096
// with a 400), giving true 0.3 m up to ~1.2 km courses and coarsening to ~0.45 m for
// a ~1.8 km course. The tiled max-quality 0.3 m mosaic stays in the dev-only
// tools/add-course-aerial.mjs (which uses sharp).
//
// Returns the raw JPEG/PNG buffer + the padded local-meter bounds the image
// covers, or null on ANY failure / non-US (NAIPPlus returns a tiny error blob over
// no-data) — the caller falls back to procedural turf, never breaking course load.

const EXPORT = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage';
const UA = 'Open-Birdie/0.1 (open-source golf sim; personal use)';
const PAD_M = 60; // match tools/add-course-aerial.mjs so manual + auto register identically

async function fetchCourseAerial({ origin, bounds, fetchImpl = fetch, gsdM = 0.3, maxPx = 4000 } = {}) {
  const lat0 = origin.lat, lon0 = origin.lon;
  const mPerLat = 111132.95, mPerLon = 111319.49 * Math.cos((lat0 * Math.PI) / 180);
  const minX = bounds.minX - PAD_M, minY = bounds.minY - PAD_M, maxX = bounds.maxX + PAD_M, maxY = bounds.maxY + PAD_M;
  const w = lon0 + minX / mPerLon, e = lon0 + maxX / mPerLon, s = lat0 + minY / mPerLat, n = lat0 + maxY / mPerLat;
  const wm = maxX - minX, hm = maxY - minY;
  const sc = Math.min(1 / gsdM, maxPx / Math.max(wm, hm)); // native 0.3 m, capped at maxPx on the long axis
  const W = Math.round(wm * sc), H = Math.round(hm * sc);
  const url = `${EXPORT}?bbox=${w},${s},${e},${n}&bboxSR=4326&imageSR=4326&size=${W},${H}&format=jpgpng&f=image`;

  let buf;
  try {
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA } });
    if (!r || !r.ok) return null;
    buf = Buffer.from(await r.arrayBuffer());
  } catch (_) {
    return null;
  }
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  if (buf.length < 2000 || (!isJpg && !isPng)) return null; // error blob / no-data
  return {
    buf,
    bounds: { minX: +minX.toFixed(2), minY: +minY.toFixed(2), maxX: +maxX.toFixed(2), maxY: +maxY.toFixed(2) },
  };
}

module.exports = { fetchCourseAerial };
