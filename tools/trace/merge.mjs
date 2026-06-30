// Pure merge of a per-hole trace (already converted to LOCAL metres) into an
// override-sidecar object. Re-merging the same hole REPLACES that hole's entries
// (idempotent) via the `hole` provenance tag on surfaces, so the iterate loop
// never accumulates duplicates. Returns a NEW sidecar object (no mutation, no fs).

export function mergeTrace(sidecar, trace) {
  const { hole, surfacesLocal = [], pinLocal, boundaryLocal } = trace || {};
  const base = sidecar && typeof sidecar === 'object' ? sidecar : {};
  const out = {
    version: 1,
    course: base.course,
    note: base.note,
    // drop any prior entries for THIS hole, keep every other hole's
    surfaces: (base.surfaces || []).filter((s) => s.hole !== hole),
    pins: { ...(base.pins || {}) },
    holeBoundaries: { ...(base.holeBoundaries || {}) },
  };
  for (const s of surfacesLocal) {
    if (!s || !Array.isArray(s.poly) || s.poly.length < 3) continue;
    out.surfaces.push({
      kind: s.kind,
      poly: s.poly,
      hole,
      confidence: s.confidence ?? null,
      source: s.source || 'claude-vision',
    });
  }
  if (Array.isArray(pinLocal) && pinLocal.length === 2 && pinLocal.every(Number.isFinite)) {
    out.pins[hole] = [pinLocal[0], pinLocal[1]];
  }
  if (Array.isArray(boundaryLocal) && boundaryLocal.length >= 3) {
    out.holeBoundaries[hole] = boundaryLocal;
  }
  return out;
}
