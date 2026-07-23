# Pro Visuals Program — Master Implementation Plan

> **How to use this document:** this is the program plan. Do not implement an entire phase directly from
> this file. Each `SP-*` phase becomes one detailed sub-plan, one branch, and normally one PR. The sub-plan
> must inspect the then-current code, run its diagnostic gate, name exact files and tests, and use the
> acceptance contract near the end of this document.

**Date:** 2026-07-23
**Status:** Engineering-reviewed; SP-00 authorized, later phases require their own reviewed sub-plan
**Design specification:** [`../specs/2026-07-23-pro-visuals-program-design.md`](../specs/2026-07-23-pro-visuals-program-design.md)
**Test strategy:** [`2026-07-23-pro-visuals-test-plan.md`](2026-07-23-pro-visuals-test-plan.md)
**Previous roadmap:** [`2026-07-06-reality-master-plan.md`](2026-07-06-reality-master-plan.md)

---

## 1. Program outcome

Deliver two milestones:

1. **M1 — Automatic Course Baseline:** artifact-free, course-aware, credible 5.5–6.5/10 output from normal
   OSM/elevation/aerial inputs.
2. **M2 — Curated Hero Course:** Chambers Bay at 7.5–8.5/10 through a reusable, versioned course-art pack.

The plan intentionally does not label M2 “TrackMan parity.” It builds the renderer, content pipeline, and
quality gates needed to move toward that target without pretending automatic open data can replace authored
course art.

**Approved scope posture (1A):** preserve the complete M1 + M2 roadmap, but authorize and implement only one
reviewed `SP-*` phase at a time. The current authorization is SP-00. This document is not approval to build
the remaining phases as one change.

---

## 2. Current state

### Main branch

- `main` is at `fe8e677`, after PR #39.
- P0a debug/UI gating is merged.
- P1b dry/tan course character is merged.
- The fixed Chambers capture fixture exists.
- The full test suite passes 301 tests.
- `scene.js` owns too much course construction and placement behavior.

### Unmerged work to recover

Remote branch `origin/claude/p2-sdf-surfaces` is 13 commits ahead of `main` and contains:

- Crisp `fwidth` green/fairway/bunker edge work.
- Green collar/apron treatment.
- Classmap/OSM precedence.
- Classmap dot-screen suppression.
- Updated shader tests.

Its final multi-course capture/documentation gate is incomplete. Its HD overview seam was correctly
re-diagnosed as a relief/far-photo boundary problem and deferred. The work should be integrated and verified,
not rewritten.

### Known highest-impact gaps

1. Puget Sound and world edge.
2. Surface material response and visible HD/far-photo boundaries.
3. Bunker and green-complex geometry.
4. Biome-correct vegetation, structures, and landmarks.
5. A reusable curated course-art format.
6. Committed capture/performance tooling.
7. Professional HUD hierarchy and release polish.

---

## 3. Dependency graph

```text
SP-00 Visual benchmark harness
  |
  +------> SP-01 Recover + merge P2a
  |
  +------> SP-02 CoursePresentation + activation + art-pack contract
               |
               +------> SP-03 World context
               |
SP-01 ---------+------> SP-04 Surface system + material response
               |
SP-04 ---------+------> SP-05 Terrain features
               |
SP-02 ---------+------> SP-06 Vegetation + landmarks
               |
               +------> SP-07a Course-art validation/CLI core

SP-03 + SP-06 + SP-07a ------> SP-07b renderer preview/package workflow

SP-03 + SP-04 + SP-05 + SP-06 ------> M1 Automatic Baseline gate

SP-03 + SP-05 + SP-06 + SP-07b ------> SP-08 Chambers hero-course pass

SP-08 ------> SP-09a HUD + SP-09b performance/package release lanes

SP-09a + SP-09b ------> M2 Curated Hero gate
```

Only SP-02's server/schema work may run beside SP-01. Both phases eventually touch `public/render/scene.js`,
so SP-02 renderer wiring waits for SP-01 to merge. SP-03 and SP-04 may develop isolated modules in parallel
after the CoursePresentation interface is stable, but their `scene.js`/configuration integration is
sequential. SP-05 must not start geometry implementation until SP-04 owns stable surface edges and
materials. The worktree strategy in section 22 is authoritative.

---

## 4. Phase index and schedule

Effort is focused engineering time and excludes review latency.

| ID | Sub-plan | Effort | Depends on | Primary milestone |
|---|---|---:|---|---|
| SP-00 | Visual benchmark harness and baseline | 3–5 d | — | Both |
| SP-01 | Recover, verify, and merge P2a | 2–4 d | SP-00 | M1 |
| SP-02 | CoursePresentation, identity/cache, activation, and art-pack contract | 9–14 d | SP-00 | Both |
| SP-03 | World context: coast, skirt, horizon | 4–7 d | SP-02 | M1 |
| SP-04 | Surface system, P2b light response, HD seam | 8–12 d | SP-01, SP-02 | M1 |
| SP-05 | Bunker, green, waste, and path terrain features | 10–15 d | SP-04 | M1/M2 |
| SP-06 | Biome vegetation, structures, landmarks, LOD | 8–12 d | SP-02, SP-03 | M1/M2 |
| SP-07a/07b | Course-art CLI core; renderer-backed preview/package workflow | 7–11 d | SP-02a; then SP-03, SP-06 | M2 |
| SP-08 | Chambers Bay curated hero-course content pass | 15–25 d | SP-03, SP-05, SP-06, SP-07b | M2 |
| SP-09a/09b | Pro HUD; quality profiles, packaging, release | 6–10 d | SP-08 | M2 |

Expected program bands:

- **M1:** about 8–13 focused weeks for one engineer, depending on terrain-feature diagnosis.
- **M2:** another 5–9 weeks with ready assets; longer for a solo engineer creating all art.
- **Full program:** approximately 3–6 calendar months of sustained work.

---

## 5. SP-00 — Visual benchmark harness and baseline

### Objective

Turn the current ad hoc render-capture procedure into a committed, deterministic developer tool before more
visual changes land.

### Why first

The program cannot distinguish improvement from camera, timing, cache, course-data, or post-processing drift
without a repeatable harness. Every later phase depends on evidence from this tool.

### Likely files

- `tools/visual-capture/cli.mjs`
- `tools/visual-capture/electron-runner.cjs`
- `tools/visual-capture/suites/*.json`
- `tools/visual-capture/report.mjs`
- `docs/fixtures/chambers-sweep.json`
- New Sawgrass, St Andrews, and fallback fixtures.
- A small committed synthetic course fixture for CI renderer smoke.
- `package.json`
- `test/visual-capture-config.test.mjs`
- `docs/visual-benchmark.md`

### Required tasks

