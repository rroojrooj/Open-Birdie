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

// Web Mercator (EPSG:3857) — patches are requested + returned in this SR so the
// raster is a regular projected grid the caller samples by mercator x/y.
const R = 6378137;
const lonToMerc = (lon) => (lon * Math.PI) / 180 * R;
const latToMerc = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));
const isNoData = (v) => !isFinite(v) || v < -1e30; // 3DEP F32 NoData is ~-3.4e38

/**
 * Fetch a 3DEP elevation patch covering a lon/lat bbox.
 * @param {{west,south,east,north}} bbox  geographic bounds (degrees)
 * @param {{targetM?:number,maxPx?:number}} opts  targetM = desired ground
 *        sample distance (1 ≈ 1 m LIDAR); maxPx caps each axis.
 * @returns {Promise<null | {xmin,ymin,xmax,ymax,width,height,heights:Float32Array}>}
 *          extent in Web Mercator metres; heights row-major, top-left origin.
 */
async function fetchPatch({ west, south, east, north }, { targetM = 1, maxPx = 600 } = {}) {
  try {
    const wM = Math.abs(lonToMerc(east) - lonToMerc(west));
    const hM = Math.abs(latToMerc(north) - latToMerc(south));
    let w = Math.min(maxPx, Math.max(8, Math.round(wM / targetM)));
    let h = Math.min(maxPx, Math.max(8, Math.round(hM / targetM)));
    const q = (f) =>
      `${EXPORT}?bbox=${west},${south},${east},${north}&bboxSR=4326&size=${w},${h}` +
      `&imageSR=3857&format=bsq&pixelType=F32&interpolation=RSP_BilinearInterpolation&${f}`;

    // 1) metadata — the service snaps to pixel bounds, so trust its width/height/extent
    const meta = await (await fetch(q('f=json'), { headers: { 'User-Agent': UA } })).json();
    if (!meta || !meta.width || !meta.height || !meta.extent) return null;
    w = meta.width; h = meta.height;
    const e = meta.extent;

    // 2) raw float32 raster (bsq single band = flat row-major float32)
    const res = await fetch(q('f=image'), { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < w * h * 4) return null;
    const heights = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) heights[i] = buf.readFloatLE(i * 4);

    // all-NoData => no coverage here; let the caller fall back
    let any = false;
    for (let i = 0; i < heights.length; i++) { if (!isNoData(heights[i])) { any = true; break; } }
    if (!any) return null;

    return { xmin: e.xmin, ymin: e.ymin, xmax: e.xmax, ymax: e.ymax, width: w, height: h, heights };
  } catch (_) {
    return null; // network / parse / service error -> fall back to terrarium
  }
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

module.exports = { fetchPatch, makePatchSampler, lonToMerc, latToMerc };
