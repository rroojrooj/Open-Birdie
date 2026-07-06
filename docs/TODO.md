# Open-Birdie — TODO

## ACTIVE ROADMAP: Reality Master Plan (2026-07-06) — 3/10 → 6–7/10

A dual assessment (one agent vs the 106-photo real library, one vs the GSPro/EA/TrackMan bar) scored
the current build **3/10 on both axes** (convergent, independent). The full phased roadmap lives in
[`superpowers/plans/2026-07-06-reality-master-plan.md`](superpowers/plans/2026-07-06-reality-master-plan.md):
**P0** debug-artifact purge (~1d: pond checker, "T" sprite, aim-line dashes, halftone override stamps,
HD patch seams) → **P1a** Puget Sound + world edge (~2–3d) ∥ **P1b** tan-first course identity (~2–3d)
→ **P2** SDF crisp surfaces + turf light response (~8–13d) → **P3** bunker recess + green complexes
(~8–12d) → **P4** links vegetation + marine atmosphere (~5–8d). Each phase gets its own sub-plan +
`/plan-eng-review` before build; re-run the dual assessment after each phase. What's RIGHT and must
never regress: QL1 lidar landform, registration/routing, no HD color seam, sky pipeline.

## Real-photo cross-check + greige sand — DONE (2026-07-06, branch `claude/course-character-palette`)

Cross-checked the sim's renders against the REAL Chambers Bay (gathered a **~106-photo local reference
library** at `reference/chambers-bay/` via parallel web-search agents — aerial/ground/greens/holes/
features, each dev-labeled; see `reference/chambers-bay/CATALOG.md` for the palette hexes + character +
gap list). The cross-check verdict: **the sim renders Chambers as a lush green striped PARKLAND course;
it's a firm brown/tan minimal-stripe LINKS.**

- **Shipped: greige native sand (`turf.js` v31).** Real waste/bunker sand is grey-tan crushed material
  (~`#b7a98b`), NOT the bunker-white the sim used. Toned both sand paths (`makeSandMaterial` +
  the turf shader sand path). Verified on Chambers overview: waste now reads native greige. 291 tests.
- **Scoped follow-up — course-character palette (the rest of the arc).** Target hexes (from real photos):
  fairway `#5e7d3d` (cool olive, not kelly), rough `#c0a666` (gold-tan, should DOMINATE off-line), green
  `#6b894a`, water pewter. Mow stripes should be **minimal on fescue links** (bold is correct for
  parkland like Sawgrass — so it must be COURSE-AWARE, not global). **Detector:** the aerial playable-mean
  greenness does NOT separate links/parkland (Chambers 0.047 vs Sawgrass 0.023 — mean averages in
  sand/water/trees); sample the **fairway-grass color** in `scene.js _buildMacroTint` (already rasterizes
  polys into the aerial canvas) → `uCourseDry` via a shared `{value}` uniform (like `uMacroAvg`) →
  drive stripe strength + palette in `turf.js`. Spans base + HD macro paths (two async tint builders).
- **Also confirmed by the reference:** treeless playing field (only the Lone Fir at 15 + a perimeter rim
  wall — verify no interior trees); greens = raised tiered plateaus (greens phase B); quarry ruins + rail
  line + Puget Sound are signature scenery.

## Overview realism — DONE (2026-07-06, branch `claude/overview-realism`)

Kills the last facet of the "satellite photo painted on terrain" complaint: the OVERVIEW /
survey shot reading as a flat re-projected aerial. Went through `/plan-eng-review` + an
independent outside voice FIRST, which caught the plan's original thesis was wrong (verified in
code) and re-scoped it — then a Task-0 diagnostic gate measured the real lever before any build:

- **Eng-review + outside voice killed the shadow epic before it was built.** The first plan bet on
  "extend hole-scoped shadow coverage to the whole course." The outside voice found (and I verified):
  terrain meshes **never set `castShadow`** (`scene.js:474`, `hd-terrain.js:68/77` receive-only) so
  the dune relief can't self-shadow at all; and the far field is 88% raw photo that washes out
  lighting regardless. A live Task-0 A/B confirmed it: enabling terrain castShadow + a course-wide
  frustum changed the overview by **nothing**; dropping `courseAerialPhotoFar` **transformed** it. So
  the entire shadow-casting / camera-adaptive-frustum / CSM plan was **dropped as unnecessary** —
  the diffuse-lit HD relief already carries the 3D form once the photo stops drowning it.
