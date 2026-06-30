# Handoff prompt — "real 1m 3D terrain everywhere" (Open-Birdie / Chambers Bay)

Paste the block below into a fresh Claude Code session in the Open-Birdie repo.

---

You are continuing work on **Open-Birdie** (web/Three.js golf sim). Read these memory files first:
`chambers-bay-feature-reconstruction.md` (CORRECTED — read it fully), `branch-divergence-realism-trunk.md`,
`hd-pipeline-gotchas.md`, `hd-ql1-verdict.md`, `golf-realism-research.md`.

## The goal (user's words)
"I want REAL 3D OBJECT, not a satellite image painted on the smooth surface, for ALL the area of the golf
course." The whole course must render as a real sculpted landform — actual mounds, bunker pits, green
contours — everywhere, not a flat aerial draped over smooth terrain.

## What's already settled (do NOT re-derive or repeat these mistakes)
- **OSM surface placement is CORRECT.** Verified data-driven on the live server: 18/18 pins return
  `surfaceAt(pin)==='green'`, all tee→pin distances are plausible-for-par, elevations match the real course
  (hole 9 = "Olympus", 221y, 109ft drop). The old "OSM mislocates holes / hole 9 = clubhouse parking lot"
  claim is FALSE for the live `chambers-bay.json` cache — it was a misread of a downscaled aerial crop.
  **Do not re-trace surfaces.** The `tools/trace/*` Phase-A reconstruction track (and the
  `docs/superpowers/plans/2026-06-29-chambers-bay-pbr-pilot.md` plan) was built on that false premise and is
  mostly unneeded — re-scope/retire it.
- **The smooth "clay / paint on paper" look = low-res base terrain.** `lib/elevation.js` sources the whole
  course from AWS Terrarium tiles at zoom 14 (~9.5 m/px SRTM) on a 5 m grid + SMOOTH_SIGMA=2, erasing every
  feature < ~20 m. Only hole 9 looks real because it's the one region built from **1 m 3DEP lidar**.
- **Authored-PBR materials are NOT the fix** (the user rejected re-confirming this; realism = terrain data +
  relief, per `golf-realism-research`).

## Current state
- Branch: `claude/musing-ritchie-ebb288` (already converged with `claude/hd-discovery-plan4`; has the realism
  code + 236 passing tests). Node ≥ 22 required.
- `BIRDIE_DATA_DIR` = `C:/Users/USER/Documents/GitHub/Open-Birdie/data` (gitignored; holds the cached course,
  aerial JPG, and HD bundles). Live course fingerprint `92067899d5e18c15efef72b38ed4a31f535e682a4b952bf823189601ee5d064f`
  **matches** the hole manifests, so builds work against `data/courses/chambers-bay.json`.
- HD bundles built so far: hole 9 (`516339c7…`) and **hole 8 (`ec0556e8…`, built this session)**. Both on
  disk at `data/hd-courses/chambers-bay/bundles/`. `active.json` currently points to **hole 8**.
- Proof the fix works: `.shots/h8-relief-compare.png` (coarse SRTM base vs new 1m lidar, hole 8 — smooth blob
  → real sculpted relief).

## The architecture constraint (the crux)
The engine renders **one** HD lidar patch at a time: `active.json` declares a single bundle, `server.js`
`activeHd` is singular, asset-serving + the readiness handshake key on one `bundleId`. BUT the terrain
*sampler already supports multiple patches* — `lib/elevation.js` tiered sampler ("base grid everywhere, with
high-res LIDAR patches") and `server.js` `game.activateRuntimeTerrain([...])` take an ARRAY. So "3D
everywhere" is mostly a wiring job, not a new renderer.

## The work (in order)
1. **Wire multi-patch HD** (the feature that delivers "all area"):
   - `lib/hd-bundle.js` `resolveHdBundle` → return ALL valid bundles for the course (scan
     `data/hd-courses/<slug>/bundles/`), not just `active.json`'s one.
   - `server.js` → `activeHd` becomes an array; pass every grid to `activateRuntimeTerrain`; make HD asset
     serving (`/api/hd-assets/*`, currently keyed to one `activeHd.bundleId`) handle multiple bundleIds; adapt
     the course-revision readiness handshake for N bundles.
   - Verify physics (`surfaceAt` / heights) and render show all patches; `npm test` stays green; add tests.
   - Use TDD (superpowers:test-driven-development) and brainstorm/plan first (this is a real feature).
2. **Batch-build the remaining holes at 1m.** For each hole N (do 10 first to finish the 8/9/10 trio, then
   1–7, 11–18): copy `tools/hd-course/manifests/chambers-bay-hole-08.json`, set `"hole": N` and
   `"discovered": {"state": "pending"}` (REQUIRED — else `HD_MANIFEST_INVALID`), then:
   ```
   BIRDIE_DATA_DIR=<data> node tools/hd-course/cli.mjs discover --manifest <m> --course <data>/courses/chambers-bay.json --write
   BIRDIE_DATA_DIR=<data> node tools/hd-course/cli.mjs build    --manifest <m> --course <data>/courses/chambers-bay.json
   ```
   Each build downloads ~285 MB NAIP + 3DEP lidar (~30s build) and RESETS `active.json` to that hole (the
   one-active design multi-patch fixes — so build first, then wire multi-patch, or expect active.json churn).
3. **Re-scope the plan docs** to this terrain work; retire/annotate the obsolete Phase-A reconstruction plan.

## Verify / show
- Tests: `npm test` (Node ≥ 22; below that `node --test` silently passes zero).
- Server: `BIRDIE_DATA_DIR=<data> BIRDIE_PORT=8233 BIRDIE_OC_PORT=9210 node server.js`; then
  `POST /api/load-course {"cached":"chambers-bay.json"}`, `GET /api/course-geometry`.
- WebGL screenshots are fiddly (need `toDataURL`+sink). A clean deterministic proof of relief is a
  **hillshade rendered straight from the bundle's `holes/NN/terrain.f32`** (raw f32 LE, nx×ny at cellM=1) —
  see how `.shots/h8-relief-compare.png` was generated this session.
- Alternative considered + rejected for now: course-wide 3DEP base in `lib/elevation.js` (cleaner "all area"
  including between-hole gaps, but it CHANGES `canonicalCourse`/`courseFingerprint` → invalidates existing HD
  bundles; the fingerprint-coupling gotcha). Per-hole multi-patch is the lower-risk path.

## Key files
`lib/elevation.js` (base terrain source + tiered sampler) · `lib/hd-bundle.js` (`resolveHdBundle`,
`courseFingerprint`, `canonicalCourse`) · `server.js` (`activeHd`, `activateCourse`, `activateRuntimeTerrain`,
HD asset serving, readiness) · `public/render/hd-terrain.js` + `scene.js` (`_hdPatch`) ·
`tools/hd-course/cli.mjs` + `manifests/` + `schemas/build-manifest.schema.json`.

Gotchas: new HD bundle or any `server.js` change ⇒ RESTART the server; client (`scene.js`) change ⇒ reload
the page. gstack update available (`/gstack-upgrade`), non-urgent.
