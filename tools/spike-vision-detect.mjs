// SPIKE 3 (throwaway): the REAL vision detector — the feasibility gate.
// Earlier spike fed ONE 794x1087 three-hole window to the model; each green was
// ~30px and it scored 25-30 m. This one cuts a TIGHT, HIGH-RES crop PER HOLE
// (computeHoleBounds -> snap -> NAIP window, native res), so the green fills the
// frame — the same base64 a production per-hole API call would send.
//
// Pass 1 (default): for each hole, window the NAIP COG, write detect-h<ref>.png +
//   per-hole transform params. If ANTHROPIC_API_KEY is set it ALSO calls
//   claude-opus-4-8 (vision, structured output) per hole and scores automatically.
//   No key -> writes crops + tells you to score your own picks with --pick.
// Pass 2 (--pick "9:i,j; 18:i,j"): convert each picked pixel -> local metres and
//   print the distance to that hole's OSM green centroid (the on-screen-verified oracle).
//
//   node tools/spike-vision-detect.mjs --manifest tools/hd-course/manifests/bandon-dunes-hole-01.json --course <repo-root course> [--holes 9,18]
//   node tools/spike-vision-detect.mjs --pick "9:640,300; 18:610,250"

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
const PARAMS = `${OUT}/detect-params.json`;
const MODEL = 'claude-opus-4-8';

const boundedFetch = (manifest) => async (url, { headers } = {}) => {
  const r = await fetchBounded(url, { range: headers && (headers.Range || headers.range), allowedHosts: [new URL(url).hostname], maxBytes: manifest.limits.maxDownloadBytes });
  return { status: r.status, headers: r.headers, arrayBuffer: async () => r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength) };
};
const utmExt = (b, origin, epsg) => {
  const pts = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]].map(([x, y]) => wgs84ToUtm(localToWgs84({ x, y }, origin), epsg));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { minU: Math.min(...xs), maxU: Math.max(...xs), minV: Math.min(...ys), maxV: Math.max(...ys) };
};

// oracle = OSM green-surface centroid nearest this hole's pin (the on-screen-verified target)
function greenCentroidFor(course, hole) {
  const greens = (course.surfaces || []).filter((s) => s.kind === 'green');
  let best = null, bestD = Infinity;
  for (const g of greens) {
    const ring = g.poly || g.ring || [];
    if (!ring.length) continue;
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
    const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const d = Math.hypot(cx - hole.pin[0], cy - hole.pin[1]);
    if (d < bestD) { bestD = d; best = [cx, cy]; }
  }
  return best;
}

// the corridor's green-end: the line vertex farthest from the tee vertex (line[0]).
// follows the (correct, for 9/18) OSM routing to where the green should be —
// the production-faithful framing, without using the green/pin oracle.
function greenEndVertex(hole) {
  const line = hole.line || [];
  const t = line[0];
  let best = line[line.length - 1] || hole.pin, bestD = -1;
  for (const v of line) { const d = Math.hypot(v[0] - t[0], v[1] - t[1]); if (d > bestD) { bestD = d; best = v; } }
  return best;
}

async function windowHole(course, manifest, hole, sem, boxM) {
  let bounds;
  if (boxM) {
    const [cx, cy] = greenEndVertex(hole);
    bounds = { minX: cx - boxM, maxX: cx + boxM, minY: cy - boxM, maxY: cy + boxM };
  } else {
    bounds = snapHdBounds(computeHoleBounds(course, hole.ref, manifest.padding), { coarse: course.elevation, targetSpacingM: manifest.terrain.targetSpacingM });
  }
  const snapped = bounds;
  const corners = [[snapped.minX, snapped.minY], [snapped.maxX, snapped.minY], [snapped.minX, snapped.maxY], [snapped.maxX, snapped.maxY]].map(([x, y]) => localToWgs84({ x, y }, course.origin));
  const lats = corners.map((c) => c.lat), lons = corners.map((c) => c.lon);
  const bbox = { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };
  const features = await searchNaipCandidates({ bbox, endpoint: manifest.providers.imagery });
  const f = selectPinnedAcquisition(features, manifest)[0];
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
  const D = Math.max(1, Math.round(Math.max(w, h) / 1280)); // tight crop: native res up to ~1280px long side
  const ow = Math.floor(w / D), oh = Math.floor(h / D);
  const png = new PNG({ width: ow, height: oh });
  for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) {
    const si = ((j * D) * w + (i * D)) * 3, o = (j * ow + i) * 4;
    png.data[o] = data[si]; png.data[o + 1] = data[si + 1]; png.data[o + 2] = data[si + 2]; png.data[o + 3] = 255;
  }
  const buf = PNG.sync.write(png);
  return { png: buf, ow, oh, params: { D, win0: win[0], win1: win[1], ox, oy, rx, ry, epsg, origin: course.origin } };
}

// pixel in the ow x oh PNG -> local metres (the exact inverse transform)
function pixToLocal(i, j, p) {
  const tilePx = i * p.D + p.win0, tilePy = j * p.D + p.win1;
  const ll = utmToWgs84({ x: p.ox + tilePx * p.rx, y: p.oy + tilePy * p.ry }, p.epsg);
  return wgs84ToLocal(ll, p.origin);
}

