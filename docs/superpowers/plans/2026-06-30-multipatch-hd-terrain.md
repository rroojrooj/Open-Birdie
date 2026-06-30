# Multi-patch HD terrain — render real 1 m relief on every built hole

**Branch:** `claude/hd-multipatch-terrain` (off `claude/musing-ritchie-ebb288`) · **Date:** 2026-06-30
**Status:** ✅ IMPLEMENTED (this session). Verified with the existing hole 8 + 9 bundles; batch-build of the
remaining holes is the documented follow-up.

## Why

The course rendered as "a satellite image painted on a smooth surface." Only ONE hole looked like real
landform. Two settled facts: OSM surface placement is correct (18/18 pins on greens — do **not** re-trace),
and the smooth look is **low-res base terrain** (`lib/elevation.js`, AWS Terrarium z14 ~9.5 m SRTM, 5 m grid,
`SMOOTH_SIGMA=2`). The proven fix is **1 m 3DEP lidar**, delivered per-hole as an HD bundle — but the runtime
rendered only **one** bundle at a time (`active.json` → singular `activeHd`). The sampler + physics were
already array-native, so "real 3D on every built hole" was mostly a wiring job.

## What shipped

**Resolver — `lib/hd-bundle.js`:** added `resolveHdBundles(course, {dataDir})` → `{status, descriptors[]}`.
Scans `data/hd-courses/<slug>/bundles/<id>/` (not just `active.json`), validates each, keeps fingerprint
matches, dedups by hole (active.json wins a same-hole tie, else newest mtime). Extracted `buildDescriptor`.
The old blanket `HD_DUPLICATE` reject is gone (multiple holes is the goal). `resolveHdBundle` (singular) kept
as a back-compat wrapper.

**Server — `server.js` / `lib/hd-readiness.js` / `lib/hd-http.js`:** `activeHd` is now an **array**.
`activateCourse` uses `resolveHdBundles`; readiness verifies the **set** of bundle ids
(`verifyReadinessAck` → `currentBundleIds` + order-independent `sameBundleSet`); `activateRuntimeTerrain`
gets every grid; `/api/hd-assets/:id/:asset` routes via new `pickDescriptor(activeHd, id)`;
`/api/course-geometry` returns `hd` as an **array of metadata** (or null).

**Client — `public/app.js` / `public/render/scene.js` / `public/render/hd-terrain.js`:** `loadGeometry`
loads every `geo.hd[]` bundle (a failed one drops just that hole) and acks the full id set.
`scene.loadCourse` builds `_hdPatches[]` / `_hdMacros[]` and one sampler over all patches. `_terrainMesh`
cuts **every** HD rect out of the coarse mesh (`buildCoarseTerrain({cutouts})`) and builds **one HD mesh per
patch** (`buildHdTerrain({skipBounds})`), where each patch skips cells already covered by an earlier patch —
so overlapping padded hole rects don't z-fight (same first-match precedence the sampler uses). The
course-wide aerial (`_macro`) still textures every HD mesh via course-relative UVs.

## Architecture notes / gotchas

- `active.json` is now **vestigial for rendering** (still written by each build for the single-hole verify /
  rollback). The resolver scans the `bundles/` dir directly.
- **Fingerprint coupling** unchanged: every bundle must match `courseFingerprint`. Don't touch
  `lib/elevation.js`'s base source or course geometry, or all bundles silently fall back to coarse.
- **Overlapping patches:** holes 8 & 9 overlap (x[315,435]×y[-464,-399]); handled by sampler first-match +
  `skipBounds` mesh clip.
- Chosen architecture: per-hole patches over the coarse base (lower risk). Between-hole/perimeter areas stay
  coarse SRTM. The "course-wide 3DEP base" alternative was rejected — it changes `courseFingerprint` and
  invalidates every bundle.

## Verification (this session)

- `npm test` → **249 pass / 0 fail** (Node ≥ 22). New/updated: `resolveHdBundles` (test/hd-resolve-bundle),
  plural readiness (test/hd-readiness), `pickDescriptor` + multi-bundle serving (test/hd-server),
  `buildCoarseTerrain` union + `buildHdTerrain` skip + multi-patch sampler (test/hd-terrain, +runtime).
- Live server: `GET /api/course-geometry` → `hd` = **2-element array** (holes 8 + 9); both bundles' assets
  serve (200); unknown id → 404; log `[hd] 2 bundle(s) active: hole(s) 8, 9`.
- Relief proof: `.shots/multipatch-relief.png` — hillshade of coarse SRTM vs 1 m lidar for both holes
  (smooth blob → sculpted mounds / green bowls / bunker pits), generated from both resolver grids.
- Client path confirmed executing in a headless browser (THREE rendered, `window.__birdie.scene`
  instantiated). A clean in-browser screenshot was blocked by the headless daemon's instability on this
  WebGL+SSE page (documented) — capture via toDataURL+sink with rAF paused if a screenshot is needed.

## Follow-up (not done this session)

Batch-build the remaining holes at 1 m. Per hole N (do 10 first to finish the 8/9/10 trio, then 1–7,
11–18): copy `tools/hd-course/manifests/chambers-bay-hole-08.json`, set `"hole": N` +
`"discovered": {"state": "pending"}`, then `cli.mjs discover --write` then `cli.mjs build`. Each build pulls
~285 MB NAIP + 3DEP (~30 s) and resets `active.json` (harmless now). Bundles are ~350 KB on disk.