1. **Task 0 — baseline gate**
   - Pin the machine, GPU, Electron, Node, capture resolution, pixel ratio, and quality settings.
   - Capture current `main` on Chambers, Sawgrass, and St Andrews.
   - Record async-ready conditions for course geometry, HD assets, classmaps, textures, and environment.
   - Confirm captures go through the real post-processing pipeline.
   - Define warm-up, sample duration, route, `renderer.info` reset point, and CPU-vs-GPU timing semantics.
2. **Extract the existing capture procedure**
   - Start an isolated server on a caller-selected port and data directory.
   - Launch a hidden Electron renderer.
   - Load a named cached course.
   - Wait for deterministic readiness rather than a fixed sleep alone.
   - Apply fixture poses and write image + JSON manifest outputs.
   - Shut down only processes started by the harness.
   - Support a committed synthetic fixture for CI and named local caches for full-course review.
3. **Add suite configuration**
   - Baseline suite covers play, close green, close bunker, overview, high overview, horizon, and UI.
   - Fixtures declare the viewing band and the visual feature being judged.
4. **Capture diagnostics**
   - Console warnings/errors.
   - Renderer geometry/texture/program counts.
   - Frame time sampling and object counts.
   - Course revision, commit SHA, configuration, and fixture hash.
   - Course/content revision, presentation tier, active feature flags, and unexpected typed diagnostics.
   - A capability probe for Electron, WebGL, timer-query support, and software rendering.
5. **Add comparison/report output**
   - Side-by-side HTML or Markdown contact sheet.
   - Pixel diff for change detection.
   - Human scorecard fields from the program specification.
6. **Document the workflow**
   - Exact commands.
   - Data-directory prerequisites.
   - How to add a course or frame.
   - What pixel diffs can and cannot prove.
   - Which checks run on ordinary CI and which require the named Windows GPU release machine.

### Tests

- Fixture schema accepts valid suites and rejects invalid poses/viewing bands.
- Harness fails clearly when the course cache is missing.
- The cache error names the exact command needed to create or hydrate that fixture.
- Readiness timeout reports the outstanding subsystem.
- Spawned process cleanup is scoped to recorded PIDs.
- One smoke capture completes with no page errors.
- Unsupported headless/WebGL environments emit an explicit capability artifact rather than silently passing.
- The release gate fails unless the required GPU-backed visual/performance suite actually ran.

### Exit criteria

- One command captures the baseline suite and writes a manifest.
- The command is repeatable with no manual browser interaction.
- Two consecutive runs with unchanged code are visually stable except documented nondeterminism.
- All later sub-plans can cite stored before/after directories and manifest files.

---

## 6. SP-01 — Recover, verify, and merge P2a

### Objective

Bring the useful work from `origin/claude/p2-sdf-surfaces` onto a current integration branch, complete its
verification, and merge it without hiding the deferred HD seam.

### Likely files

- `public/render/scene.js`
- `public/render/turf.js`
- `docs/fixtures/chambers-sweep.json`
- `test/hd-turf.test.mjs`
- `docs/TODO.md`
- `docs/HANDOFF.md`
- Existing P2a sub-plan recovered from the remote branch.

### Required tasks

1. **Task 0 — integration gate**
   - Compare `main...origin/claude/p2-sdf-surfaces`.
   - Rebase or cherry-pick onto a new `codex/` integration branch.
   - Resolve conflicts by preserving current `main` behavior outside P2a scope.
   - Run shader tests and the full suite before visual tuning.
2. **Run the fixed capture suite**
   - Chambers: verify crisp green/bunker edges and collar.
   - Sawgrass: verify lush palette and water remain correct.
   - St Andrews: verify rough OSM does not become sharply wrong.
3. **Inspect deferred HD seam**
   - Capture the exact high-overview frame with classmap and far-photo diagnostic toggles.
   - Record it as SP-04 input.
   - Do not broaden this PR into terrain-normal/LOD work.
4. **Close P2a documentation**
   - Mark completed tasks and the explicit deferred seam.
   - Record before/after evidence and test results.
5. **Create and merge one focused PR**
   - No opportunistic UI, world-context, or geometry work.

### Exit criteria

- P2a is on `main`, not stranded on an unreviewed branch.
- All fixed-course captures pass its near/play-range claims.
- The HD seam remains a visible, named SP-04 issue rather than a silent “done.”
- Full suite and capture smoke pass.

---

## 7. SP-02 — CoursePresentation, activation transaction, and art-pack contract

### Objective

Create the deep module that separates automatic reconstruction from curated presentation, commits a complete
course package atomically, removes course-name tuning from `GolfScene`, and gives browser assets a safe
runtime path.

### Likely files

- `lib/course-presentation.js`
- `lib/resolved-course-package.js`
- `lib/course-identity.js`
- `lib/hd-bundle.js`
- `tools/hd-course/course-source.mjs`
- `lib/course-art-assets.js`
- `public/render/course-presentation.js`
- `public/render/course-assets.js`
- `lib/schemas/course-art-pack.schema.json`
- `lib/generated/course-art-pack-validator.js`
- `tools/course-art/generate-validator.mjs`
- `courses/curated/README.md`
- `courses/curated/chambers-bay/references.json`
- `server.js`
- `lib/course.js`
- `public/render/course-character.js`
- `public/render/scene.js`
- `public/app.js`
- `main.js`
- `package.json`
- `test/course-presentation.test.js`
- `test/course-identity.test.js`
- `test/course-cache-identity.test.js`
- `test/hd-fingerprint.test.mjs`
- `test/course-art-pack-schema.test.js`
- `test/course-activation.test.js`
- `test/course-art-http.test.js`
- `test/course-load-race.test.mjs`
- `test/course-geometry.test.js`

### Required tasks

1. **Task 0 — interface spike**
   - Inventory every current course-specific knob and placement rule.
   - Build normalized example profiles for Chambers, Sawgrass, and an unknown course.
   - Prove one `resolveCoursePresentation` return object can drive current behavior without exposing internal
     shader uniforms or file paths.
   - Trace the current `activateCourse -> courseGeometry -> loadGeometry -> scene.loadCourse` flow and pin
     every revision, ownership, fallback, and cancellation boundary before extraction.
2. **Define stable course identity**
   - Persist `osm:<type>:<id>` for newly fetched courses.
   - Derive a geographic fallback for legacy caches.
   - Allow legacy aliases only when normalized name and origin tolerance both match.
   - Never select a pack by display name alone.
   - Key and verify new base-course caches by source identity rather than `slug(name)`.
   - Migrate a legacy name-keyed cache only after name + geographic verification.
   - Add HD fingerprint v2 without mutable display name; keep an explicit, tested v1 manifest
     compatibility path.
3. **Define and validate schema v1**
   - Character, world, atmosphere, materials, vegetation, landmarks, terrain-feature references.
   - Strict versioning and unknown-field behavior.
   - Registry-key or safe pack-relative asset references only.
   - Add finite-number, maximum-count, coordinate-envelope, texture-dimension, and total-byte limits.
   - Generate and commit a standalone validator from Ajv; keep Ajv development-only and fail tests when the
     generated validator is stale.