async function callVision(pngBuf, ow, oh) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      green_found: { type: 'boolean' },
      green_center: { type: 'array', items: { type: 'number' } },
      green_polygon: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
      pin_found: { type: 'boolean' },
      pin_pixel: { type: 'array', items: { type: 'number' } },
      confidence: { type: 'number' },
    },
    required: ['green_found', 'green_center', 'green_polygon', 'pin_found', 'pin_pixel', 'confidence'],
  };
  const prompt = `This is a top-down aerial photograph of ONE golf hole, ${ow}x${oh} pixels (origin top-left, x right, y down).\n`
    + `The PUTTING GREEN is the smooth, uniformly-mown, often oval/kidney-shaped patch — a slightly different shade and finer texture than the surrounding fairway — at the END of the hole (greens sit at the far end from the tee, frequently ringed by bunkers).\n`
    + `Identify, in this image's pixel coordinates:\n`
    + `1. green_polygon: the green's outline as [[x,y],...] (6-12 vertices),\n`
    + `2. green_center: the green centroid [x,y],\n`
    + `3. pin_pixel: the flagstick if you can see it (a tiny bright/dark point on the green), else the green centroid,\n`
    + `4. confidence 0..1.\n`
    + `Pick the single most green-like surface. Return strict JSON only.`;
  const body = {
    model: MODEL, max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBuf.toString('base64') } },
      { type: 'text', text: prompt },
    ] }],
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) { console.error(`  API ${r.status}: ${(await r.text()).slice(0, 300)}`); return null; }
  const msg = await r.json();
  if (msg.stop_reason === 'refusal') { console.error('  API refusal'); return null; }
  const txt = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(txt); } catch { console.error(`  unparseable: ${txt.slice(0, 200)}`); return null; }
}

async function pass1() {
  const manifest = loadManifest(opt('manifest'));
  const course = loadCourseFile(opt('course'));
  const holeRefs = (opt('holes') || '9,18').split(',').map((s) => Number(s.trim()));
  const boxM = opt('box') ? Number(opt('box')) : 0; // tight green-end crop of side 2*box metres
  const sem = makeSemaphore(2);
  const allParams = {};
  const haveKey = !!process.env.ANTHROPIC_API_KEY;
  console.log(haveKey ? `ANTHROPIC_API_KEY present -> running ${MODEL} per hole` : 'no ANTHROPIC_API_KEY -> writing crops only; score with --pick');
  for (const ref of holeRefs) {
    const hole = course.holes.find((h) => h.ref === ref);
    if (!hole) { console.log(`hole ${ref}: not in course`); continue; }
    const oracle = greenCentroidFor(course, hole);
    const { png, ow, oh, params } = await windowHole(course, manifest, hole, sem, boxM);
    fs.writeFileSync(`${OUT}/detect-h${ref}.png`, png);
    allParams[ref] = { ...params, ow, oh, oracle };
    console.log(`hole ${ref}: detect-h${ref}.png ${ow}x${oh}  oracle green=[${oracle.map((n) => n.toFixed(0))}]`);
    if (haveKey) {
      const v = await callVision(png, ow, oh);
      if (v && v.pin_found !== undefined) {
        const pinPx = (v.pin_found && v.pin_pixel?.length === 2) ? v.pin_pixel : v.green_center;
        const loc = pixToLocal(pinPx[0], pinPx[1], params);
        const d = Math.hypot(loc.x - oracle[0], loc.y - oracle[1]);
        const gc = pixToLocal(v.green_center[0], v.green_center[1], params);
        const dg = Math.hypot(gc.x - oracle[0], gc.y - oracle[1]);
        console.log(`  VISION pin px=[${pinPx.map((n) => Math.round(n))}] -> local=[${loc.x.toFixed(0)},${loc.y.toFixed(0)}]  green-center off=${dg.toFixed(1)}m  PIN off=${d.toFixed(1)}m  conf=${v.confidence}  ${d < 15 ? 'PASS' : 'FAIL'} (<15m)`);
      }
    }
  }
  fs.writeFileSync(PARAMS, JSON.stringify(allParams));
  if (!haveKey) console.log(`\nwrote ${PARAMS}. Read each detect-h*.png, pick the green-center pixel, then:\n  node tools/spike-vision-detect.mjs --pick "9:i,j; 18:i,j"`);
}

function pass2(pickStr) {
  const all = JSON.parse(fs.readFileSync(PARAMS, 'utf8'));
  for (const tok of pickStr.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [refStr, ij] = tok.split(':');
    const ref = Number(refStr.trim());
    const p = all[ref];
    if (!p) { console.log(`hole ${ref}: no params (run pass1 first)`); continue; }
    const [i, j] = ij.split(',').map(Number);
    const loc = pixToLocal(i, j, p);
    const d = Math.hypot(loc.x - p.oracle[0], loc.y - p.oracle[1]);
    console.log(`hole ${ref}: pixel ${i},${j} -> local [${loc.x.toFixed(0)},${loc.y.toFixed(0)}]  oracle green [${p.oracle.map((n) => n.toFixed(0))}]  off=${d.toFixed(1)}m  ${d < 15 ? 'PASS' : 'FAIL'} (<15m)`);
  }
}

const pick = opt('pick');
(pick ? Promise.resolve(pass2(pick)) : pass1()).catch((e) => { console.error(e.stack || e); process.exit(1); });
