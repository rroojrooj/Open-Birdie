import test from 'node:test';
import assert from 'node:assert/strict';
import { localToWgs84, wgs84ToUtm } from '../tools/hd-course/coordinates.mjs';
import { reprojectImagery } from '../tools/hd-course/imagery.mjs';
import { buildPinnedLut, applyLut } from '../tools/hd-course/normalize.mjs';

const origin = { lat: 43.188372, lon: -124.391261 };
const snapped = { minX: 0, minY: 0, maxX: 60, maxY: 60, cellM: 3, nx: 21, ny: 21 };
const EPSG = 'EPSG:26910';

function utmFootprint() {
  const pts = [
    { x: snapped.minX, y: snapped.minY }, { x: snapped.maxX, y: snapped.minY },
    { x: snapped.minX, y: snapped.maxY }, { x: snapped.maxX, y: snapped.maxY },
  ].map((p) => wgs84ToUtm(localToWgs84(p, origin), EPSG));
  const xs = pts.map((c) => c.x); const ys = pts.map((c) => c.y);
  return { minU: Math.min(...xs), maxU: Math.max(...xs), minV: Math.min(...ys), maxV: Math.max(...ys) };
}

// A source whose 4 quadrants are NW=red NE=green SW=blue SE=yellow, covering the
// hole's UTM footprint with a small pad so every output sample is inside.
function quadSource(sz = 16, pad = 0.05) {
  const { minU, maxU, minV, maxV } = utmFootprint();
  const pu = (maxU - minU) * pad; const pv = (maxV - minV) * pad;
  const originX = minU - pu; const originY = maxV + pv;
  const pixelW = ((maxU + pu) - (minU - pu)) / sz;
  const pixelH = ((maxV + pv) - (minV - pv)) / sz;
  const rgb = Buffer.alloc(sz * sz * 3);
  const C = { R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255], Y: [255, 255, 0] };
  for (let r = 0; r < sz; r += 1) {
    for (let c = 0; c < sz; c += 1) {
      const north = r < sz / 2; const west = c < sz / 2;
      const col = north ? (west ? C.R : C.G) : (west ? C.B : C.Y);
      const o = (r * sz + c) * 3; rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
    }
  }
  return { rgb, width: sz, height: sz, geo: { originX, originY, pixelW, pixelH, epsg: EPSG } };
}

const dominant = ([r, g, b]) => (r > g && r > b ? 'R' : g > r && g > b ? 'G' : b > r && b > g ? 'B' : r > 100 && g > 100 ? 'Y' : '?');

test('reprojection preserves orientation — corner colors, no mirror or rotation', () => {
  const out = reprojectImagery({ sources: [quadSource()], snapped, origin, outW: 8, outH: 8, epsg: EPSG });
  const px = (i, j) => { const o = (j * 8 + i) * 3; return [out.rgb[o], out.rgb[o + 1], out.rgb[o + 2]]; };
  assert.equal(dominant(px(0, 0)), 'R', 'NW red');
  assert.equal(dominant(px(7, 0)), 'G', 'NE green');
  assert.equal(dominant(px(0, 7)), 'B', 'SW blue');
  assert.equal(dominant(px(7, 7)), 'Y', 'SE yellow');
});

test('an uncovered output (imagery gap) is rejected', () => {
  const src = quadSource();
  src.geo.pixelW *= 0.1; src.geo.pixelH *= 0.1; // source now covers only a sliver
  assert.throws(() => reprojectImagery({ sources: [src], snapped, origin, outW: 8, outH: 8, epsg: EPSG }), /HD_IMAGERY_GAP/);
});

test('pinned LUT caps black/white extremes and is deterministic', () => {
  const a = buildPinnedLut(); const b = buildPinnedLut();
  assert.ok(Buffer.from(a).equals(Buffer.from(b)));
  assert.equal(a[0], 0);
  assert.equal(a[2], 0); // below the black point
  assert.equal(a[255], 255);
});

test('applyLut maps every channel through the LUT', () => {
  const lut = buildPinnedLut();
  const out = applyLut(Buffer.from([0, 128, 255]), lut);
  assert.equal(out[0], lut[0]);
  assert.equal(out[1], lut[128]);
  assert.equal(out[2], lut[255]);
});