4. **Implement automatic and curated adapters**
   - Automatic adapter uses generic defaults and data-derived signals only; it contains no course-name map.
   - Curated adapter validates and overlays a pack.
   - Move the current manual Chambers `courseDry` value into the Chambers curated profile. Pack-disabled
     Chambers must not receive that manual value through a compatibility path.
   - Migrate legacy curated surface/pin sidecars into packs or a temporary curated-only compatibility
     adapter; pack-disabled automatic mode ignores them.
   - Missing/corrupt packs follow the specification’s fallback policy.
5. **Build the `ResolvedCoursePackage` prepare/commit transaction**
   - Allocate a server activation generation before `loadCourse()` begins.
   - Abort superseded acquisition where possible; only the latest generation may commit or broadcast.
   - Resolve HD bundles against the untouched base course.
   - Clone before applying overrides; preparation never mutates the active course.
   - Produce `courseId`, monotonic `courseRevision`, deterministic `contentRevision`, current ordered terrain
     patches, presentation, asset manifest, HD descriptors, and typed diagnostics.
   - Define terrain-feature capability metadata and empty-patch transport, but reject requested terrain
     features as unsupported until SP-05 registers the real compiler.
   - Commit active package and `game.setCourse` once; unexpected preparation failure keeps the prior course.
6. **Implement the active-package asset gateway**
   - Development root is `courses/curated`; packaged root is
     `process.resourcesPath/course-art` passed through `BIRDIE_ART_DIR`.
   - Serve only opaque keys from the active manifest through
     `/api/course-art/:contentRevision/:assetKey`; reject revision mismatches.
   - Enforce path containment, MIME/extension allowlists, byte limits, ETag/content revision, and no path
     disclosure.
   - Hash validated runtime asset bytes into the manifest so same-name asset replacement changes
     `contentRevision`.
7. **Add renderer load generations and asset ownership**
   - `public/app.js` aborts/invalidates older geometry/HD loads.
   - `GolfScene` and every async module callback reject stale revisions before attaching objects.
   - A reference-counted registry owns shared textures/models keyed by `contentRevision + assetKey`; modules
     release handles and dispose only their own geometry/materials.
8. **Migrate current character logic**
   - Preserve byte-equivalent Sawgrass behavior and curated-on Chambers palette behavior.
   - Remove direct course-name lookup from `GolfScene` and the automatic adapter.
9. **Add a minimal Chambers profile**
   - Only character/world intent at this phase.
   - No landmarks or visual claims that depend on later systems.
10. **Document authoring and errors**
   - Every validation error states pack, field, cause, and fix.
   - Define the versioned reference manifest and licensed hydration workflow.
   - Define typed diagnostic codes and which errors reject a pack, isolate a feature, or abort activation.

Tasks 2–6 are **SP-02a** and may be developed beside SP-01 because they avoid renderer integration.
Tasks 7–10 are **SP-02b** and begin only after SP-01 merges.

### Tests

- Unknown course selects automatic defaults.
- Chambers curated profile merges over automatic defaults.
- Missing pack is a silent automatic fallback.
- Corrupt selected pack yields one actionable diagnostic and automatic fallback.
- Unsupported version is rejected.
- Same-name/different-origin and renamed/same-identity cases cannot select the wrong pack.
- Pack-disabled mode cannot obtain manual dryness/biome values through a name map.
- Pack-disabled mode ignores a present legacy surface/pin sidecar.
- Same-name cache collisions cannot load the wrong base course.
- HD fingerprint v2 survives display-name changes; v1 manifests retain compatibility.
- Traversal/absolute asset paths are rejected.
- Oversized manifests, non-finite coordinates, excessive counts, and disallowed asset types are rejected.
- Invalid reference entries or entries without an explicit fetch/usage policy are rejected from hydration.
- Presentation-only changes do not change `courseFingerprint`.
- Accepted pack/gameplay changes update `contentRevision`.
- Same-key asset byte changes update both `contentRevision` and its asset URL.
- Failure during package preparation retains the prior active course and revision.
- Slow request A followed by fast request B cannot commit A after B.
- Asset HTTP tests cover exact key, unknown key, traversal, MIME, size, `HEAD`, ETag, and path non-disclosure.
- A delayed old course/texture load cannot replace or attach to a newer course.
- Repeated alternating loads settle at a stable resource baseline.
- Course switch cannot retain the previous course’s profile.

### Exit criteria

- Renderer construction reads normalized presentation rather than a manual course-name map.
- Neither renderer nor automatic adapter contains a per-course name map.
- Both adapters exercise the same external interface.
- Pack schema and fallback behavior are tested.
- Activation is atomic and revisioned.
- Curated assets load in development and from a packaged `extraResources` fixture.
- Rapid course switches cannot mix geometry, textures, diagnostics, or readiness acknowledgements.
- Existing visuals remain within the SP-00 baseline tolerance.

---

## 8. SP-03 — World context: coast, skirt, and horizon

### Objective

Remove the visible course-tile ending for every course and provide a coastal mode when trusted automatic or
curated coastline metadata exists.

### Likely files

- `public/render/world-context.js`
- `public/render/atmosphere.js`
- `public/render/env.js`
- `public/render/config.js`
- `public/render/scene.js`
- `lib/course-presentation.js`
- Chambers profile.
- `test/world-context.test.mjs`

### Required tasks

1. **Task 0 — sea-level and silhouette gate**
   - Verify Chambers elevation datum and coast bearing.
   - Compare a simple plane, radial ocean mesh, and context-skirt approaches in the fixed horizon frame.
   - Confirm no z-fighting or shoreline gap at all required cameras.
2. **Build `WorldContext` behind its interface**
   - Move coast/skirt/horizon decisions out of `scene.js`.
   - Add scoped lifecycle and disposal.
3. **Implement generic context skirt**
   - Extend or surround the base terrain far enough that fog owns the final transition.
   - Preserve course silhouette and avoid a flat tabletop horizon.
4. **Implement coastal mode**
   - Steel/pewter ocean material driven by presentation.
   - Correct level, direction, extent, and fog integration.
   - No simulation-grade wave work.
   - Treat the minimal Chambers profile as curated proof only; it cannot contribute to the M1 automatic score.
5. **Implement inland mode**
   - Skirt and atmosphere only.
   - Explicitly verify Sawgrass has no phantom sea.
6. **Add atmosphere presets**
   - Marine layer and generic clear/humid defaults.
   - Keep one sun/environment source of truth.
7. **Capture all world-edge frames**
   - Low camera, overview, high overview, and free-camera rotations.
   - Capture every M1 course with packs disabled, then capture Chambers once more with its curated coastal
     profile enabled.

### Tests

- Coastal profile builds ocean + skirt.
- Inland profile builds skirt only.
- Missing coast metadata does not infer a sea at low confidence.
- Invalid level/bearing falls back with a diagnostic.
- Course reload disposes prior world-context assets.
- Pack-disabled mode asserts `presentation.tier === "automatic"` and never reads a Chambers-specific value.

