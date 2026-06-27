# Open-Birdie — TODO

## Deferred

### Vertical-exaggeration knob (render fidelity)
Parked 2026-06-26 from the Phase-0 fidelity work. The "looks flat / map glued onto a
smooth surface" feel at ground level is a **geometry** limit (the 3 m terrain grid),
not shading — the de-light and meso-normal shader levers barely move it. The one
Phase-0 lever that would help is vertical exaggeration, deferred because it's a
**gameplay-affecting decision**, not a quick tweak:

- Add `RENDER_CONFIG.verticalScale` (default **1.0 = no-op**, safe for the shipping
  launch-monitor product — changing real-course terrain scale is a regression).
- Scale heights by `vs` **in lockstep at every render point** or objects float/sink:
  - `public/render/hd-terrain.js` `gridGeometry` — `pos[k*3+1] = heights[k] * vs`
    (thread `vs` through `buildHdTerrain` / `buildCoarseTerrain`).
  - `public/render/scene.js` `hAt` — multiply the returned height (seats ball, pin,
    trees, water plane, shadows, aim line on the scaled surface).
  - `public/render/scene.js` `_addGreenPatches` — scale the green-mesh heights too
    (omitting this was flagged in review: greens would sink into a 1.2× world).
- **The tradeoff to decide:** physics stays unscaled (render-only) → the rendered
  slope is `vs`× steeper than the slope the ball actually rolls/breaks on. On a
  fidelity sim that's a real "visual lie" (a putt breaks on the true slope while the
  eye sees a steeper one; ~1.2× is around the just-noticeable threshold on greens).
  Three options: render-only knob; scale physics too (consistent but changes every
  course's gameplay/calibration); or scale everything *except* greens.
- Bandon's flatness is **data-bound** (2008 3DEP, no QL1 lidar), so exaggeration is
  its *only* relief tool. Courses with real 1 m lidar get genuine relief for free
  via the resolution-adaptive compiler (shipped 2026-06-26: `manifest.terrain.
  nativeSpacingM`/`maxPx`).
- Verify via the render-grade loop at 1.0 / 1.2 / 1.3 (before/after dune captures).
