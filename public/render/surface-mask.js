export const RAW_SURFACE_COLORS = Object.freeze({
  fairway: '#ff0000',
  tee: '#ff0000',
  green: '#ffff00',
  bunker: '#0000ff',
});

export function paintSurfaceMask({
  bounds,
  surfaces,
  kinds,
  colors = null,
  blurPx = 1,
  additive = false,
  canvasFactory = () => document.createElement('canvas'),
}) {
  const extX = bounds.maxX - bounds.minX;
  const extY = bounds.maxY - bounds.minY;
  const ppm = Math.min(2.2, 4096 / Math.max(extX, extY));
  const width = Math.round(extX * ppm);
  const height = Math.round(extY * ppm);
  const canvas = canvasFactory();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Surface-mask canvas has no 2D context');

  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);
  const px = (x) => (x - bounds.minX) * ppm;
  const py = (y) => (bounds.maxY - y) * ppm;
  context.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
  if (additive) context.globalCompositeOperation = 'lighter';

  try {
    for (const kind of kinds) {
      context.fillStyle = colors ? (colors[kind] || colors.default || '#fff') : '#fff';
      for (const surface of surfaces) {
        if (surface.kind !== kind || !surface.poly?.length) continue;
        context.beginPath();
        context.moveTo(px(surface.poly[0][0]), py(surface.poly[0][1]));
        for (let i = 1; i < surface.poly.length; i += 1) {
          context.lineTo(px(surface.poly[i][0]), py(surface.poly[i][1]));
        }
        context.closePath();
        context.fill();
      }
    }
  } finally {
    // The raw RGB mask uses additive channel ownership. Always restore ordinary
    // compositing so a reused canvas/context cannot leak `lighter` into later work.
    context.globalCompositeOperation = 'source-over';
    context.filter = 'none';
  }
  return canvas;
}