### Exit criteria

- No hard world edge is visible in any baseline frame.
- Curated-on Chambers reads as a coastal course with water in the correct direction.
- Pack-disabled Chambers still passes the automatic world-edge gate without claiming automatic coastline
  detection.
- Sawgrass and St Andrews do not gain incorrect coastal scenery.
- 1080p frame-time delta stays within budget.

---

## 9. SP-04 — Surface system, P2b light response, and HD seam

### Objective

Give turf and sand believable material response across viewing bands and remove the remaining HD/far-photo
boundary without damaging QL1 relief.

### Likely files

- New `public/render/surface-system.js`
- `public/render/turf.js`
- `public/render/scene.js`
- `public/render/hd-terrain.js`
- `public/render/config.js`
- `test/hd-turf.test.mjs`
- `test/surface-system.test.mjs`
- Benchmark fixtures.

### Required tasks

1. **Task 0 — three independent diagnostic gates**
   - **Light response:** prove detail normal/roughness and view-responsive mowing read at address/play distance.
   - **HD seam:** isolate geometry normal, relief LOD, aerial/far-photo, and material derivative contributions.
   - **Sampler budget:** record texture units and shader program variants before adding maps.
2. **Create the SurfaceSystem seam**
   - Move mask construction/material ownership out of `GolfScene` as touched.
   - Keep one small return interface: materials, masks, update, dispose, diagnostics.
   - Do not export raw shader uniforms to the orchestrator.
3. **Implement detail material response**
   - Surface-specific normal and roughness breakup.
   - Distance fade before sub-pixel shimmer.
   - Correct sRGB/NoColorSpace discipline.
4. **Convert mowing from paint toward light response**
   - Narrower course-appropriate bands.
   - Normal/roughness or anisotropic response, subject to Task 0.
   - Preserve links minimal-stripe and parkland visible-stripe behavior.
5. **Solve the HD seam at its diagnosed source**
   - Prefer normal/relief/material continuity over hiding the seam with more blur.
   - Preserve full QL1 macro landform.
   - Give the fix its own commit and capture evidence.
6. **Control shader complexity**
   - Pack maps or reuse procedural sources.
   - Pin program cache keys and shader test expectations.
   - Avoid a new material instance per patch.
7. **Cross-course tuning**
   - Chambers, Sawgrass, St Andrews at address, play, flight, and overview.

### Tests

- Macro/no-macro and HD/non-HD paths compile.
- Program keys change when shader source behavior changes.
- Data textures retain `NoColorSpace`.
- Surface system disposal releases owned textures.
- Shared material remains consistent across coarse/HD meshes.
- Screenshot smoke shows no WebGL compile or texture-unit errors.

### Exit criteria

- Turf/sand read as materials, not flat color masks, at address/play distance.
- Grooming does not shimmer or dominate overview.
- No visible rectangular HD/far-photo seam in required overview frames.
- QL1 landform and physics sampler are unchanged.
- Performance budget passes or expensive options ship in a documented higher quality profile.

---

## 10. SP-05 — Bunker, green, waste, and path terrain features

### Objective

Make the money surfaces structurally believable while guaranteeing renderer/physics height parity.

### Likely files

- `lib/terrain-features.js`
- `public/render/terrain-features.js`
- `public/render/scene.js`
- `public/render/terrain-grid.js`
- `lib/elevation.js`
- Course-art schema and Chambers feature data.
- `test/terrain-features.test.js`
- `test/terrain-feature-parity.test.mjs`

### Required tasks

1. **Task 0 — LiDAR truth gate**
   - Measure representative Chambers/Sawgrass bunker and green profiles from the actual height grids.
   - Decide separately whether bunkers, green tiers, and run-offs need geometry, material, or authored-data work.
   - Do not carve a generic recess where LiDAR already contains correct relief.
2. **Define shared feature representation**
   - Surface reference or polygon.
   - Operation/preset.
   - Parameters with safe clamps.
   - Provenance and confidence.
   - Versioned serialization in the art pack.
3. **Implement the deep TerrainFeatures module**
   - Compile authored/automatic features once on the server into bounded, ordered height patches plus
     render descriptors.
   - Reuse the existing terrain-patch representation already consumed by `lib/elevation.js` and
     `public/render/terrain-grid.js`; do not write a browser feature compiler.
   - Serialize explicit priority so an authored modifier overrides measured HD relief only when the feature
     opts into that behavior.
4. **Bunkers**
   - Recess/lip only when required by diagnosis.
   - Ragged waste vs crisp bunker edge treatment.
   - Sand normal/roughness without visible weave.
   - Grass-overhang or edge cards only after geometry is stable.
5. **Green complexes**
   - Preserve LiDAR slope.
   - Collar and run-off transitions use SP-04 masks/materials.
   - Add tiers only from measured terrain or curated feature data.
6. **Paths and terrain-attached edges**
   - Drape paths with stable offset and grounding.
   - Avoid z-fighting and floating on HD boundaries.
7. **Physics parity**
   - Ball rest height, slope, and surface lookup agree with visible terrain.
   - Putting regression suite remains green.

### Tests

- Deterministic compilation from feature JSON.
- Safe parameter clamps and malformed-feature diagnostics.
- Server/browser height and gradient parity from the same serialized patches at feature samples.
- Patch ordering is stable and overlap priority is tested.
- No change outside feature influence.
- Bunker ball height sits below lip only when a modifier is enabled.
- Course without feature data remains byte-equivalent in physics.

### Exit criteria

- Required close bunker and green frames show believable geometry and transitions.
- No ball, pin, prop, or vegetation floats/sinks on modified terrain.
- Automatic mode does not invent aggressive geometry on unknown courses.
- Curated geometry can be removed cleanly by removing the art pack.

---

## 11. SP-06 — Biome vegetation, structures, landmarks, and LOD

### Objective

Replace generic procedural scattering with course-character-aware composition and a scalable asset/LOD
pipeline.

### Likely files

- `public/render/vegetation-landmarks.js`
- `public/render/tree-cards.js`
- `public/render/vegetation.js`
- `public/render/grass.js`
- `public/render/props.js`
- `public/render/assets.js`
- Building code extracted from `public/render/scene.js`.
- Course presentation/art-pack files.
- `test/vegetation-placement.test.mjs`
- `test/asset-registry.test.mjs`

### Required tasks

1. **Task 0 — density/LOD budget**
   - Capture object counts and frame time for current vegetation.
   - Compare near cards, mid impostors, and a far forest-wall approach.
   - Select a default budget before increasing density.
2. **Create VegetationLandmarks seam**
   - Move placement rules and lifecycle out of `GolfScene`.
   - Preserve deterministic seeds.
