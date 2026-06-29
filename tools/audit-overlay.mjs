// AUDIT (throwaway): overlay EVERY game component (hole lines, numbers, pins, tees,
// greens, fairways, bunkers, water, boundary) onto the real NAIP satellite the game
// uses, so each can be cross-checked against the actual course in the photo.
//   node tools/audit-overlay.mjs --manifest <m> --course <c>
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { loadManifest } from './hd-course/config.mjs';
import { loadCourseFile } from './hd-course/course-source.mjs';
import { wgs84ToUtm, localToWgs84 } from './hd-course/coordinates.mjs';
import { searchNaipCandidates, selectPinnedAcquisition, assetHref } from './hd-course/naip.mjs';
import { openPinnedCog, makeSemaphore } from './hd-course/cog-source.mjs';
import { fetchBounded } from './hd-course/http.mjs';

const opt = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = 'C:/Users/USER/Documents/GitHub/Open-Birdie/.claude/worktrees/suspicious-pike-b4f09a/.shots';
const boundedFetch = (manifest) => async (url, { headers } = {}) => {
  const r = await fetchBounded(url, { range: headers && (headers.Range || headers.range), allowedHosts: [new URL(url).hostname], maxBytes: manifest.limits.maxDownloadBytes });
  return { status: r.status, headers: r.headers, arrayBuffer: async () => r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength) };
};
// 3x5 digit font
const FONT = { '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'], '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'] };