- **The fix = one config knob + a small shader fade.** `courseAerialPhotoFar` **0.88 → 0.62** (the
  dominant lever — lets the lit relief read as 3D while keeping real albedo; play view unchanged
  since the far photo only applies past 60 m). Plus `turf.js` **v30** distance-fade on the mow
  stripes + green checker (`sFade = 1 - smoothstep(120, 280, dist)`) so the grooming grid doesn't
  over-read at altitude now the photo no longer hides it. Cache key v29→v30.
- **Verified:** Chambers overview flat-photo → lit 3D dune landscape; play frame **pixel-unchanged**
  (bold stripes intact); Sawgrass (flat) overview unregressed. 291 tests. Plan +full review record:
  [`superpowers/plans/2026-07-06-overview-realism.md`](superpowers/plans/2026-07-06-overview-realism.md).
- **Still open (assessor's remaining):** 3D green complexes / lidar relief (phase B); flat billboard
  trees at distance; a full impostor forest. The overview now reads as a lit landscape, not a photo.

## Greens polish + class-map feather — DONE (2026-07-06, branch `claude/greens-polish`)

Phase-A of the greens arc (assessor's #2, "flat green blobs with hard edges") — **shader-only,
scope-locked with the user**, plus a class-map follow-up the close-up forced out:

- **Greens shader polish (`turf.js` v29).** (1) **Soft edge:** an *averaged* (not max) 8-tap green
  dilation → a smooth `gEdge` membership that fades the putting-surface character across a collar
  band instead of a stamped cookie-cutter edge. (2) **Calm checker:** `0.15 → 0.09` (the bold grid
  read as blocky from the orbit cam — A/B verified: bold grid → subtle mown surface). (3) **Contour
  roll:** a ~16 m low-freq value undulation (0.05) so the green reads shaped, not a flat uniform disc.
  Cache key `v28 → v29`. **Reassessed:** at our elevated orbit cam the shader levers (edge/checker)
  carry the win; real lidar green *relief* (phase B) is subtler than it sounds — deferred.
- **Class-map feather (`classify-surfaces.js`).** The greens close-up exposed that the bigger
  close-range eyesore was NDVI **sand rendering as hard low-res "Minecraft" tiles** (the class-map is
  ~2.4–5.7 m/texel over a whole course; the [[#33]] denoise killed the *scatter*, not the blocky
  *edges*). Fix: **box-blur the denoised class masks to 0..255 COVERAGE** (radius meter-scaled via
  `FEATHER_M=3.5` so big courses don't oversoften) so the shader's existing linear sand/mown blend
  fades across the edge. Solid interiors stay full; only boundaries ramp. **Verified:** chambers
  close-up went from hard tiles → smooth sand→grass. Channels are now coverage (tests assert >200
  interior + a partial-edge ramp). 291 tests.
- **Still open (assessor, next arcs):** real 3D green complexes / lidar relief (phase B); milky
  mid-distance far-field; HD-patch seams + doll-house buildings; every overview still reads as a
  photo (the ground-level/relief win doesn't reach the survey-the-hole cameras).

## Classmap speckle + broadleaf tree — FIXED (2026-07-06, branch `claude/classmap-speckle-fix`)

Fast-follow after an independent visual-QA assessor scored the shipped realism **4.5/10** and
flagged two artifacts. Both fixed at the source, verified on the real render:

- **Classmap "tan speckle" (assessor #1 critical).** The NDVI classifier is per-pixel, so
  bright-but-low-NDVI false positives (dry links fescue, tree-shadow on parkland) scattered lone
  `sand`/`fairway` pixels that render as blocky tan/striped specks. Fix: a **3×3 majority denoise**
  (`majorityDenoise`, `DENOISE_MIN=5`) on the class rasters **before encode** in
  `lib/classify-surfaces.js` — drops any class pixel not backed by ≥5 of its 9-neighborhood, fills
  pinholes, keeps solid bunkers/fairways. **Encode-only:** S2 stats still run on the raw classes so
  the calibrated abort thresholds are unchanged. **Verified:** TPC Sawgrass overview went from
  speckle-smeared to clean solid bunkers (sand 8646→5493 px, −36.5%; Chambers contiguous sand only
  −9.4%, i.e. mostly edge cleanup — adaptive by construction). Demo classmaps regenerated on disk
  (post-processing the PNG == re-running the classifier, since denoise is on the final masks).
- **Broadleaf tree "shattered glass" (assessor bug).** `broadleafGeometry` built 160 big (~4 m)
  radial frond cards that protruded past the canopy shell and read as edge-on slivers + dark
  `DoubleSide` back-faces from a low camera. Fix (`public/render/tree-cards.js`): shorter cards +
  denser N (160→340), a smaller (`0.72×`) darker (`0x3f5730`) canopy core so foliage covers it
  instead of the core reading as a faceted ball → a solid, believable deciduous tree. Conifers are a
  separate code path, untouched (verified intact on Chambers).
- **Honest scoping note (from the diagnosis):** a live classmap-OFF toggle proved the class-map does
  **not** drive Chambers' green-cam look — the "tan" the assessor saw there is the **aerial tint of
  Chambers' real fescue + the green's hard cookie-cutter edge**, i.e. the **greens gap (#2)**, a
  separate authored-greens arc — NOT the classmap. The denoise's real win is parkland / sparse-OSM
  courses (Sawgrass). Remaining ranked gaps from the assessment: greens as 3D complexes (hard edge +
  blocky checker), milky mid-distance far-field, HD-patch seams / doll-house buildings.

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

## Chambers Bay HD bundles vs CACHE_VERSION 4 — RESOLVED (2026-07-04), with a v3-cache follow-up

The warned-about break happened: PR #23 (`c9eb14d`, v0.9.0) bumped `CACHE_VERSION` 3→4 and re-fetched
`chambers-bay.json` with the course-wide 1 m 3DEP base (`elevation` 217×363@5m → 1081×1816@1m, patches baked
in, `version: 4`) — both fields are fingerprinted, so `courseFingerprint` moved `92067899…` → `bd4fce5f…` and
`resolveHdBundles` rejected both hole 8/9 bundles (status `absent`, coarse fallback). The v4 migration was
intentional, so the fix was **rebuild, not restore** (restoring `chambers-bay.v3.bak.json` would just re-fetch
v4 on the next non-cached load). Done:

- Compiler now accepts course cache **v3 and v4** (`tools/hd-course/course-source.mjs` + `compiler.mjs` gates;
  test in `test/hd-fingerprint.test.mjs`). v4 is shape-identical everywhere the compiler reads.
- Both manifests re-pinned via `cli.mjs discover --write` (fingerprint `bd4fce5f…`, bounds re-snapped for the
  1 m coarse grid, same NAIP COG/ETag) and rebuilt (~30 s each): hole 8 → `c4da699e…`, hole 9 → `a0bb8060…`.
  Old `92067899…` bundles left on disk (harmless — fingerprint-filtered; delete or keep for rollback).
- Verified live: `[hd] 2 bundle(s) active: hole(s) 8, 9` on `/api/load-course {cached: "chambers-bay.json"}`.

- **FOLLOW-UP — every still-v3 cached course breaks its bundles on re-search.** `bandon-…json` (has the hole-1
  bundle), `st-andrews…json`, `tpc-sawgrass.json` (hole-17 manifest in flight) are still `version: 3`. Cached
  loads (`/api/load-course {cached}`) skip the version check, so they keep working — but a **search-path load**
  (`loadCourse`) sees `version !== CACHE_VERSION` and re-fetches v4 with a new fingerprint, killing that
  course's bundles. Remedy per course after it migrates: `discover --write` + `build` (the runbook above).

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
  chambers-bay HD bundles were fingerprint-stale (CACHE_VERSION 3→4) — **now RESOLVED**, see the top section.

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