3. **Biome-aware automatic placement**
   - Links: suppress generic interior trees; emphasize scrub/fescue and rim vegetation.
   - Parkland: retain dense interior tree logic with water/green/fairway exclusions.
   - Unknown: conservative generic fallback.
4. **Near/mid/far LOD**
   - Near cards/models, mid impostors, far wall/silhouette.
   - No white fringes, visible popping, or repeated cone rhythm.
5. **Structures**
   - Move OSM extrusion behind the module.
   - Improve roof profiles/material variation where source data permits.
   - Add robust grounding and distance LOD.
6. **Landmark/prop placement**
   - Registry-backed authored assets.
   - Paths, fences, walls, rocks, rail lines, and course furniture.
   - Exclusion zones and grounding shared with automatic placement.
7. **Asset provenance and packaging**
   - Processed asset registry.
   - License/provenance record.
   - Offline packaging verification.

### Tests

- Same inputs/seed produce identical placements.
- Exclusions prevent vegetation in water, bunkers, greens, paths, and buildings.
- Links and parkland profiles produce materially different placement statistics.
- Missing asset identifies pack/key/path and disables only that placement.
- Reload clears old course instances.
- LOD selection honors distance and quality profile.

### Exit criteria

- Chambers has a treeless interior, lone/signature trees where authored, and a continuous believable rim.
- Sawgrass retains lush parkland density.
- Buildings no longer read as identical dollhouse blocks in the required frames.
- No visible cloning rhythm or vegetation invasion in acceptance captures.
- Performance and resource-loop tests pass.

---

## 12. M1 — Automatic Course Baseline gate

M1 is not a coding phase. It is a stop-and-assess gate after SP-03 through SP-06.

Required evidence:

- Full capture matrix for Chambers, Sawgrass, St Andrews, and a missing-data fixture.
- Weighted rubric score of 5.5–6.5/10 on each real course.
- All hard visual gates pass.
- 1080p performance budget passes.
- No manual art pack is required for those baseline scores.
- The harness disables all curated packs and asserts `presentation.tier === "automatic"` in every M1
  manifest.
- Known gaps are classified as curated-content work, not unacknowledged renderer defects.

If M1 fails:

- Renderer/systemic failures return to the owning SP phase.
- Course-specific identity gaps go to SP-08.
- Do not compensate for systemic failures with Chambers-only art.

---

## 13. SP-07a/07b — Course-art validation and authoring workflow

### Objective

Make curated course work reproducible and safe enough that another developer can author a course without
editing renderer code. The data/CLI core lands before the visual modules; renderer-backed preview and
packaging wait for the world and vegetation consumers they exercise.

### Likely files

- `tools/course-art/cli.mjs`
- `tools/course-art/validate.mjs`
- `tools/course-art/preview.mjs`
- `tools/course-art/hydrate-references.mjs`
- `courses/curated/README.md`
- `courses/curated/chambers-bay/*`
- `lib/schemas/course-art-pack.schema.json`
- `package.json` (`build.extraResources` copies validated runtime packs outside ASAR).
- `main.js` (`BIRDIE_ART_DIR` points at `process.resourcesPath/course-art` in packaged builds).
- `test/course-art-cli.test.mjs`
- `test/course-art-packaging.test.mjs`

### SP-07a — Validation, transforms, references, and staging

Depends on SP-02a. It does not claim live preview of a feature whose renderer module does not exist yet.

1. **Validation CLI**
   - Schema, asset existence, coordinate range, finite values, count/byte/dimension limits, feature
     references, duplicate IDs, course identity, and version checks.
2. **Coordinate helpers**
   - Convert registered aerial pixels/geo coordinates to local sim coordinates using existing transforms.
   - Emit review overlays/coordinates without requiring unfinished renderer consumers.
3. **Pack diff/report**
   - List changed profile fields, placements, assets, and terrain features.
   - Generate capture suite for affected areas.
4. **Reference manifest and hydration**
   - Store source URL, licensing note, feature/view tags, and target camera metadata.
   - Fetch only sources that the manifest permits; keep hydrated images in the ignored reference directory.
   - Report unavailable sources without making normal course play depend on the network.
5. **Prepare runtime data**
   - Add a deterministic `prepare:course-art` step that validates, hashes, and stages only runtime files
     under a generated package directory.
   - Reject pack sections whose runtime capability is not yet registered; do not fake their preview.

### SP-07b — Renderer-backed preview, reuse proof, and packaging

Depends on SP-03 and SP-06, plus SP-07a. If preview includes terrain features, that part also depends on
SP-05.

1. **Task 0 — minimum workflow gate**
   - Author one coast setting, one vegetation exclusion, and one landmark without editing renderer code.
   - Reload/preview the change in under 30 seconds.
   - If JSON-only iteration is too slow or error-prone, add the smallest preview helper that fixes it.
2. **Preview/reload workflow**
   - Load the selected pack through the real active-package route.
   - Jump to a fixture camera or landmark.
   - Surface diagnostics in console and report output.
3. **Prove reuse**
   - Build a small second pack containing at least one profile override and one placement.
   - No Chambers-specific condition in the loader.
4. **Document authoring**
   - Start-to-preview walkthrough.
   - Provenance/licensing.
   - Common diagnostics and fixes.
5. **Package runtime data**
   - Copy that generated directory, never raw `courses/curated`, through Electron Builder
     `extraResources`.
   - Exclude hydrated reference photography and authoring-only intermediates.
   - Verify `BIRDIE_ART_DIR`, active-package HTTP delivery, offline launch, and package size manifest.

### Exit criteria

- Another developer can validate, preview, capture, and package a course-art change from documented commands.
- Bad content cannot silently corrupt another course.
- A second pack proves the seam is generic.
- Packaged Electron app includes selected curated assets and works offline.
- Packaged runtime data is outside ASAR, while authoring references and unvalidated files are absent.

---

## 14. SP-08 — Chambers Bay curated hero-course content pass

### Objective

Use the completed systems and authoring workflow to make Chambers Bay recognizable and competitive with a
strong GSPro course at the project’s fixed cameras.

### Work packages

This phase may be split into separate sub-plans/PRs if asset work and code fixes can remain independent:

1. **SP-08a — Surrounding geography**
   - Puget Sound tuning, shoreline, distant land, quarry/rail corridor, skyline.
2. **SP-08b — Playing surfaces**
   - Corrected green/fairway/bunker/waste boundaries and feature metadata.
   - Signature bunker/green-complex tuning.
3. **SP-08c — Vegetation composition**
   - Interior exclusions, rim forest, Lone Fir, scrub/fescue bands.
4. **SP-08d — Structures and landmarks**
   - Clubhouse/ruins/rail/fences/paths/hero props.
5. **SP-08e — Atmosphere and final material grade**
   - Marine haze, palette, wet/dry response, exposure, final course-specific tuning.

### Required process