async function main() {
  const manifest = loadManifest(opt('manifest'));
  const course = loadCourseFile(opt('course'));
  // bbox of all hole geometry + surfaces (NOT the giant property boundary)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  for (const h of course.holes) { (h.line || []).forEach((p) => acc(p[0], p[1])); if (h.tee) acc(h.tee[0], h.tee[1]); if (h.pin) acc(h.pin[0], h.pin[1]); }
  for (const s of course.surfaces) (s.poly || []).forEach((p) => acc(p[0], p[1]));
  const pad = 50; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const bounds = { minX, minY, maxX, maxY };

  const corners = [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]].map(([x, y]) => localToWgs84({ x, y }, course.origin));
  const lats = corners.map((c) => c.lat), lons = corners.map((c) => c.lon);
  const bbox = { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };
  console.log('discovering NAIP for full course bbox…', `${(maxX - minX).toFixed(0)}x${(maxY - minY).toFixed(0)} m`);
  const features = await searchNaipCandidates({ bbox, endpoint: manifest.providers.imagery });
  const f = selectPinnedAcquisition(features, manifest)[0];
  const epsg = `EPSG:${f.properties['proj:epsg']}`;
  const sem = makeSemaphore(2);
  const tiff = await openPinnedCog({ url: assetHref(f), fetchImpl: boundedFetch(manifest), semaphore: sem });
  const image = await tiff.getImage();
  const [ox, oy] = image.getOrigin(); const [rx, ry] = image.getResolution();
  const utm = corners.map((c) => wgs84ToUtm(c, epsg));
  const us = utm.map((p) => p.x), vs = utm.map((p) => p.y);
  const px = (u, v) => [Math.floor((u - ox) / rx), Math.floor((v - oy) / ry)];
  const [x0, y0] = px(Math.min(...us), Math.max(...vs)), [x1, y1] = px(Math.max(...us), Math.min(...vs));
  const win = [Math.max(0, x0), Math.max(0, y0), Math.min(image.getWidth(), x1 + 1), Math.min(image.getHeight(), y1 + 1)];
  const w = win[2] - win[0], h = win[3] - win[1];
  const data = await image.readRasters({ window: win, interleave: true, samples: [0, 1, 2] });
  const D = Math.max(1, Math.round(Math.max(w, h) / 1600));
  const ow = Math.floor(w / D), oh = Math.floor(h / D);
  const png = new PNG({ width: ow, height: oh });
  for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) { const si = ((j * D) * w + (i * D)) * 3, o = (j * ow + i) * 4; png.data[o] = data[si]; png.data[o + 1] = data[si + 1]; png.data[o + 2] = data[si + 2]; png.data[o + 3] = 255; }

  const toPix = (lx, ly) => { const u = wgs84ToUtm(localToWgs84({ x: lx, y: ly }, course.origin), epsg); return [Math.round(((u.x - ox) / rx - win[0]) / D), Math.round(((u.y - oy) / ry - win[1]) / D)]; };
  const put = (x, y, c) => { if (x >= 0 && x < ow && y >= 0 && y < oh) { const o = (y * ow + x) * 4; png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255; } };
  const line = (a, b, c, th = 1) => { const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1); for (let t = 0; t <= n; t++) { const x = Math.round(a[0] + (b[0] - a[0]) * t / n), y = Math.round(a[1] + (b[1] - a[1]) * t / n); for (let dy = -th; dy <= th; dy++) for (let dx = -th; dx <= th; dx++) put(x + dx, y + dy, c); } };
  const polyOut = (ring, c, th = 0) => { const pts = ring.map((p) => toPix(p[0], p[1])); for (let i = 0; i < pts.length; i++) line(pts[i], pts[(i + 1) % pts.length], c, th); };
  const disc = (cx, cy, r, c) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) put(cx + dx, cy + dy, c); };
  const sq = (cx, cy, r, c) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) put(cx + dx, cy + dy, c); };
  const digit = (x, y, ch, s, c) => { const g = FONT[ch]; if (!g) return; for (let r = 0; r < 5; r++) for (let col = 0; col < 3; col++) if (g[r][col] === '1') for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) put(x + col * s + dx, y + r * s + dy, c); };
  const label = (x, y, str, s, c) => { let cx = x; for (const ch of str) { for (let dy = -1; dy <= s * 5; dy++) for (let dx = -1; dx <= s * 3; dx++) put(cx + dx, y + dy, [0, 0, 0]); digit(cx, y, ch, s, c); cx += s * 3 + s; } };

  // boundary (white, clipped to window naturally by put())
  if (course.boundary) polyOut(course.boundary, [255, 255, 255], 0);
  // surfaces
  const SKIND = { green: [0, 255, 255], fairway: [220, 230, 40], bunker: [255, 150, 30], water: [40, 120, 255], tee: [120, 255, 120] };
  for (const s of course.surfaces) { const c = SKIND[s.kind]; if (c && s.poly) polyOut(s.poly, c, 0); }
  // holes
  const HC = { 1: [255, 60, 60], 9: [255, 160, 30], 10: [255, 60, 255], 18: [80, 180, 255] };
  for (const h of course.holes) {
    const c = HC[h.ref] || [255, 255, 255];
    const ln = (h.line || []).map((p) => toPix(p[0], p[1]));
    for (let i = 1; i < ln.length; i++) line(ln[i - 1], ln[i], c, 1);
    if (h.tee) { const t = toPix(h.tee[0], h.tee[1]); sq(t[0], t[1], 5, c); label(t[0] + 8, t[1] - 6, 'T' in FONT ? String(h.ref) : String(h.ref), 3, [255, 255, 255]); }
    if (h.pin) { const p = toPix(h.pin[0], h.pin[1]); disc(p[0], p[1], 7, c); label(p[0] + 10, p[1] - 8, String(h.ref), 4, [255, 255, 255]); }
  }
  fs.writeFileSync(`${OUT}/audit-overlay.png`, PNG.sync.write(png));
  console.log(`wrote audit-overlay.png ${ow}x${oh}`);
  console.log('legend: disc+number = PIN, square = TEE, line = hole routing (h1 red, h9 orange, h10 magenta, h18 blue)');
  console.log('surfaces: green=cyan, fairway=yellow, bunker=orange, water=blue, tee=lt-green, boundary=white');
  // per-hole nearest-green report
  const greens = course.surfaces.filter((s) => s.kind === 'green').map((s) => { const r = s.poly; return [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length]; });
  for (const h of course.holes) { let best = 1e9; for (const g of greens) best = Math.min(best, Math.hypot(h.pin[0] - g[0], h.pin[1] - g[1])); console.log(`hole ${h.ref}: pin->nearest green ${best.toFixed(0)} m ${best < 20 ? 'OK (on a green)' : 'NO GREEN nearby (unmapped)'}`); }
}
main().catch((e) => { console.error(e.stack || e); process.exit(1); });
