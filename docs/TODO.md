# Open-Birdie — TODO

## Runtime NDVI surface classification — IMPLEMENTED (2026-07-05, branch `claude/ndvi-classification`)

Closes the material-first "sparse stripes" gap the DATA way: at course load (cache-miss,
best-effort, zero new deps — `pngjs` only) we fetch the NAIP **NIR band** (a 2nd
`format=png&bandIds=3,0,1` request alongside the RGB), run the existing NDVI classifier
(`tools/trace/segment.mjs` → extracted to `lib/segment-core.js`), and bake a course-wide
class-map PNG (R=NDVI-mown-fairway, B=NDVI-sand) clipped to the inside-course mask. The turf
shader (v27) **unions** it into the existing gates (`m = max(m, cls.r)` **before** the stripe
block; `bm = max(uBunker.r, cls.b*(1-m))`) — extending mow stripes + sand material onto
surfaces OSM never mapped, on every course automatically. Plan + full review record:
[`superpowers/plans/2026-07-05-runtime-ndvi-classification.md`](superpowers/plans/2026-07-05-runtime-ndvi-classification.md).
Built via subagent-driven development (6 tasks, per-task spec+quality review). NOT yet PR'd.

- **Task 0 gate = GO (proven live):** NIR retrievable zero-dep (fairway NDVI 0.31 vs sand −0.12).
  Two fetches required (band 4 drops from a single PNG render); `format=png` mandatory (the
  aerial's `jpgpng` returns lossy JPEG pngjs can't decode). **S2 safeguard redesigned from the
  spike:** PRIMARY = mown-floor `<3%` (the real failure — NIR silently degrading to R — collapses
  mown to 0 while sand stays plausible, which a sand-only abort misses); SECONDARY = sand `>55%`.
- **Live-verified end to end** (first real run against the endpoint): chambers mown 26.0% / sand
  15.6%, sawgrass 7.5% / 13.5% (null-boundary dilated-union path) — both match the Task-0 calibration
  and clear the safeguard. The null-boundary classify path was a **10–20 s first-load stall** (fixed
  with an AABB pre-reject → sub-second; caught by the code-quality review gate).
- **Visual gate caught a regression** unit tests couldn't: the class-map marked sand across the whole
  padded window incl. off-course beach/parking → tiled sand overpainted the far-field photo at the
  overview. Fixed by clipping the class-map to the inside-course mask. Overview now matches the shipped
  real-place look; waste/dune areas get real sand material.
- **Honest visual finding:** on Chambers (good OSM coverage) the *visible* delta is **modest** — OSM
  already maps the greens + most bunkers, and the far-field photo already reads correct, so NDVI mostly
  adds sand material on the waste OSM missed (real but subtle) and extends the mown treatment. The win
  is bigger on sparse-OSM courses, plus the automation (every course, zero manual steps).
- **FOLLOW-UPS:** (1) **stripe strength — SHIPPED (2026-07-05, `turf.js` v28).** NDVI extends *where*
  stripes apply; the base amplitude was bumped `0.28/0.13 → 0.38/0.17` so the groomed mow bands now read
  boldly at both play height and the elevated orbit cam (verified before/after on the largest Chambers
  fairway; the overview is unregressed — the symmetric stripe averages out under mip-collapse at altitude).
  This is the "visible finish" on top of the NDVI foundation. (2) Class-maps are
  runtime-generated on cache-miss; the two demo courses were back-filled with a one-off script (their
  caches predate the feature) — a fresh US course auto-generates on first load. (3) `water` NDVI class
  over-fires (shoreline+shadow) — unused by the gate, don't treat as hydrology.

## Material-first ground — SHIPPED (2026-07-04), with follow-ups

The aerial is demoted from albedo (was 90–99 % of the ground color = "satellite photo
painted on the surface") to a playable-mean-normalized **tint** over the PBR turf + a
true-far-field layer (60–150 m crossfade); greens get their own treatment via the packed
`uMask.g` channel. Plan + embedded review record:
[`superpowers/plans/2026-07-04-material-first-ground.md`](superpowers/plans/2026-07-04-material-first-ground.md).

- **FOLLOW-UP — runtime NDVI sand (dunes/waste OSM misses).** Build **runtime-first** on the
  `lib/aerial.js` pattern: one more NAIPPlus `exportImage` request with the NIR band
  (`bandIds`) + `pngjs` decode + the pure `tools/trace/segment.mjs` math → feed
  `uMacroSurfaces` (bound, black-defaulted, never sampled today). **Never a manual per-course
  dev tool** (the review killed that: it re-introduces the manual-step debt v0.9.2 removed).
  **Mandatory safeguards (CEO-review):** NDVI sand only *outside* OSM mown polys (bright +
  low-NDVI is exactly dry links fescue — Chambers fairways would classify as sand), plus a
  coverage-sanity abort (implausible sand % → refuse loudly). Trigger: captures showing OSM
  bunker/waste coverage is visibly insufficient.
- **6→8 polish pass — SHIPPED (2026-07-05, v26)** in response to an adversarial visual-QA
  pass (6/10 → the four PARTIAL/NOT-MET findings). Chroma-limited luma-lean tint (kills
  OSM-unmapped water/path/roof colour bleeding onto turf), sharper 2.5 m/px tint copy (fills
  the 20–80 m ball-flight band with real ground structure), tint pulled off mown ground +
  bolder stripes (mow bands now legible where OSM marks fairway), 8-tap collar (was
  invisible). **Correction to the QA report:** its "worst problem #1 — teal water painted on
  grass" at Sawgrass 17 is the REAL island-green water mesh (raycast: 2 meshes span the
  region), not a tint ghost — the tufts standing in it are the placement bug below.
- **Still open — the biggest remaining "groomed" gap is DATA, not shader.** Mow stripes only
  render where OSM marks fairway/tee; Chambers hole 9's OSM mown coverage is near-empty
  (fairway centroid mask r≈0.22), so most of its fairway shows no stripes. This is exactly
  what the **runtime NDVI classification** follow-up (above) fixes — real mown boundaries on
  every course. Until then, stripes are correct-but-sparse, not a shader bug.
- **Polish (minor):** near-field links palette on Chambers still greener than its own
  overview (faithful to the aerial there; pushing fescue harder risks the reverted grey-wash);
  tint/photo band constants tuned on two courses; collar subtle at grazing angles.
- **Observed (pre-existing, not this arc):** tpc-sawgrass plants rough-fescue tufts across
  water/green approaches (OSM labeling/placement quirk — `groundGrass` uses zone data);
  chambers-bay HD bundles fingerprint-stale (separate task, CACHE_VERSION 3→4).

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