- Establish a reference board per work package from the existing 106-photo library.
- Every authored feature has provenance and a fixture camera.
- Renderer defects discovered during content authoring return to their owning module in a separate commit/PR.
- Do not add course-name `if` statements to renderer modules.
- Maintain a visible “remaining mismatch” list after each work package.

### Exit criteria

- Weighted Chambers score reaches 7.5–8.5/10.
- All signature identity checks in the specification pass.
- Sawgrass and St Andrews automatic captures remain unregressed.
- Removing the Chambers pack produces the valid M1 automatic baseline.

---

## 15. SP-09a/09b — Professional HUD and release train

### Objective

Turn the hero-course result into a shippable simulator presentation rather than a screenshot-only demo,
without coupling a subjective UI redesign to performance and packaging correctness.

### Likely files

- `public/index.html`
- `public/style.css`
- UI state/render modules.
- `public/render/config.js`
- New quality-profile module.
- Benchmark scripts.
- `electron-builder` packaging configuration.
- UI and packaging tests.

### SP-09a — Professional HUD

1. **Task 0 — information hierarchy test**
   - Compare current HUD against fixed simulator-use scenarios: address, shot result, putting, menu, free camera.
   - Identify which cards can collapse, darken, or move without harming play.
2. **Professional HUD pass**
   - Compact dark/translucent treatment.
   - Strong lie/distance/score hierarchy.
   - Less rounded-card visual noise.
   - Preserve accessibility and projector readability.
3. **HUD verification**
   - Simulator-distance/projector readability.
   - Address, result, putting, menu, and free-camera interaction coverage.
   - Run `/plan-design-review` before implementation because this is user-facing visual design.

### SP-09b — Quality profiles, packaging, and release

1. **Quality profiles**
   - `sim-1080`, `sim-4k`, and `creator`.
   - Feature budgets and defaults owned in one module.
2. **Performance tuning**
   - Scripted route on hero and parkland courses.
   - 1% low and course-switch resource-loop gates.
3. **Packaging**
   - Curated asset inclusion.
   - Offline launch.
   - Clear missing-pack and unsupported-GPU diagnostics.
4. **Release capture**
   - Final gameplay, result, overview, green, bunker, and free-camera frames.

SP-09a and SP-09b may run in separate worktrees after SP-08 because they touch different primary modules.
Merge both, rerun the combined visual/performance/package suite, and only then enter M2.

### Exit criteria

- HUD looks intentional at the simulator projection distance and does not obscure play.
- Performance profiles meet their budgets or document hardware-specific reductions.
- Packaged app loads Chambers curated and automatic fallback offline.
- Full tests, visual suite, performance suite, and packaging smoke pass.

---

## 16. M2 — Curated Hero gate

Required sign-off:

- Chambers weighted score 7.5–8.5/10.
- All hard gates pass.
- Fixed side-by-side review against real photos and official GSPro/TrackMan references.
- No renderer course-name conditions.
- Second art pack proves generic loading.
- `npm test`, visual smoke, performance, resource-loop, and packaged offline smoke pass.
- Known differences from TrackMan are documented as future roadmap items, not hidden.

---

## 17. Sub-plan authoring contract

Every detailed sub-plan created from an `SP-*` item must contain the following sections.

### Header

- Parent specification and master-plan links.
- Target branch and base commit.
- Named owner/module.
- Estimated effort.
- Dependencies and required prior phase state.

### 1. Outcome

- One observable user-facing result.
- Viewing bands affected.
- Courses/frames used for proof.

### 2. What already exists

- Current implementation, exact files/functions, existing tests, and reusable modules.
- Prior commits/branches that should be recovered rather than duplicated.

### 3. Scope and non-scope

- Explicit inclusions.
- Explicit exclusions.
- Features intentionally deferred to another `SP-*`.

### 4. Task 0 diagnostic gate

- Hypothesis being tested.
- Cheapest A/B or measurement that can falsify it.
- GO, CHANGE, and NO-GO outcomes.
- Which tasks disappear or change under each outcome.

### 5. Architecture

- Module, interface, seam, and adapter decisions.
- Data ownership and lifecycle.
- Course/content revision behavior and stale-async cancellation where applicable.
- Asset ownership: who creates, shares, releases, and disposes each GPU resource.
- ASCII dependency diagram.
- Disposal/error/fallback behavior.
- No new seam unless at least two adapters or behaviors justify it.

### 6. Implementation tasks

Each task names:

- Exact files.
- Exact behavior.
- Tests written first or alongside.
- Capture/performance evidence.
- Expected commit boundary.
- Rollback or feature flag.

Tasks should normally fit within one focused commit and one developer session.

### 7. Test diagram

Map each new codepath to:

- Pure unit test.
- Contract/schema test.
- Renderer smoke.
- Physics parity where applicable.
- Visual frame.
- Performance/resource check where applicable.
- User-visible failure/recovery state.

Start from the program test strategy linked in the header and copy only the paths owned by the phase. Every
branch in the phase diagram must name a test file, input, assertion, and required execution environment.

### 8. Failure modes

- Error/rescue behavior.
- Missing/corrupt data behavior.
- Cross-course leakage.
- Performance fallback.
- Known unresolved risk.
- Whether each failure is visible, typed, recoverable, and covered by a test.

### 9. Acceptance

- Before/after frame names and expected visible change.
- Hard-gate checks.
- Cross-course controls.
- Test commands and expected result.
- Documentation updates.

### 10. Done record

After implementation, append:

- Commits and PR.
- Actual test counts.
- Capture artifact locations.
- Performance before/after.
- Resource counts/asset bytes and measurement environment when the phase touches rendering.
- Deviations from the plan.
- Follow-ups routed to specific `SP-*` phases.

---

## 18. Reusable sub-plan prompt

Use this prompt when starting any phase:

```text
Create the detailed implementation sub-plan for SP-XX from:
- docs/superpowers/specs/2026-07-23-pro-visuals-program-design.md
- docs/superpowers/plans/2026-07-23-pro-visuals-master-plan.md

Inspect the current branch and the exact files named by SP-XX; do not rely only on the master plan.
Recover relevant prior branch work instead of reimplementing it.

The sub-plan must follow section 17's authoring contract:
- current implementation and reusable behavior
- explicit scope/non-scope
- Task 0 falsification gate
- deep-module interface and dependency diagram
- small commit-sized tasks with exact files
- complete test diagram
- visual frames and cross-course controls
- performance/resource checks
- failure modes, rollback, and done record

Do not implement from the master plan. Produce the reviewed sub-plan first.
```

---

## 19. Standing implementation rules

