// SPIKE 2 (throwaway): can a vision model georeference the green from the aerial?
// Pass 1 (no args): fetch the Bandon Hole-1 NAIP window (which also contains holes
//   9, 18 + their real greens), write an UNANNOTATED crop + save the exact pixel->local
//   transform. A human/vision model then looks at the crop BLIND and picks green pixels.
// Pass 2 (--pick "i,j;i,j;..."): convert each picked downsampled pixel -> local metres
//   and print the distance to the KNOWN OSM green centroids (the scoring oracle).
//
//   node tools/spike-vision.mjs --manifest <m> --course <c>
//   node tools/spike-vision.mjs --pick "517,485;540,590"

import fs from 'node:fs';
import { PNG } from 'pngjs';
import { loadManifest } from './hd-course/config.mjs';
import { loadCourseFile } from './hd-course/course-source.mjs';
import { computeHoleBounds, snapHdBounds } from './hd-course/bounds.mjs';
import { wgs84ToUtm, utmToWgs84, localToWgs84, wgs84ToLocal } from './hd-course/coordinates.mjs';
import { searchNaipCandidates, selectPinnedAcquisition, assetHref } from './hd-course/naip.mjs';
import { openPinnedCog, makeSemaphore } from './hd-course/cog-source.mjs';
import { fetchBounded } from './hd-course/http.mjs';

const opt = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = 'C:/Users/USER/Documents/GitHub/Open-Birdie/.claude/worktrees/suspicious-pike-b4f09a/.shots';
const PARAMS = `${OUT}/spike-vision-params.json`;
// known OSM green centroids (local m) — the scoring oracle
const KNOWN = [{ hole: 9, c: [-30, -3] }, { hole: 18, c: [32, -132] }, { hole: '?', c: [71, -90] }, { hole: '?', c: [-19, -266] }];

const boundedFetch = (manifest) => async (url, { headers } = {}) => {
  const r = await fetchBounded(url, { range: headers && (headers.Range || headers.range), allowedHosts: [new URL(url).hostname], maxBytes: manifest.limits.maxDownloadBytes });
  return { status: r.status, headers: r.headers, arrayBuffer: async () => r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength) };
};
const utmExt = (b, origin, epsg) => {
  const pts = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]].map(([x, y]) => wgs84ToUtm(localToWgs84({ x, y }, origin), epsg));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { minU: Math.min(...xs), maxU: Math.max(...xs), minV: Math.min(...ys), maxV: Math.max(...ys) };
};

