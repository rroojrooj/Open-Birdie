// SPIKE (throwaway): can we separate green / fairway / bunker from the NAIP aerial?
// Pulls the Bandon Hole 1 window WITH the NIR band (band 4 — the pipeline's
// acquireImagery currently reads only [0,1,2]), computes NDVI + a texture metric,
// writes RGB / NDVI / naive-class PNGs to .shots/, and marks the OSM pin.
//
//   node tools/spike-segment.mjs --manifest tools/hd-course/manifests/bandon-dunes-hole-01.json --course <repo-root course>

import fs from 'node:fs';
import { PNG } from 'pngjs';
import { loadManifest } from './hd-course/config.mjs';
import { loadCourseFile } from './hd-course/course-source.mjs';
import { computeHoleBounds, snapHdBounds } from './hd-course/bounds.mjs';
import { wgs84ToUtm, localToWgs84 } from './hd-course/coordinates.mjs';
import { searchNaipCandidates, selectPinnedAcquisition, assetHref } from './hd-course/naip.mjs';
import { openPinnedCog, makeSemaphore } from './hd-course/cog-source.mjs';
import { fetchBounded } from './hd-course/http.mjs';

const opt = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = 'C:/Users/USER/Documents/GitHub/Open-Birdie/.claude/worktrees/suspicious-pike-b4f09a/.shots';

const boundedFetch = (manifest) => async (url, { headers } = {}) => {
  const r = await fetchBounded(url, {
    range: headers && (headers.Range || headers.range),
    allowedHosts: [new URL(url).hostname],
    maxBytes: manifest.limits.maxDownloadBytes,
  });
  return { status: r.status, headers: r.headers, arrayBuffer: async () => r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength) };
};

function utmExtent(bounds, origin, epsg) {
  const pts = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.minX, bounds.maxY], [bounds.maxX, bounds.maxY]]
    .map(([x, y]) => wgs84ToUtm(localToWgs84({ x, y }, origin), epsg));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { minU: Math.min(...xs), maxU: Math.max(...xs), minV: Math.min(...ys), maxV: Math.max(...ys) };
}