- One sub-plan and normally one PR per `SP-*` phase.
- A phase may split only along a real module/content seam.
- Start every uncertain visual thesis with a Task 0 diagnostic.
- Never claim realism improvement without fixed before/after captures.
- Verify Chambers plus at least one control course in every renderer PR.
- Height-changing visuals must share physics height.
- Presentation-only fields must not invalidate HD fingerprints.
- Curated content matches stable course identity; display name alone is never authoritative.
- Course preparation commits atomically and stale asynchronous work is revision-gated and disposed.
- The server compiles height modifiers once into patches consumed by both physics and browser sampling.
- Browser assets come only from the active-package allowlist; filesystem paths never cross the API.
- Optional data must degrade safely and diagnose clearly.
- Preserve feature flags until milestone acceptance.
- No unrelated rewrite of `scene.js`; extract behavior only as its phase touches it.
- Every new asset has provenance, license, processed size, and LOD decision.
- Every quality profile has explicit draw-call, texture/geometry, resident-byte, and reflection budgets.
- `npm test` stays green; shader changes update program-cache tests.
- Update `docs/TODO.md` and `docs/HANDOFF.md` in the same PR.

---

## 20. Priority and cut order

If time or budget tightens:

### Must keep for M1

- SP-00 through SP-06.
- World-edge removal.
- Surface artifacts and HD seam.
- Physics-correct bunkers/greens where diagnosis requires changes.
- Biome-correct vegetation.
- Performance and regression gates.

### May reduce for M1

- Number of vegetation archetypes.
- Complex authored structures.
- Path/fence variety.
- 4K optimization beyond a safe profile.

### Must keep for M2

- Reusable art-pack contract and validation.
- Chambers identity geography and signature surfaces.
- Offline packaging.
- Second-pack proof.

### Cut first

- Full graphical authoring editor.
- Animated ocean.
- Dynamic weather/time of day.
- Geometry grass beyond the address band.
- Non-signature furniture.
- Cinematic camera features unrelated to normal play.

---

## 21. Immediate next action

Execute the engineering-cleared detailed sub-plan:
`docs/superpowers/plans/2026-07-23-sp00-visual-benchmark.md`.

While SP-00 is being reviewed, prepare the next two sub-plans with an explicit integration boundary:

- **SP-01:** integrate `origin/claude/p2-sdf-surfaces`.
- **SP-02a:** define/test identity, schema, activation, and asset-delivery contracts without renderer wiring.

SP-02b renderer wiring begins only after SP-01 merges because both touch `public/render/scene.js`.

Do not begin new visual tuning on `main` before SP-00 pins the baseline. Otherwise the program will continue
producing persuasive screenshots without reproducible acceptance evidence.

---

## 22. Engineering review decisions

The 2026-07-23 `/plan-eng-review` used scope posture **1A**: preserve the complete roadmap, authorize one
reviewed phase at a time, and automatically select the reviewer’s recommended complete option.

### Resolved findings

| Area | Finding | Resolution |
|---|---|---|
| Architecture A1 | A display name is not a stable identity for packs, caches, or HD compatibility. | Persist OSM identity, key/verify caches by it, and add a name-independent fingerprint v2 with v1 compatibility. |
| Architecture A2 | Activation could partially mutate state before all content is valid. | Prepare an immutable `ResolvedCoursePackage`, then commit once. |
| Architecture A3 | Curated browser assets had no safe versioned delivery or packaged-location contract. | Revision-addressed active-package HTTP allowlist + content hashes + Electron Builder `extraResources`. |
| Architecture A4 | “Same representation on server/browser” risked two terrain-feature compilers or an early placeholder. | SP-02 transports empty patches/capabilities; SP-05 compiles once into patches consumed by both samplers. |
| Architecture A5 | Server acquisition and client course/texture loads can finish after a newer selection. | Latest-only generations on both sides + revision guards + stale-result disposal. |
| Architecture A6 | Curated Chambers coast evidence could accidentally count toward automatic M1. | Disable packs and assert automatic tier for every M1 capture. |
| Architecture A7 | Optional fallbacks and core activation failures lacked one error policy. | Typed diagnostics; pack fallback, feature isolation, or transaction abort by stage. |
| Architecture A8 | Manual name maps or legacy sidecars could survive inside the “automatic” path. | Move them into curated packs; pack-disabled automatic mode ignores identity special cases and sidecars. |
| Code quality C1 | `scene.js` is already a 1,300+ line integration hotspot. | Extract only the module touched by each phase; keep `GolfScene` as lifecycle orchestrator. |
| Code quality C2 | Shared textures can be double-disposed or leaked by module-local cleanup. | Reference-counted asset handles; modules dispose only resources they own. |
| Code quality C3 | Runtime Ajv would rely on a development-only dependency. | Commit an Ajv standalone validator and test that generated code is current. |
| Code quality C4 | SP-01/SP-02 and SP-03/SP-04 were described as more parallel than their modules allow. | Parallelize isolated core work; serialize `scene.js` and configuration integration. |
| Code quality C5 | HUD design, performance tuning, and packaging made one oversized final PR. | Split SP-09a HUD from SP-09b quality/package/release, then run a combined gate. |
| Tests T1–T12 | Identity, atomic activation, validator freshness, asset security, stale loads, diagnostic visibility, shared-patch parity, tier isolation, GPU capability, resource steady state, packaged offline assets, and combined release coverage were underspecified. | All twelve paths are explicit in the linked test strategy and phase requirements. |
| Performance P1 | FPS targets lacked warm-up, duration, and CPU/GPU measurement semantics. | SP-00 pins route, warm-up, duration, hardware, CPU interval, and optional GPU query. |
| Performance P2 | Frame budgets did not cap content scale. | Quality profiles cap draw calls, resources, bytes, instances, reflections, and texture dimensions. |
| Performance P3 | A literal zero after disposal is not a valid Three.js leak expectation. | Compare repeated loads against a settled `renderer.info` baseline. |
| Performance P4 | Headless/software WebGL could produce misleading release numbers. | Capability artifact on normal CI; required GPU-backed run on the named release machine. |

### Outside voice reconciliation

The direct Codex outside-review command timed out after five minutes. A fresh read-only fallback reviewer
found five substantive gaps; all five were accepted:

1. Automatic mode also disables legacy curated surface/pin sidecars.
2. Latest-only generation begins before server-side `loadCourse()`, not only in the renderer.
3. Stable identity now governs cache lookup and HD fingerprint v2, with explicit v1 compatibility.
4. Course-art URLs include `contentRevision`, and revision hashes include runtime asset bytes.
5. SP-07 is split: CLI/data core can start after SP-02a; live coast/vegetation/landmark preview waits for
   SP-03 and SP-06, plus SP-05 when terrain features are previewed.

There is no remaining cross-model tension; the outside findings strengthened the selected architecture
without changing scope posture 1A.

### What already exists

