# Plan: Chambers Bay per-hole feature reconstruction (course-creator)

**Branch:** claude/hd-discovery-plan4 (the realism trunk)
**Date:** 2026-06-29
**Status:** PLANNED — next focused build. Continues the realism arc after the course-wide aerial drape landed.

## Why (the verified problem)

The course-wide NAIP aerial now drapes the whole course (it looks real). But it's a **flat photo**: a hole's bunkers/greens/water are *pixels*, not 3D objects, and have no physics (the ball doesn't know it's in a bunker).

Worse, **OpenStreetMap mis-PLACES whole holes** at Chambers Bay. Verified 2026-06-29: cropping the aerial at hole 9's mapped tee=[399.5,-502.05] / pin=[207.38,-440.4] (live-frame coords) shows the **clubhouse parking lot**, no green. So OSM is not "95% right" here, the hole data is fundamentally unreliable, and OSM **cannot be trusted even to locate holes**.

## Goal

Rebuild each hole's playing features (green, bunkers, water, fairway) as real 3D objects with correct physics, located + verified against **coursepreview.golf**, traced from the **registered aerial**, written to the **override sidecar**.

## Mechanism (already exists on plan4 — don't rebuild)

- **Override sidecar** `data/courses/<slug>.surfaces.json` (`lib/course.js applySurfaceOverride`/`loadSurfaceOverride`, doc `docs/surface-override-sidecar.md`):
  ```json
  { "version":1, "course":"...", "pins": {"9":[x,y]},
    "surfaces": [{"kind":"green|bunker|water|fairway|tee","hole":9,"poly":[[x,y],...]}] }
  ```
  Applied at load in `server.js activateCourse` **after** `resolveHdBundle` (so it never breaks the HD bundle fingerprint). Surfaces **append** to `course.surfaces`; pins **replace**. Feeds BOTH physics (`makeSurfaceLookup`) and the renderer (`_paintSplat`, crisp bunkers, green patches, water meshes). This is the single seam.
- **Exact pixel→local transform**: `tools/hd-course/coordinates.mjs`. The aerial is requested in EPSG:4326 over the course bbox, which maps 1:1 to equirectangular local metres (same frame `parseOsm` uses). Linear.

## The loop (per hole)

1. **LOCATE** (the answer key): from `coursepreview.golf/chambersbay/?hole=N` get the real hole's layout, green shape, pin, bunker positions, tee, yardage. OSM is wrong; this is the locator. (Frames live at `frames/HoleN/HQimage_*.jpg` — pre-rendered flyover; find a clear top-down/layout frame, or use as visual reference beside the aerial.)
2. **CROP** the aerial slice for the hole's real area.
3. **TRACE**: Claude reads the aerial crop, traces green/bunker/water/fairway rings in pixel coords (shape + reference, not color alone — fescue and sand look alike).
4. **CONVERT** pixels → local metres via the crop transform.
5. **WRITE** to the override sidecar (append surfaces; relocate the pin; add a per-hole boundary).
6. **VERIFY**: reload, render, overlay traced polys on the aerial, cross-check vs the coursepreview image, assert `surfaceAt(pin)==='green'`, and tee→pin along `line` ≈ scorecard yardage. Refine.
7. **ITERATE** hole by hole. Start with ONE hole done right, then scale to 18.

## Per-hole boundary (user-requested)

Derive each hole's playing-corridor boundary from the located routing + traced fairway/rough extent. Useful for framing, scoping the trace, and future out-of-bounds.

## Gotchas (learned this session)

- **Use the LIVE course frame, not plan4's hole manifests.** The active course is the long-slug cache `chambers-bay-golf-course-6320-...` (origin lat 47.20564, lon -122.57516). plan4's `chambers-bay-hole-09.json` was built against a *different* "Chambers Bay" cache/origin (fingerprint `92067...`), so its coords don't line up with the live aerial. Pull hole geometry from `/api/course-geometry` (`geo.holes[]`) and aerial bounds from `geo.aerial.bounds`.
- Aerial asset is generated, not committed: `node tools/add-course-aerial.mjs data/courses/<slug>.json`.
- coursepreview.golf is a JS app with pre-rendered frame images, not vector data — it's a visual reference, not a feed.

## Tooling to build (light)

- `tools/trace-features.mjs` (or extend): given a hole + the live course + aerial, crop the hole region and print the exact crop→local transform; Claude traces; writes/merges override entries. Add an overlay-render verify (draw traced polys back on the aerial crop).

## Scope

- In: the override is the home; build the crop/transform + coursepreview-reference loop; reconstruct hole-by-hole.
- Out: don't rebuild the override/renderers (exist). Don't trust OSM hole positions.

## Start

Pick one hole, locate via coursepreview, trace green + greenside bunkers + pin, override, verify against the reference + scorecard. If it reads right, scale.
