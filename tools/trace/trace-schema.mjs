// Validates a per-hole trace object before it is converted + merged into the
// sidecar. The >40-point ring cap is the precision guard: at ~0.9 m/px a bunker
// is ~10 px across, so dense rings would encode sub-pixel structure the imagery
// can't support. One ring per surface entry; multi-part features -> multiple
// entries; nested features (bunker-in-fairway) are both emitted, surfaceAt's
// priority resolves overlap (no hole-punching).

export const KINDS = new Set(['green', 'bunker', 'fairway', 'tee', 'water']);
export const MAX_RING_PTS = 40;

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const isRing = (r) => Array.isArray(r) && r.length >= 3 && r.length <= MAX_RING_PTS && r.every(isPoint);

export function validateTrace(t) {
  const errors = [];
  if (!t || typeof t !== 'object') return { ok: false, errors: ['not an object'] };
  if (!Number.isFinite(t.hole)) errors.push('hole missing/invalid');
  const c = t.crop;
  if (!c || !['x0', 'y0', 'w', 'h'].every((k) => Number.isFinite(c[k]))) errors.push('crop missing/invalid');
  if (!Array.isArray(t.surfaces)) errors.push('surfaces missing');
  else t.surfaces.forEach((s, i) => {
    if (!s || !KINDS.has(s.kind)) errors.push(`surface[${i}] bad kind`);
    if (!s || !isRing(s.poly_px)) errors.push(`surface[${i}] poly_px must be 3-${MAX_RING_PTS} points`);
  });
  if (t.pin_px != null && !isPoint(t.pin_px)) errors.push('pin_px invalid');
  if (t.boundary_px != null && !isRing(t.boundary_px)) errors.push('boundary_px invalid');
  return { ok: errors.length === 0, errors };
}