| Existing code/flow | Reuse decision |
|---|---|
| `server.js activateCourse()` resolves HD before surface overrides and increments `courseRevision`. | Preserve its ordering, but move preparation before a single atomic commit. |
| `lib/hd-bundle.js` provides canonical fingerprinting and safe bundle-relative path helpers. | Reuse fingerprint and path-safety patterns; do not mix presentation into the HD fingerprint. |
| `lib/course.js` already applies curated surface/pin overrides before physics and browser geometry. | Reuse the overlay concept inside the package transaction; do not build a second override path. |
| `public/render/terrain-grid.js` and `lib/elevation.js` already have sampler-parity tests. | Reuse their shared patch representation for terrain features. |
| `public/app.js` already validates HD `courseRevision` and acknowledges readiness. | Extend the revision gate to the full geometry/asset load instead of inventing another readiness channel. |
| `scene.js loadCourse()` already traverses and disposes course geometry/materials/textures. | Keep lifecycle ownership while modules adopt explicit handles and stable-baseline leak tests. |
| Current render modules cover atmosphere, water, HD terrain, macro tint, grounding, vegetation, props, and post-processing. | Compose/extract them; do not replace the renderer wholesale. |
| `origin/claude/p2-sdf-surfaces` contains tested surface-edge work and the HD-seam diagnosis. | Recover and verify it in SP-01; do not reimplement it. |
| The Node test runner and 301-test suite already cover HD, physics, surface, cache, and shader contracts. | Extend the same framework; add Electron/GPU checks only where integration requires it. |

### NOT in scope

- **Renderer replacement or engine migration:** Three.js remains capable; the problem is content, ownership,
  and world/surface architecture.
- **Automatic TrackMan-quality reconstruction for every OSM course:** open data cannot supply consistent
  hero landmarks and authored terrain detail.
- **Automatic coastline inference in M1:** only trusted data may create a sea; curated coastline proof is M2
  evidence until a separate high-confidence source passes controls.
- **Dynamic weather, time of day, or simulation-grade ocean:** expensive breadth that does not unblock the
  fixed hero-course target.
- **Full graphical course editor:** v1 uses validated data plus preview/reload; editor value is reassessed
  after two packs.
- **Downloading copyrighted reference imagery into the product:** manifests may hydrate allowed references
  locally, but runtime packages contain only licensed assets.
- **Cross-platform release expansion:** the current product and packaging gate remain Windows-first; other
  platforms require their own packaging/performance plan.
- **New network service or cloud asset CDN:** curated assets remain local/offline for this program.

### Required inline diagrams during implementation

- `server.js` or `lib/resolved-course-package.js`: prepare/commit activation transaction and rollback edge.
- `public/app.js`: revision/abort state machine for overlapping `loadGeometry()` calls.
- `public/render/scene.js`: `CourseBuildContext` ownership and stale-callback disposal path.
- `public/render/course-assets.js`: registry acquire/release ownership and final GPU disposal.
- `lib/terrain-features.js`: authored feature -> ordered patch -> physics/browser sampler pipeline.

### Worktree dependency table

| Step | Modules touched | Depends on |
|---|---|---|
| SP-00 | `tools/visual-capture/`, fixtures, test harness | — |
| SP-01 | `public/render/`, shader tests, capture fixtures | SP-00 |
| SP-02a | `lib/`, schemas, server HTTP, package data contract | SP-00 |
| SP-02b | `public/app.js`, `public/render/`, server integration | SP-01 + SP-02a |
| SP-03 core | world/atmosphere render modules | SP-02b |
| SP-04 core | surface/terrain render modules | SP-01 + SP-02b |
| SP-03/04 integration | `public/render/scene.js`, render configuration | both core branches |
| SP-05 | terrain compiler, physics/browser patch consumers | SP-04 integration |
| SP-06 | vegetation/landmark modules and asset registry | SP-02b + SP-03 integration |
| SP-07a | course-art validation CLI, transforms, references, runtime staging | SP-02a |
| SP-07b | live preview, second-pack proof, packaging integration | SP-03 + SP-06 + SP-07a; SP-05 for terrain preview |
| SP-08a–e | curated pack content by subsystem | SP-03 + SP-05 + SP-06 + SP-07b |
| SP-09a | UI/interaction modules and CSS | SP-08 |
| SP-09b | quality profiles, benchmark, packaging | SP-08 |
| M2 gate | combined renderer, UI, performance, packaged app | SP-09a + SP-09b |

Parallel lanes:

```text
After SP-00:
  Lane A: SP-01 --------------------------+
  Lane B: SP-02a -------------------------+--> SP-02b integration

After SP-02b:
  Lane C: SP-03 core --+
  Lane D: SP-04 core --+--> sequential scene/config integration --> SP-05
  Lane E: SP-07a ---------------------------------------------+

After world/surface contracts:
  Lane F: SP-06 ----------------------------------------------+
  Lane G: SP-05 ----------------------------------------------+--> M1
  Lane J: SP-07b (after SP-03 + SP-06; terrain preview after SP-05) --> SP-08

After SP-08:
  Lane H: SP-09a HUD --+
  Lane I: SP-09b release +--> combined M2 gate
```

Conflict flags:

- SP-01 and SP-02b both touch `public/render/scene.js`; merge SP-01 first.
- SP-03 and SP-04 may build new modules in parallel, but their `scene.js` and config wiring is sequential.
- SP-05 and SP-06 can develop core modules independently; coordinate final terrain/exclusion integration.
- SP-08 work packages may edit the same pack manifests and capture suites; assign one manifest integrator.

### Review evidence

- Three.js requires explicit disposal of geometries, materials, and textures; shared resources need an
  ownership policy, and `renderer.info` is the supported resource diagnostic:
  [Three.js disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html).
- Ajv supports committed standalone validation code so packaged runtime validation does not require Ajv:
  [Ajv standalone validation](https://ajv.js.org/standalone.html).
- Electron Builder recommends `extraResources` for runtime data outside ASAR and exposes it under the
  platform resources directory:
  [Electron Builder application contents](https://www.electron.build/docs/contents/).

### Completion summary

- Step 0 Scope Challenge: **1A accepted** — full program retained; one reviewed phase authorized at a time.
- Architecture Review: **8 issues found and resolved**.
- Code Quality Review: **5 issues found and resolved**.
- Test Review: **diagram produced; 12 gaps converted to requirements**.
- Performance Review: **4 issues found and resolved**.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: no separate deferred TODOs; every valuable item belongs to a named `SP-*` phase.
- Failure modes: no silent unhandled critical gap remains in the reviewed plan.
- Outside voice: fallback reviewer ran; 5/5 findings accepted, no tension remains.
- Parallelization: 10 logical lanes; core-module work parallel, shared integration sequential.
- Lake Score: **18/18 complete recommendations selected**.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | Not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | ISSUES FOUND | Direct run timed out; fallback found 5, all 5 incorporated |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 29 issues, 0 critical gaps, 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | Required before SP-09a, not before SP-00 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | Optional before SP-07b |

**CODEX:** The direct outside command timed out; its fresh fallback reviewer found five gaps, all incorporated.

**CROSS-MODEL:** Both reviews agree on the final architecture; no tension remains.

**UNRESOLVED:** 0.

**VERDICT:** ENG CLEARED — ready to author SP-00. The program is not authorization to implement later
phases without their own reviewed sub-plan.
