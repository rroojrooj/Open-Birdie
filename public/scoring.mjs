// Pure scoring/labelling helpers, shared by the HUD (app.js) and tested in node.
// No DOM, no imports — keep it loadable in both the browser and node:test.

// Strokes vs par across every played hole; nulls (unplayed) are ignored.
export function toPar(scores, pars) {
  let t = 0;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] != null) t += scores[i] - pars[i];
  }
  return t;
}

// The state-dependent forward control. "Last hole" dominates "holed" so the
// final hole always reads "Finish round". `over` hides it entirely.
export function forwardLabel(s) {
  if (s.over) return { hidden: true };
  if (s.hole === s.holeCount) return { label: 'Finish round' };
  if (s.holed) return { label: 'Next hole' };
  if (s.strokes > 0) return { label: 'Pick up' };
  return { label: 'Skip' };
}

// One-word round verdict for the summary hero.
export function verdict(par) {
  return par < 0 ? 'Under par' : par > 0 ? 'Over par' : 'Even';
}
