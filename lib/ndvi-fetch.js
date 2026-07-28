'use strict';
// Runtime NDVI band fetch from USGS NAIPPlus (4-band imagery: R,G,B,NIR — public
// domain). Feeds surface classification (tools/trace/segment.mjs); the classify
// raster only needs to gate surfaces, so sub-metre detail is wasted and we cap at
// NDVI_MAXPX. Two co-registered exportImage requests (same bbox/size/SR) come back
// pixel-exact: one delivers R,G,B and one delivers NIR, decoded with pngjs and
// interleaved to [R,G,B,NIR] per pixel.
//
// MANDATORY format=png (not jpgpng): jpgpng returns lossy JPEG that pngjs cannot
// decode and that corrupts NIR values. This deliberately differs from lib/aerial.js
// (visible drape), which may accept jpgpng.
//
// Best-effort: returns null on ANY failure / non-US (NAIPPlus returns a tiny error
// blob over no-data) so the caller simply skips the classmap and never breaks
// course load. Mirrors lib/aerial.js for the bbox/size math and body guards.

const { PNG } = require('pngjs');
const { isAbortError, throwIfAborted } = require('./abort');

const EXPORT = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage';
const UA = 'Open-Birdie/0.1 (open-source golf sim; personal use)';
const PAD_M = 60; // match lib/aerial.js so the classify raster registers with the drape
const NDVI_MAXPX = 768; // classify gate only; sub-metre wasted
const GSD_M = 0.3; // native NAIP resolution; NDVI_MAXPX dominates for any real course
const MIN_BYTES = 2000; // USGS error blobs over no-data are tiny

function exportUrl(w, s, e, n, W, H, bandIds) {
  return `${EXPORT}?bbox=${w},${s},${e},${n}&bboxSR=4326&imageSR=4326&size=${W},${H}&bandIds=${bandIds}&format=png&f=image`;
}

// Fetch + guard + decode one exportImage PNG. Returns the pngjs image or null.
async function fetchPng(url, fetchImpl, signal) {
  let buf;
  try {
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal });
    if (!r || !r.ok) return null;
    buf = Buffer.from(await r.arrayBuffer());
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    return null;
  }
  throwIfAborted(signal);
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  if (buf.length < MIN_BYTES || !isPng) return null; // error blob / no-data / wrong format
  try {
    return PNG.sync.read(buf); // normalizes to 8-bit RGBA in .data
  } catch (_) {
    return null;
  }
}

async function fetchNdviBands({
  origin,
  bounds,
  fetchImpl = fetch,
  signal,
  maxPx = NDVI_MAXPX,
} = {}) {
  throwIfAborted(signal);
  const lat0 = origin.lat, lon0 = origin.lon;
  const mPerLat = 111132.95, mPerLon = 111319.49 * Math.cos((lat0 * Math.PI) / 180);
  const minX = bounds.minX - PAD_M, minY = bounds.minY - PAD_M, maxX = bounds.maxX + PAD_M, maxY = bounds.maxY + PAD_M;
  const w = lon0 + minX / mPerLon, e = lon0 + maxX / mPerLon, s = lat0 + minY / mPerLat, n = lat0 + maxY / mPerLat;
  const wm = maxX - minX, hm = maxY - minY;
  const sc = Math.min(1 / GSD_M, maxPx / Math.max(wm, hm)); // native 0.3 m, capped at maxPx on the long axis
  const W = Math.round(wm * sc), H = Math.round(hm * sc);

  const [rgb, nir] = await Promise.all([
    fetchPng(exportUrl(w, s, e, n, W, H, '0,1,2'), fetchImpl, signal),
    fetchPng(exportUrl(w, s, e, n, W, H, '3,0,1'), fetchImpl, signal),
  ]);
  throwIfAborted(signal);
  if (!rgb || !nir) return null;
  if (rgb.width !== nir.width || rgb.height !== nir.height) return null;

  const width = rgb.width, height = rgb.height, px = width * height;
  const bands = new Uint8ClampedArray(px * 4);
  const rd = rgb.data, nd = nir.data; // both [R,G,B,A,...]; NIR fetch decodes as [NIR,R,G,A,...]
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    bands[o] = rd[o];         // R  (RGB fetch ch0)
    bands[o + 1] = rd[o + 1]; // G  (RGB fetch ch1)
    bands[o + 2] = rd[o + 2]; // B  (RGB fetch ch2)
    bands[o + 3] = nd[o];     // NIR (NIR fetch ch0; alpha is a constant 255, ignored)
  }
  return { bands, width, height };
}

module.exports = { fetchNdviBands, NDVI_MAXPX };
