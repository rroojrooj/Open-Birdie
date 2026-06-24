// Reproject NAIP imagery (UTM) onto the local north-up output grid.
//
// For each output pixel: local metres -> WGS84 -> source UTM -> bilinear RGB.
// Sources are tried in order (multi-tile union); a pixel covered by none is a
// hard failure (HD_IMAGERY_GAP) rather than a silent hole. Output is north-up
// (row 0 = maxY), matching the mask rasterizer and the runtime painter.
//
// A source is { rgb: Buffer(h*w*3), width, height, geo: { originX, originY,
// pixelW, pixelH } } where (originX, originY) is the UTM coordinate of the
// north-west pixel and pixelH is the (positive) south-ward step per row.

import { HdCompileError } from './errors.mjs';
import { localToWgs84, wgs84ToUtm } from './coordinates.mjs';

function sampleSource(src, ux, uy) {
  const fx = (ux - src.geo.originX) / src.geo.pixelW;
  const fy = (src.geo.originY - uy) / src.geo.pixelH; // north-up source: row 0 = north
  if (fx < 0 || fy < 0 || fx > src.width - 1 || fy > src.height - 1) return null;
  const x0 = Math.floor(fx); const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, src.width - 1); const y1 = Math.min(y0 + 1, src.height - 1);
  const dx = fx - x0; const dy = fy - y0;
  const at = (px, py, c) => src.rgb[(py * src.width + px) * 3 + c];
  const lerp = (a, b, t) => a + (b - a) * t;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    const top = lerp(at(x0, y0, c), at(x1, y0, c), dx);
    const bot = lerp(at(x0, y1, c), at(x1, y1, c), dx);
    out[c] = Math.round(lerp(top, bot, dy));
  }
  return out;
}

export function reprojectImagery({ sources, snapped, origin, outW, outH, epsg }) {
  const { minX, minY, maxX, maxY } = snapped;
  const rgb = Buffer.alloc(outW * outH * 3);
  let gaps = 0;
  for (let j = 0; j < outH; j += 1) {
    const y = maxY - ((j + 0.5) / outH) * (maxY - minY); // north-up
    for (let i = 0; i < outW; i += 1) {
      const x = minX + ((i + 0.5) / outW) * (maxX - minX);
      const utm = wgs84ToUtm(localToWgs84({ x, y }, origin), epsg);
      let rgbv = null;
      for (const src of sources) { rgbv = sampleSource(src, utm.x, utm.y); if (rgbv) break; }
      const o = (j * outW + i) * 3;
      if (!rgbv) { gaps += 1; } else { rgb[o] = rgbv[0]; rgb[o + 1] = rgbv[1]; rgb[o + 2] = rgbv[2]; }
    }
  }
  if (gaps > 0) throw new HdCompileError('reproject', 'HD_IMAGERY_GAP', { gaps, total: outW * outH });
  return { rgb, width: outW, height: outH };
}
