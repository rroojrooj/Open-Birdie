'use strict';
// High-resolution elevation patches from the USGS 3DEP dynamic ImageServer.
//   https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer
// Coverage: United States, no API key. Multi-resolution: serves ~1 m DEM where
// it has been flown (greens read true), coarser where it hasn't. Decoded with
// ZERO new dependencies — the service's "bsq" export is a plain little-endian
// float32 raster; dimensions + geographic extent come from a tiny f=json call.
//
// Outside the US, over water, or on ANY failure, fetchPatch returns null and the
// caller (lib/elevation.js) keeps the terrarium base grid. LIDAR is an
// enhancement layered on greens/landing zones, never a hard dependency.

const EXPORT =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
const UA = 'Open-Birdie/0.1 (open-source golf sim; personal use)';
const REQ_TIMEOUT = 12000; // ms — a hung/slow 3DEP request must never stall course load

// Web Mercator (EPSG:3857) — patches are requested + returned in this SR so the
// raster is a regular projected grid the caller samples by mercator x/y.
const R = 6378137;
const lonToMerc = (lon) => (lon * Math.PI) / 180 * R;
const latToMerc = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));
const isNoData = (v) => !isFinite(v) || v < -1e30; // 3DEP F32 NoData is ~-3.4e38

function strictErr(code, message) {
  const e = new Error(`download-elevation: ${code}: ${message}`);
  e.code = code;
  e.stage = 'download-elevation';
  return e;
}

/**
 * Strict 3DEP patch fetch: throws a stage-coded Error (`.code`, `.stage`) on ANY
 * problem instead of returning null. Used by the HD compiler, which must fail
 * loudly rather than silently upsample. `fetchImpl` is injectable for offline tests.
 * @returns {Promise<{xmin,ymin,xmax,ymax,width,height,heights:Float32Array,validRatio:number}>}
 *          extent in Web Mercator metres; heights row-major, top-left origin.
 */
async function fetchPatchStrict({ west, south, east, north }, { targetM = 1, maxPx = 600, fetchImpl = fetch } = {}) {
  const wM = Math.abs(lonToMerc(east) - lonToMerc(west));
  const hM = Math.abs(latToMerc(north) - latToMerc(south));
  let w = Math.min(maxPx, Math.max(8, Math.round(wM / targetM)));
  let h = Math.min(maxPx, Math.max(8, Math.round(hM / targetM)));
  const q = (f) =>
    `${EXPORT}?bbox=${west},${south},${east},${north}&bboxSR=4326&size=${w},${h}` +
    `&imageSR=3857&format=bsq&pixelType=F32&interpolation=RSP_BilinearInterpolation&${f}`;

  // 1) metadata — the service snaps to pixel bounds, so trust its width/height/extent
  let meta;
  try {
    const r = await fetchImpl(q('f=json'), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(REQ_TIMEOUT) });
    if (!r.ok) throw strictErr('HD_3DEP_META', `metadata HTTP ${r.status}`);
    meta = await r.json();
  } catch (e) {
    throw e.code ? e : strictErr('HD_3DEP_META', `metadata fetch failed: ${e.message}`);
  }
  if (!meta || !meta.width || !meta.height || !meta.extent) throw strictErr('HD_3DEP_META', 'missing width/height/extent');
  w = meta.width; h = meta.height;
  const e = meta.extent;

  // 2) raw float32 raster (bsq single band = flat row-major float32)
  let buf;
  try {
    const res = await fetchImpl(q('f=image'), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(REQ_TIMEOUT) });
    if (!res.ok) throw strictErr('HD_3DEP_HTTP', `image HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (er) {
    throw er.code ? er : strictErr('HD_3DEP_HTTP', `image fetch failed: ${er.message}`);
  }
  if (buf.length < w * h * 4) throw strictErr('HD_3DEP_TRUNCATED', `payload ${buf.length} < ${w * h * 4}`);

  const heights = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) heights[i] = buf.readFloatLE(i * 4);

  let valid = 0;
  for (let i = 0; i < heights.length; i++) if (!isNoData(heights[i])) valid++;
  if (valid === 0) throw strictErr('HD_3DEP_NODATA', 'patch is entirely NoData');

  return { xmin: e.xmin, ymin: e.ymin, xmax: e.xmax, ymax: e.ymax, width: w, height: h, heights, validRatio: valid / heights.length };
}

/**
 * Best-effort 3DEP fetch (unchanged contract): returns null on ANY failure so a
 * slow or absent 3DEP never stalls gameplay course-load. Wraps fetchPatchStrict.
 */
async function fetchPatch(bbox, opts = {}) {
  try { return await fetchPatchStrict(bbox, opts); }
  catch (_) { return null; }
}

/**
 * Bilinear sampler over a patch. Takes Web Mercator x/y (matching patch.extent).
 * Returns elevation in metres, or null when outside the patch or over NoData.
 * Pure + synchronous (unit-testable without network).
 */
function makePatchSampler(patch) {
  const { xmin, ymin, xmax, ymax, width, height, heights } = patch;
  return function sample(mx, my) {
    if (mx < xmin || mx > xmax || my < ymin || my > ymax) return null;
    const fx = ((mx - xmin) / (xmax - xmin)) * (width - 1);
    const fy = ((ymax - my) / (ymax - ymin)) * (height - 1); // row 0 = top = ymax
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
    const dx = fx - x0, dy = fy - y0;
    const at = (x, y) => heights[y * width + x];
    const h00 = at(x0, y0), h10 = at(x1, y0), h01 = at(x0, y1), h11 = at(x1, y1);
    if (isNoData(h00) || isNoData(h10) || isNoData(h01) || isNoData(h11)) return null;
    return h00 * (1 - dx) * (1 - dy) + h10 * dx * (1 - dy) +
           h01 * (1 - dx) * dy + h11 * dx * dy;
  };
}

module.exports = { fetchPatch, fetchPatchStrict, makePatchSampler, lonToMerc, latToMerc };