async function pass1() {
  const manifest = loadManifest(opt('manifest'));
  const course = loadCourseFile(opt('course'));
  const snapped = snapHdBounds(computeHoleBounds(course, manifest.hole, manifest.padding), { coarse: course.elevation, targetSpacingM: manifest.terrain.targetSpacingM });
  const corners = [[snapped.minX, snapped.minY], [snapped.maxX, snapped.minY], [snapped.minX, snapped.maxY], [snapped.maxX, snapped.maxY]].map(([x, y]) => localToWgs84({ x, y }, course.origin));
  const lats = corners.map((c) => c.lat), lons = corners.map((c) => c.lon);
  const bbox = { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };
  const features = await searchNaipCandidates({ bbox, endpoint: manifest.providers.imagery });
  const picked = selectPinnedAcquisition(features, manifest);
  const sem = makeSemaphore(2);
  const f = picked[0];
  const epsg = `EPSG:${f.properties['proj:epsg']}`;
  const tiff = await openPinnedCog({ url: assetHref(f), fetchImpl: boundedFetch(manifest), semaphore: sem });
  const image = await tiff.getImage();
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution();
  const ext = utmExt(snapped, course.origin, epsg);
  const px = (u, v) => [Math.floor((u - ox) / rx), Math.floor((v - oy) / ry)];
  const [x0, y0] = px(ext.minU, ext.maxV), [x1, y1] = px(ext.maxU, ext.minV);
  const win = [Math.max(0, x0), Math.max(0, y0), Math.min(image.getWidth(), x1 + 1), Math.min(image.getHeight(), y1 + 1)];
  const w = win[2] - win[0], h = win[3] - win[1];
  const data = await image.readRasters({ window: win, interleave: true, samples: [0, 1, 2] });
  const D = Math.max(1, Math.round(Math.max(w, h) / 900));
  const ow = Math.floor(w / D), oh = Math.floor(h / D);
  const png = new PNG({ width: ow, height: oh });
  for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) {
    const si = ((j * D) * w + (i * D)) * 3, o = (j * ow + i) * 4;
    png.data[o] = data[si]; png.data[o + 1] = data[si + 1]; png.data[o + 2] = data[si + 2]; png.data[o + 3] = 255;
  }
  fs.writeFileSync(`${OUT}/spike-vision.png`, PNG.sync.write(png));
  fs.writeFileSync(PARAMS, JSON.stringify({ D, win0: win[0], win1: win[1], ox, oy, rx, ry, epsg, origin: course.origin, ow, oh }));

  // annotated copy: known OSM green centroids (cyan) + hole pins (red)
  const annot = new PNG({ width: ow, height: oh });
  png.data.copy(annot.data);
  const toPix = (lx, ly) => {
    const u = wgs84ToUtm(localToWgs84({ x: lx, y: ly }, course.origin), epsg);
    return [Math.round((Math.round((u.x - ox) / rx) - win[0]) / D), Math.round((Math.round((u.y - oy) / ry) - win[1]) / D)];
  };
  const dot = (cx, cy, col, rad) => {
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy > rad * rad) continue;
      const x = cx + dx, y = cy + dy; if (x < 0 || x >= ow || y < 0 || y >= oh) continue;
      const o = (y * ow + x) * 4; annot.data[o] = col[0]; annot.data[o + 1] = col[1]; annot.data[o + 2] = col[2]; annot.data[o + 3] = 255;
    }
  };
  for (const k of KNOWN) { const [i, j] = toPix(k.c[0], k.c[1]); dot(i, j, [0, 255, 255], 9); } // cyan = OSM greens
  for (const h of (course.holes || [])) { const [i, j] = toPix(h.pin[0], h.pin[1]); dot(i, j, [255, 30, 30], 7); } // red = pins
  fs.writeFileSync(`${OUT}/spike-vision-annot.png`, PNG.sync.write(annot));
  console.log('annotated: cyan = OSM green centroids (holes 9,18,+2); red = hole pins (1,9,10,18)');
  console.log(`wrote spike-vision.png ${ow}x${oh} (downsample ${D}). Look at it BLIND, pick green-center pixels, then: node tools/spike-vision.mjs --pick "i,j;i,j"`);
}

function pass2(pickStr) {
  const p = JSON.parse(fs.readFileSync(PARAMS, 'utf8'));
  for (const tok of pickStr.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [i, j] = tok.split(',').map(Number);
    const tilePx = i * p.D + p.win0, tilePy = j * p.D + p.win1;
    const ll = utmToWgs84({ x: p.ox + tilePx * p.rx, y: p.oy + tilePy * p.ry }, p.epsg);
    const loc = wgs84ToLocal(ll, p.origin);
    let best = { d: 1e9, hole: null, c: null };
    for (const k of KNOWN) { const d = Math.hypot(loc.x - k.c[0], loc.y - k.c[1]); if (d < best.d) best = { d, hole: k.hole, c: k.c }; }
    console.log(`pixel ${i},${j} -> local (${loc.x.toFixed(0)}, ${loc.y.toFixed(0)})  | nearest known green: hole ${best.hole} ${JSON.stringify(best.c)} = ${best.d.toFixed(0)} m`);
  }
}

const pick = opt('pick');
(pick ? Promise.resolve(pass2(pick)) : pass1()).catch((e) => { console.error(e.stack || e); process.exit(1); });
