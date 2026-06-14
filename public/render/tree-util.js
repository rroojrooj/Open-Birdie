// Pure tree helpers (no three import) so they unit-test in node.

// Deterministic species from instance index. ~60% conifer / 40% deciduous via a
// cheap hash so placement is stable between loads (matches mulberry32 determinism).
export function speciesFor(i) {
  const h = ((i * 2654435761) >>> 0) / 4294967296;
  return h < 0.6 ? 'conifer' : 'deciduous';
}

// Canopy card dimensions (meters) per species. Conifer = tall/narrow, deciduous = round.
export function canopyDims(species) {
  if (species === 'conifer') return { width: 3.4, height: 7.0, yCenter: 5.6, planes: 3 };
  return { width: 5.0, height: 4.6, yCenter: 4.6, planes: 3 };
}
