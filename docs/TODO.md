# Open-Birdie — TODO

## Multi-patch HD terrain — SHIPPED (2026-06-30), with a batch-build follow-up

The runtime rendered only **one** 1 m lidar hole at a time (`active.json` → singular `activeHd`), so the rest
of the course stayed smooth SRTM ("satellite image on a smooth surface"). Now it renders **every built hole's
bundle at once**: `resolveHdBundles` scans `data/hd-courses/<slug>/bundles/` and returns one descriptor per
hole; `server.js` `activeHd` is an array (readiness verifies the bundle-id **set**, `/api/hd-assets` routes by
id via `pickDescriptor`, `/api/course-geometry` `hd` is an array); the client builds one HD mesh per patch,
cutting every rect out of the coarse mesh and skipping overlap (`buildCoarseTerrain({cutouts})` +
`buildHdTerrain({skipBounds})`). The sampler/physics were already array-native. Plan + full detail:
[`docs/superpowers/plans/2026-06-30-multipatch-hd-terrain.md`](superpowers/plans/2026-06-30-multipatch-hd-terrain.md).
Verified: 249 tests green, live `/api/course-geometry` returns 2 patches (holes 8+9), `.shots/multipatch-relief.png`.

- **FOLLOW-UP — batch-build the rest at 1 m.** Only holes 8 & 9 have bundles. For each remaining hole N (do 10
  first to finish the 8/9/10 trio, then 1–7, 11–18): copy `tools/hd-course/manifests/chambers-bay-hole-08.json`,
  set `"hole": N` + `"discovered": {"state": "pending"}`, then `cli.mjs discover --write` then `cli.mjs build`.
  Each build pulls ~285 MB NAIP + 3DEP (~30 s) and resets `active.json` (harmless now). Bundles ~350 KB each.
- **Note:** `active.json` is now vestigial for rendering (still written per build for single-hole verify /
  rollback). Between-hole/perimeter areas remain coarse SRTM (per-hole patches, by design).

## 3D buildings — SHIPPED (2026-06-27), with one follow-up

Buildings were the missing **vertical** structure ("still looks like paint on a
paper" feedback). Now: OSM building footprints render as extruded 3D massing —
walls + a colored roof (`scene.js _addBuildings`, flag `RENDER_CONFIG.buildings`),
seated on the lowest ground under each footprint, casting shadows. The clubhouse
gets a hero (terracotta-roof) material. Chambers Bay shows 185 buildings incl. the
real "Chambers Bay Clubhouse". `buildings` is a non-fingerprinted scenery field
(like `elevation.patches`), so attaching it never invalidates an HD bundle.
Served via `courseGeometry()` (`server.js`).

- **Data path today:** `node tools/add-buildings.mjs data/courses/<slug>.json`
  fetches OSM buildings for a cached course and attaches `course.buildings`.
- **FOLLOW-UP — auto-fetch on first load:** `lib/course.js` `FEATURES` still skips
  buildings, so a *freshly fetched* course has none until the tool is run. Wire
  `way/relation["building"]` into the Overpass query + parse in `parseOsm`. **Care:**
  compute the projection origin from golf coords only (buildings must not shift it)
  and do **not** bump `CACHE_VERSION` (both would change `courseFingerprint` and
  break existing HD bundles). New courses get buildings; existing caches keep theirs.
- **Polish:** roofs are flat massing blocks. Pitched/hipped roofs (esp. the
  clubhouse) would read far more like real buildings. Optional: window strips,
  merge into fewer draw calls if 185+ meshes ever costs FPS.

## QL1 gate — RESOLVED (2026-06-27)

Built **Chambers Bay hole 9** at **1 m** (`tools/hd-course/manifests/chambers-bay-hole-09.json`,
48 m relief, 32 m tee→green drop). Verdict: **real 1 m USGS 3DEP lidar fixes the
"flat / ink-on-paper" terrain** — it was a *data* limit (Bandon's 3 m grid smoothing
features < 6 m), not a shader limit. Dramatic, legible 3D relief at the player camera.
→ **Phase-1 AI hero-course authoring is NOT needed for relief** (the data does it); keep
it gated/unbuilt per the plan. The compiler is now course-general (3 courses, 3 UTM
zones, latitudes 30–47°N).

## HD-hole ↔ coarse-course color seam — RESOLVED (2026-06-27)

The HD hole used to read as a pale rectangular "relief-map tile" on green felt (geometry
was already seamless, ≤0.5 m — it was a color/texture mismatch). **Fixed by draping a
course-wide aerial**: `tools/add-course-aerial.mjs` fetches one USGS NAIP image (public
domain) for the whole course bbox and attaches `course.aerial = { file, bounds }`;
`scene.js` builds a `_macro` from it (white 1×1 coverage = valid everywhere) and the turf
shader drapes it over the ENTIRE course (preferred over the HD-rect `_hdMacro`). Served by
`/api/course-aerial`. Registration is exact by construction (the export bbox is the course
local bounds via the same origin/projection as `parseOsm`). Result: the whole course is the
real photo, the HD hole is just a sharper-relief region within it — no square. Verified:
`.shots/chambers-aerial-{topdown,h9pov}.jpg`.
- **Follow-up (polish, optional):** option C drops the HD hole's crisp 0.6 m orthophoto in
  favor of the uniform ~0.9 m course aerial (slightly soft underfoot at the HD hole). A
  two-layer macro (course aerial base + HD orthophoto inset) would restore close-up crispness
  there. Also: `add-course-aerial` is a manual tool like `add-buildings` — auto-fetch on first
  course load is the same documented pipeline follow-up.

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
