// Pixel <-> local-metre transform for the registered course aerial.
//
// The aerial covers `bounds` (LOCAL METRES) over an image of imgW x imgH px.
// Convention: image origin top-left; +px = east (+localX); +py = south (-localY).
// (Confirmed by the overlay-verify step. If the overlay comes out mirrored, the
// aerial was exported with the opposite y, so flip the y term in BOTH functions
// and re-verify. The round-trip test guards that forward/inverse stay inverses.)

export function fullPxToLocal({ px, py }, b, imgW, imgH) {
  return {
    x: b.minX + (px / imgW) * (b.maxX - b.minX),
    y: b.maxY - (py / imgH) * (b.maxY - b.minY),
  };
}

export function localToFullPx({ x, y }, b, imgW, imgH) {
  return {
    px: ((x - b.minX) / (b.maxX - b.minX)) * imgW,
    py: ((b.maxY - y) / (b.maxY - b.minY)) * imgH,
  };
}

// A crop is a sub-rect (x0,y0,w,h) of the full image; a crop pixel (cx,cy) maps
// to full pixel (x0+cx, y0+cy).
export function cropPxToLocal({ cx, cy }, crop, b, imgW, imgH) {
  return fullPxToLocal({ px: crop.x0 + cx, py: crop.y0 + cy }, b, imgW, imgH);
}

export const ringPxToLocal = (ring, b, imgW, imgH) =>
  ring.map(([px, py]) => { const p = fullPxToLocal({ px, py }, b, imgW, imgH); return [p.x, p.y]; });

export const ringLocalToPx = (ring, b, imgW, imgH) =>
  ring.map(([x, y]) => { const p = localToFullPx({ x, y }, b, imgW, imgH); return [p.px, p.py]; });