async function main() {
  const manifest = loadManifest(opt('manifest'));
  const course = loadCourseFile(opt('course'));
  const raw = computeHoleBounds(course, manifest.hole, manifest.padding);
  const snapped = snapHdBounds(raw, { coarse: course.elevation, targetSpacingM: manifest.terrain.targetSpacingM });
  const corners = [[snapped.minX, snapped.minY], [snapped.maxX, snapped.minY], [snapped.minX, snapped.maxY], [snapped.maxX, snapped.maxY]]
    .map(([x, y]) => localToWgs84({ x, y }, course.origin));
  const lats = corners.map((c) => c.lat), lons = corners.map((c) => c.lon);
  const bbox = { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };

  console.log('discovering NAIP…');
  const features = await searchNaipCandidates({ bbox, endpoint: manifest.providers.imagery });
  const picked = selectPinnedAcquisition(features, manifest);
  const sem = makeSemaphore(2);

  // read the 4-band window from the tile that actually covers the pin
  const pinUtmByEpsg = {};
  let chosen = null;
  for (const f of picked) {
    const epsg = `EPSG:${f.properties['proj:epsg']}`;
    const tiff = await openPinnedCog({ url: assetHref(f), fetchImpl: boundedFetch(manifest), semaphore: sem });
    const image = await tiff.getImage();
    const [ox, oy] = image.getOrigin();
    const [rx, ry] = image.getResolution();
    const ext = utmExtent(snapped, course.origin, epsg);
    const px = (u, v) => [Math.floor((u - ox) / rx), Math.floor((v - oy) / ry)];
    const [x0, y0] = px(ext.minU, ext.maxV);
    const [x1, y1] = px(ext.maxU, ext.minV);
    const win = [Math.max(0, x0), Math.max(0, y0), Math.min(image.getWidth(), x1 + 1), Math.min(image.getHeight(), y1 + 1)];
    const w = win[2] - win[0], h = win[3] - win[1];
    console.log(`tile ${f.id}: window ${w}x${h}`);
    if (w < 50 || h < 50) continue;
    const data = await image.readRasters({ window: win, interleave: true, samples: [0, 1, 2, 3] });
    // pin pixel (window-relative)
    const pinU = wgs84ToUtm(localToWgs84({ x: course.holes.find((hh) => hh.ref === manifest.hole).pin[0], y: course.holes.find((hh) => hh.ref === manifest.hole).pin[1] }, course.origin), epsg);
    const ppx = Math.floor((pinU.x - ox) / rx) - win[0], ppy = Math.floor((pinU.y - oy) / ry) - win[1];
    chosen = { data, w, h, ppx, ppy };
    if (ppx >= 0 && ppx < w && ppy >= 0 && ppy < h) break; // tile with the pin in it
  }
  if (!chosen) throw new Error('no usable window');

  const { data, w, h, ppx, ppy } = chosen;
  console.log(`pin pixel in window: ${ppx},${ppy} (window ${w}x${h})`);

  const D = Math.max(1, Math.round(Math.max(w, h) / 900)); // downsample so the long side ~900px
  const ow = Math.floor(w / D), oh = Math.floor(h / D);
  const rgb = new PNG({ width: ow, height: oh });
  const ndvi = new PNG({ width: ow, height: oh });
  const cls = new PNG({ width: ow, height: oh });
  const gray = new Float32Array(ow * oh);
  const ndv = new Float32Array(ow * oh);

  let veg = 0, sand = 0, water = 0;
  for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) {
    const sx = i * D, sy = j * D, si = (sy * w + sx) * 4;
    const R = data[si], G = data[si + 1], B = data[si + 2], N = data[si + 3];
    const o = (j * ow + i) * 4;
    rgb.data[o] = R; rgb.data[o + 1] = G; rgb.data[o + 2] = B; rgb.data[o + 3] = 255;
    const nd = (N - R) / (N + R + 1e-6);
    ndv[j * ow + i] = nd;
    gray[j * ow + i] = (R + G + B) / 3;
    const g = Math.max(0, Math.min(255, Math.round((nd + 0.2) / 1.2 * 255)));
    ndvi.data[o] = g; ndvi.data[o + 1] = g; ndvi.data[o + 2] = g; ndvi.data[o + 3] = 255;
  }
  // texture = local std-dev of grayscale over a 7px window (downsampled grid)
  const tex = new Float32Array(ow * oh);
  const r = 3;
  for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) {
    let s = 0, s2 = 0, n = 0;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const jj = j + dj, ii = i + di; if (jj < 0 || jj >= oh || ii < 0 || ii >= ow) continue;
      const v = gray[jj * ow + ii]; s += v; s2 += v * v; n++;
    }
    const m = s / n; tex[j * ow + i] = Math.sqrt(Math.max(0, s2 / n - m * m));
  }
  // naive classification
  for (let k = 0; k < ow * oh; k++) {
    const nd = ndv[k], br = gray[k], tx = tex[k];
    let c;
    if (nd < 0.05 && br > 145) c = [225, 205, 140];           // bunker / bare sand (bright, non-veg)
    else if (nd < 0.02) c = [70, 110, 160];                    // water / shadow (dark, non-veg)
    else if (nd > 0.30 && tx < 9) c = [70, 200, 90];           // GREEN candidate: high vigor + smooth
    else if (nd > 0.22 && tx < 16) c = [120, 175, 80];         // fairway candidate: mown, medium texture
    else c = [60, 110, 55];                                    // rough / native
    const o = k * 4; cls.data[o] = c[0]; cls.data[o + 1] = c[1]; cls.data[o + 2] = c[2]; cls.data[o + 3] = 255;
    if (nd > 0.30 && tx < 9) veg++; if (nd < 0.05 && br > 145) sand++; if (nd < 0.02) water++;
  }
  // mark the OSM pin (red crosshair) on rgb + cls
  const mark = (png) => {
    const cx = Math.round(ppx / D), cy = Math.round(ppy / D);
    for (let d = -12; d <= 12; d++) {
      for (const [x, y] of [[cx + d, cy], [cx, cy + d]]) {
        if (x < 0 || x >= ow || y < 0 || y >= oh) continue;
        const o = (y * ow + x) * 4; png.data[o] = 255; png.data[o + 1] = 30; png.data[o + 2] = 30; png.data[o + 3] = 255;
      }
    }
  };
  mark(rgb); mark(cls);

  fs.writeFileSync(`${OUT}/spike-rgb.png`, PNG.sync.write(rgb));
  fs.writeFileSync(`${OUT}/spike-ndvi.png`, PNG.sync.write(ndvi));
  fs.writeFileSync(`${OUT}/spike-class.png`, PNG.sync.write(cls));
  console.log(`wrote spike PNGs (${ow}x${oh}, downsample ${D}). green-cand px=${veg}, sand=${sand}, water=${water}`);
  console.log('classes: tan=bunker/sand, blue=water/shadow, bright-green=GREEN cand, mid-green=fairway, dark-green=rough. red=OSM pin.');
}
main().catch((e) => { console.error(e.stack || e); process.exit(1); });
