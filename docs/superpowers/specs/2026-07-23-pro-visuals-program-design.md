# Pro Visuals Program — Design Specification

**Date:** 2026-07-23
**Status:** Engineering-reviewed; scope posture 1A accepted
**Owner:** Open-Birdie renderer
**Execution plan:** [`../plans/2026-07-23-pro-visuals-master-plan.md`](../plans/2026-07-23-pro-visuals-master-plan.md)
**Test strategy:** [`../plans/2026-07-23-pro-visuals-test-plan.md`](../plans/2026-07-23-pro-visuals-test-plan.md)
**Builds on:** [`../plans/2026-07-06-reality-master-plan.md`](../plans/2026-07-06-reality-master-plan.md)

---

## 1. Decision summary

Open-Birdie will pursue two explicit visual-quality tiers:

1. **Automatic Course Baseline (ACB):** every supported open-data course loads without manual art and
   reaches a consistent, artifact-free **5.5–6.5/10** visual band.
2. **Curated Hero Course (CHC):** selected courses add a versioned course-art pack and reach a
   **7.5–8.5/10** band. Chambers Bay is the first hero course.

TrackMan Virtual Golf 3 parity is a direction, not the first release gate. TrackMan's course library is
LiDAR-scanned and manually rendered by an in-house team; GSPro's course quality similarly depends on a
large course-authoring ecosystem. Open-Birdie cannot honestly promise equivalent output from OSM, 3DEP,
and aerial imagery alone.

The program therefore treats **automatic reconstruction** and **course authoring** as separate product
capabilities sharing one renderer.

---

## 2. Problem

The current renderer has a strong data foundation:

- Real course routing and surface polygons from OSM.
- Course-wide elevation, including 1 m 3DEP data where available.
- Multiple HD terrain patches with physics parity.
- Course aerial registration and material-first tinting.
- HDRI lighting, fog, water, procedural vegetation, buildings, props, GTAO, and grading.
- A fixed Chambers Bay capture fixture.

Yet the rendered result still reads as a terrain reconstruction rather than a commercial golf simulator.
The highest-impact problems are:

- A hard world edge and missing surrounding geography.
- Playing surfaces that read as masks painted onto terrain.
- HD/far-photo seams and repeated material patterns.
- Flat bunkers and weak green-complex geometry.
- Sparse, repetitive vegetation and low-detail structures.
- No durable course-art format for signature scenery or manual corrections.
- No committed visual benchmark harness, performance trace, or release-grade visual gate.
- Too much course-building and material logic concentrated in `public/render/scene.js`.

The existing Reality Master Plan correctly targets a 6–7/10 result. It does not define the additional
course-art and validation systems required to move beyond that band.

---

## 3. Goals

### 3.1 Automatic Course Baseline

For any supported course with valid OSM, elevation, and aerial data:

- The world does not end visibly.
- Surface masks do not produce obvious tiles, halos, seams, or stipple.
- Greens, fairways, rough, bunkers, water, and vegetation are visually distinct.
- Course character is selected from a normalized presentation profile.
- Missing optional data fails visibly in diagnostics but degrades safely in play.
- The course remains playable and physics-correct.
- The default 1080p quality profile meets the performance budget.

### 3.2 Curated Hero Course

For Chambers Bay and later curated courses:

- The environment is recognizable from multiple real-photo viewpoints.
- Signature geography, vegetation structure, buildings, and landmarks are represented.
- Bunker and green complexes have believable geometry and material transitions.
- Manual art is versioned, validated, reproducible, and separate from machine-local caches.
- The same art pack works in development, packaged Electron builds, and offline mode.
- A course can be updated without invalidating unrelated HD terrain bundles.

### 3.3 Engineering goals

- Keep `GolfScene` as a thin orchestrator rather than adding more course-specific logic to it.
- Place new behavior behind deep modules with small interfaces.
- Make the capture fixture and quality rubric the authoritative acceptance gate.
- Preserve deterministic placement, offline operation, and feature-flag rollback.
- Add no renderer abstraction merely for hypothetical future engines.

---

## 4. Non-goals

- Automatic TrackMan-quality reconstruction for every OSM course.
- A general-purpose Unity/Unreal-style level editor.
- Replacing Three.js or rewriting the renderer.
- Real-time global illumination, ray tracing, dynamic weather, or dynamic time of day.
- Geometry grass across the entire course.
- Simulation-grade ocean waves.
- Rebuilding the physics model except where shared terrain modifiers require parity.
- Committing generated course caches or HD bundles to normal Git history.
- Improving ball flight, scoring, launch-monitor integration, or rules of play in this program.

---

## 5. Quality model

Scores are directional review aids. Hard gates and observable acceptance criteria decide whether a
milestone ships.

| Dimension | Weight | Automatic baseline | Curated hero |
|---|---:|---|---|
| World composition and horizon | 15% | No visible cutoff; plausible generic context | Real surrounding geography and course silhouette |
| Terrain and macro relief | 15% | Registered, continuous, no obvious HD break | Signature landforms match reference views |
| Playing-surface delineation | 15% | Stable, clean, readable surface transitions | Authored mow lines, collars, waste edges, and run-offs |
| Material and light response | 15% | Distinct non-repeating turf/sand/water | Course-specific wetness, dryness, roughness, and grooming |
| Bunkers and green complexes | 15% | Believable depth and placement | Reference-matched hero geometry and transitions |
| Vegetation, structures, landmarks | 15% | Biome-correct density and variety | Recognizable signature objects and authored composition |
| Atmosphere and color | 5% | Coherent exposure, haze, and sun | Course/weather-specific mood matching references |
| UI and artifact cleanliness | 5% | No debug leaks or obstructive HUD | Compact professional hierarchy and presentation polish |

### 5.1 Hard visual gates

A milestone cannot ship if any fixed acceptance frame contains:

- A visible course-tile cliff or unintentional void.
- A rectangular HD patch or material boundary.
- Surface-mask stipple, checkerboard aliasing, or multi-metre halos.
- Floating or buried ball, pin, vegetation, building, or prop.
- A signature water body missing from a curated course.
- A phantom sea or curated landmark on an unrelated course.
- A WebGL shader error, missing asset error, or unhandled course-load error.
- Gameplay/debug overlays in survey captures.

### 5.2 Viewing bands

Every visual feature must declare which viewing bands it owns:

| Band | Camera distance | Typical view | Primary owner |
|---|---:|---|---|
| Address | 0–20 m | Ball and immediate lie | Detail material, foreground grass, contact shadow |
| Play | 20–80 m | Normal shot setup | Surface system, bunker/green geometry, near vegetation |
| Flight | 80–250 m | Ball flight and landing | Material LOD, terrain features, mid vegetation |
| Overview | 250–1,500 m | Hole survey and free camera | Macro relief, surface composition, landmarks |
| Horizon | 1.5–12 km | Course context and skyline | World context, atmosphere, distant impostors |

No sub-plan may claim an overview improvement based only on an address-range capture.

---

## 6. What already exists and must be reused

| Capability | Current owner | Program use |
|---|---|---|
| Base + HD terrain sampling | `lib/elevation.js`, `public/render/terrain-grid.js` | Remains height source of truth |
| Coarse/HD mesh construction | `public/render/hd-terrain.js` | Extended only where seam diagnosis proves necessary |
| Material-first turf | `public/render/turf.js` | Evolves behind the surface-system interface |
| OSM/override surfaces | `lib/course.js` | Inputs to presentation and surface compilation |
| Runtime classmap | `lib/classify-surfaces.js` | Coverage fallback, not authoritative authored edge |
| Course character | `public/render/course-character.js` | Migrates into normalized presentation defaults |
| HDRI and sun | `public/render/env.js` | Remains single lighting source of truth |
| Fog | `public/render/atmosphere.js` | Extended with presentation presets |
| Trees and vegetation | `tree-cards.js`, `vegetation.js`, `grass.js` | Reused behind biome-aware placement |
| Water | `water.js`, `water-depth.js` | Reused for ponds; world ocean is a separate mode |
| Buildings and props | `scene.js`, `props.js` | Move behind a landmark module as work touches them |
| Surface override seam | `loadSurfaceOverride` / `applySurfaceOverride` | Preserved for gameplay geometry corrections |
| Fixed capture poses | `docs/fixtures/chambers-sweep.json` | Becomes part of committed benchmark harness |

### 6.1 Never-regress list

- 1 m QL1 macro landform and putting-surface slope.
- Surface/aerial registration.
- HD bundle validation and fingerprint stability.
- Physics and renderer height parity.
- Sawgrass lush-parkland appearance when Chambers-specific tuning changes.
- Deterministic procedural placement.
- Offline course play after assets are installed.
- Graceful fallback when optional imagery, classmaps, or art packs are absent.

---

## 7. Target architecture

### 7.1 Dependency graph

```text
cached course + HD bundles + optional curated files
                       |
                       v
             ResolvedCoursePackage builder
          validate -> compile -> commit atomically
                       |
      immutable runtime package + content revision
                       |
                       v
              CoursePresentation module
              interface: resolve(package)
                       |
       normalized presentation + asset manifest
       +---------------+----------------+------------------+
       |               |                |                  |
       v               v                v                  v
 WorldContext     SurfaceSystem   TerrainFeatures   VegetationLandmarks
       |               |                |                  |
       +---------------+----------------+------------------+
                       |
                       v
                 GolfScene orchestrator
                       |
                       v
              PostFX + VisualBenchmark
```

`GolfScene` owns lifecycle, cameras, frame updates, and module composition. It must not interpret course
names, biome rules, art-pack file structures, or surface-authoring provenance.

### 7.2 CoursePresentation module

**Purpose:** turn raw course data plus optional curated data into one normalized presentation consumed by
the renderer.

**External seam:**

```js
resolveCoursePresentation({
  course,
  environment,
  curatedPack,
  contentRevision
}) -> {
  courseId,
  contentRevision,
  tier,
  character,
  world,
  surfaces,
  materials,
  vegetation,
  landmarks,
  atmosphere,
  assetManifest,
  qualityHints,
  diagnostics
}
```

Callers learn one interface. Detection, defaults, schema migration, fallback, provenance, and curated
overrides stay inside the module.

**Adapters:**

- `AutomaticPresentationAdapter`: derives a safe profile from geography, existing course data, and defaults.
- `CuratedPresentationAdapter`: validates and merges a versioned course-art pack.

Two adapters make this a real seam rather than speculative indirection.
The automatic adapter may use broad data-derived rules, but it may not contain course-name or stable-ID
special cases. Existing manual Chambers character tuning and legacy surface/pin sidecars move into curated
packs. With packs disabled, legacy sidecars are ignored.

**Likely files:**

- `lib/course-presentation.js` — schema loading, normalization, merge rules.
- `public/render/course-presentation.js` — optional read-only accessors only if callers need them; it must
  not duplicate server-side detection or merge logic.
- `lib/schemas/course-art-pack.schema.json` — versioned source contract included by the packaged app.
- `test/course-presentation.test.js` — auto/curated/fallback behavior.

### 7.2.1 ResolvedCoursePackage transaction

Course activation is a prepare/commit transaction. No resolver mutates the currently active course while
validation or compilation is still in progress.

```text
raw cached/base course
        |
        v
begin latest-only activation generation
        |
        v
load/clone + derive stable courseId
        |
        +----> resolve HD descriptors against base fingerprint
        |
        +----> locate + validate complete curated manifest
        |
        +----> compile gameplay overlays into ordered terrain patches
        |
        v
freeze ResolvedCoursePackage
        |
        +---- failure before here ----> keep prior active course
        |
        v
single commit: active package + courseRevision + game.setCourse
```

The immutable package contains:

- `courseId`: stable source identity, independent from the display name.
- `courseRevision`: monotonic activation token used to reject stale client work.
- `contentRevision`: deterministic hash of the accepted presentation manifest, validated runtime asset
  content hashes, and gameplay overlays.
- `baseCourse`: the course state used for the HD fingerprint.
- `gameplayCourse`: a cloned course with accepted surface/pin overlays.
- `terrainPatches`: ordered, serialized patches used by both physics and browser sampling.
- `presentation`: the normalized visual contract.
- `hdDescriptors`, `assetManifest`, and typed diagnostics.

An invalid optional pack selects the automatic adapter. An unexpected failure in base-course or gameplay
preparation aborts the transaction and leaves the prior course playable.
The activation generation is allocated before any asynchronous course acquisition. A later request aborts
the older request where possible, and only the latest generation may commit or broadcast a course event.

### 7.3 Course-art pack

Curated art is committed under a stable source directory, not mixed into `data/courses/` caches:

```text
courses/
  curated/
    chambers-bay/
      profile.json
      references.json
      landmarks.json
      terrain-features.json
      vegetation.json
      assets/
        ...
```

Large generated derivatives may remain external build artifacts, but their manifests and provenance are
versioned. Packaged assets must be copied into the Electron build by the normal packaging process.

`references.json` stores source URLs, licensing/usage notes, view direction, approximate local camera, and
the feature each image proves. Copyrighted reference photos are not committed unless their license permits
it; a hydration command may fetch them into the ignored local reference directory. This keeps the evidence
set reproducible without redistributing images improperly.

Minimum `profile.json` concept:

```json
{
  "version": 1,
  "courseId": "osm:relation:123456",
  "displayName": "Chambers Bay",
  "legacyMatch": {
    "names": ["Chambers Bay"],
    "origin": { "lat": 47.118, "lon": -122.57, "toleranceM": 250 }
  },
  "tier": "curated",
  "character": {
    "biome": "pnw-links",
    "dryness": 0.85
  },
  "world": {
    "coast": {
      "enabled": true,
      "levelM": 0,
      "bearingDeg": 270
    },
    "contextRadiusM": 3500
  },
  "atmosphere": {
    "preset": "marine-layer"
  }
}
```

Rules:

- A pack matches by `courseId`; display-name matching alone is forbidden.
- Newly fetched courses store `osm:<type>:<id>` identity. Legacy caches derive a geographic fallback from
  normalized name plus rounded origin, and may match only when both alias and origin tolerance pass.
- Asset references are registry keys or pack-relative paths validated against traversal.
- Manifests cap file size, array counts, coordinate ranges, texture dimensions, and total declared asset
  bytes. All coordinates must be finite and within the permitted course/context envelope.
- Local positions use the established simulation coordinate frame.
- Unknown fields fail validation in development.
- Unsupported future versions fail with an actionable error.
- Missing packs select the automatic adapter without warning spam.
- A corrupt selected pack produces one visible diagnostic and uses the automatic profile.
- Validation is atomic: one schema/identity failure rejects the whole selected pack. Once a pack is valid,
  a missing optional runtime asset disables only the feature that references that asset.
- The browser receives opaque asset keys, never filesystem paths.
- The active asset manifest records byte size, MIME, and SHA-256 for every runtime asset; changing an asset
  changes `contentRevision` even when its filename does not.

### 7.4 WorldContext module

**Purpose:** ensure the course exists inside a believable world.

**Interface:**

```js
buildWorldContext({ presentation, bounds, terrainSampler, environment }) -> {
  group,
  update,
  dispose,
  diagnostics
}
```

Implementation owns:

- Coastal water plane or inland context selection.
- Context skirt/coarse DEM ring.
- Horizon masks or distant land silhouettes.
- Fog handoff and far-distance material.
- Course-specific context landmarks that belong at horizon scale.

It does not own ponds, playing surfaces, or near-course props.

### 7.5 SurfaceSystem module

**Purpose:** compile vector/classification inputs into terrain materials and masks for all distance bands.

**Interface:**

```js
buildSurfaceSystem({
  course,
  presentation,
  bounds,
  macroImagery,
  rendererCapabilities
}) -> {
  terrainMaterial,
  sandMaterial,
  masks,
  update,
  dispose,
  diagnostics
}
```

Implementation owns:

- Raw authoritative OSM/curated masks.
- Classmap coverage fallback and precedence.
- Green collar/fringe derivation.
- Fairway/rough/green/sand detail normals and roughness.
- Mow direction/light response.
- Distance-band LOD and far-photo blending.
- Shader cache-key/version discipline.

The interface must not expose individual uniforms to `GolfScene`. Configuration is passed as normalized
presentation, and the module manages its internal shader state.

### 7.6 TerrainFeatures module

**Purpose:** create bunker, green, waste-area, path, and other terrain-attached features while preserving
height parity.

**Interface:**

```js
compileTerrainFeatures({
  surfaces,
  baseSampler,
  presentation,
  authoredFeatures
}) -> {
  orderedPatches,
  renderDescriptors,
  diagnostics
}
```

The compiler runs once before activation. Both server physics and the browser terrain sampler consume the
same serialized `orderedPatches`; render descriptors contain no second height algorithm. A visual-only
recessed bunker is forbidden.

The first task in any geometry sub-plan is diagnostic: determine whether LiDAR already contains the desired
feature. Do not procedurally carve over real captured relief without evidence.

### 7.7 VegetationLandmarks module

**Purpose:** turn course/biome data and optional authored placements into layered, LOD-aware scenery.

**Interface:**

```js
buildVegetationAndLandmarks({
  course,
  presentation,
  terrainSampler,
  assetRegistry,
  cameraBudget
}) -> {
  group,
  update,
  dispose,
  diagnostics
}
```

Implementation owns:

- Biome rules, exclusion zones, and deterministic auto placement.
- Near/mid/far vegetation LOD.
- Rim forest walls and skyline impostors.
- Buildings, authored models, paths, fences, rocks, rail lines, and props.
- Asset instancing, grounding, variation, and culling.

It replaces the current shallow pattern where `scene.js` separately computes tree, grass, flower, building,
and prop placement.

### 7.8 VisualBenchmark module

**Purpose:** make visual claims repeatable.

**Developer interface:**

```text
npm run visual:capture -- --suite baseline
npm run visual:capture -- --course chambers-bay --profile main
npm run visual:compare -- --before <dir> --after <dir>
npm run visual:perf -- --course chambers-bay --route hole-1
```

Implementation owns:

- Starting an isolated server and renderer.
- Loading cached fixtures from a supplied data directory.
- Waiting for HD and async materials.
- Applying committed camera poses.
- Capturing post-processed frames and UI frames.
- Collecting WebGL warnings, object counts, shader counts, and frame-time samples.
- Emitting a machine-readable manifest and human review sheet.

The harness has two data modes:

- A small committed synthetic/curated geometry fixture for CI smoke, schema, cleanup, and shader checks.
- Named machine-local real-course caches for full visual and performance review. Missing real caches fail
  with an exact hydrate/load command rather than silently skipping.

Pixel diffs detect accidental changes and artifacts; they do not determine realism. Human comparison against
real-course and pro-sim references remains part of milestone acceptance.

### 7.9 Asset gateway, diagnostics, and lifecycle

Curated assets are data files, not browser-static source files. In development they live under
`courses/curated`; a deterministic preparation step validates, hashes, and stages runtime-only files.
Packaged builds copy that generated directory—not raw authoring inputs—to
`process.resourcesPath/course-art` using Electron Builder `extraResources`. `main.js` exposes that root to
the server through `BIRDIE_ART_DIR`; direct renderer filesystem access is forbidden.

The server builds an allowlisted manifest for the active package and serves assets only through:

```text
GET /api/course-art/:contentRevision/:assetKey
  -> active package lookup
  -> exact revision match
  -> exact key match
  -> canonical path containment check
  -> MIME + byte-size allowlist
  -> immutable ETag/contentRevision response
```

Unknown revisions/keys, absolute paths, traversal attempts, disallowed extensions, and assets outside the
active package return a typed 404/400 without revealing machine paths. Revision-addressed URLs may be
cached as immutable; an unversioned mutable asset URL is forbidden.

Every renderer course load creates a `CourseBuildContext`:

```js
{
  courseRevision,
  contentRevision,
  signal,
  isCurrent(),
  assets,
  diagnostics
}
```

Starting a newer load aborts the prior context. Async callbacks must call `isCurrent()` before attaching
objects; stale results release their handles immediately. The asset registry owns shared textures and
models with reference-counted handles keyed by `contentRevision + assetKey`. Modules dispose
groups/materials/geometries they create and release registry handles, but they never dispose shared registry
resources directly.

Diagnostics are typed `{ code, severity, stage, courseId, message, recovery }`. Expected optional-data
fallbacks log once. Benchmark/release runs fail on unexpected `error` diagnostics or console errors. The
normal UI shows one concise recoverable message; detailed diagnostics remain available to the benchmark
manifest and developer overlay.

---

## 8. Data, fingerprint, and load-order rules

The base course and the presentation layer serve different purposes:

- **Base course data:** routing, original OSM surfaces, elevation, trees/woods, and fields included in
  `canonicalCourse`. These determine HD bundle compatibility.
- **Presentation data:** atmosphere, palette, scenery, art assets, vegetation rules, and other visual-only
  settings. These do not alter the HD fingerprint.
- **Gameplay overlays:** corrected pins/surfaces and any terrain modifier affecting ball height. These apply
  after HD bundle resolution but before both physics and renderer geometry.

Required load order:

```text
load cached/base course
  -> latest-only server activation generation
  -> resolve HD bundles against original fingerprint
  -> clone base course
  -> derive stable courseId
  -> resolve and validate the complete optional course-art pack
  -> compile gameplay-affecting overlays into ordered terrain patches once
  -> build normalized CoursePresentation + contentRevision
  -> atomically commit package and game.setCourse with final physics sampler
  -> serve sanitized geometry + presentation metadata
  -> renderer accepts only the latest courseRevision/contentRevision
  -> renderer builds modules and acknowledges the same package revision
```

Terrain-feature algorithms run on the server/compiler side only. They emit the same bounded height-patch
representation already consumed by physics and `public/render/terrain-grid.js`; the browser does not carry
a second feature compiler. Feature patches precede HD and legacy green patches only where the authored
feature is explicitly allowed to override measured terrain. That priority is serialized and parity-tested.
SP-02 defines the package field and empty-patch transport only. A pack that requests terrain-feature
capability is rejected as unsupported until SP-05 registers the compiler; SP-02 does not contain a
placeholder terrain algorithm.

The program must add parity tests whenever a field crosses both server and renderer:

- Original cached course remains unmodified until HD resolution finishes.
- Two competing server loads commit only the latest request, regardless of completion order.
- Presentation-only changes do not change `courseFingerprint`.
- Any accepted pack/gameplay change changes `contentRevision` without changing the base fingerprint.
- Failed package preparation does not replace the currently active course.
- Gameplay terrain modifiers produce the same height on server and browser samplers.
- Path traversal and absolute machine paths never appear in `/api/course-geometry`.
- Rapid course switches cannot attach old geometry, textures, diagnostics, or readiness acknowledgements.

Stable identity applies to the whole base-course pipeline, not only curated selection:

- Newly fetched caches persist `source: { osmType, osmId }` and use a source-identity cache key.
- A cache hit verifies the requested identity; `slug(name)` alone is never sufficient.
- Legacy name-keyed caches require a one-time verified migration using name plus geographic tolerance.
- HD fingerprint v2 excludes mutable display names and includes stable source identity plus canonical
  geometry/elevation. Existing v1 manifests remain readable through an explicitly tested compatibility path.
- Unsupported fingerprint versions diagnose and fall back; bundles are never silently rewritten.

---

## 9. Performance and memory budgets

The first benchmark sub-plan records hardware and current baselines before enforcing deltas.

Default targets:

| Profile | Resolution | Average | 1% low | Notes |
|---|---:|---:|---:|---|
| `sim-1080` | 1920×1080 | ≥60 fps | ≥45 fps | Default commercial play profile |
| `sim-4k` | 3840×2160 | ≥45 fps | ≥30 fps | RTX 3080-class target; quality reductions allowed |
| `creator` | 1920×1080 | ≥45 fps | ≥30 fps | Free camera with diagnostics enabled |

Additional budgets:

- No single new default-on phase may add more than 3 ms median GPU frame time at 1080p without explicit
  program approval.
- Course switch must dispose old render targets, course textures, generated geometry, and module-owned assets.
- A repeated course-load loop of five loads must not show monotonic renderer texture/geometry growth.
- Hero assets require near/mid/far LOD or a documented reason they do not.
- Reflection rendering is bounded independently from the number of water polygons.
- Feature flags remain available until the associated milestone has passed two-course regression.
- Each quality profile declares limits for draw calls, active textures/geometries, resident curated asset
  bytes, vegetation instances, reflection passes, and maximum source texture dimensions.
- Benchmarks discard shader-compilation warm-up, record at least one repeatable 60-second route, and report
  CPU frame interval separately from GPU time when timer-query support is available.
- `renderer.info` is sampled at a defined point with reset behavior controlled; internal Three.js caches
  establish a steady-state baseline rather than requiring an impossible literal zero.

---

## 10. Verification design

### 10.1 Required course matrix

| Course | Role | Required checks |
|---|---|---|
| Chambers Bay | Dry coastal links + first hero | Coast, world edge, tan identity, sparse interior trees, hero geometry |
| TPC Sawgrass | Lush parkland control | No phantom coast, lush palette, dense vegetation, water-heavy course |
| St Andrews Old Course | Rough/incomplete OSM control | Fallback masks, crisp-edge tolerance, links generalization |

An additional no-aerial or no-HD fixture is required for fallback testing.

M1 evidence runs with curated packs disabled and asserts `presentation.tier === "automatic"`. Curated-on
captures may demonstrate the same module during SP-03 through SP-06, but they do not contribute to the M1
score. In particular, a curated Chambers coastline proves coastal rendering; it does not falsely prove
automatic coastline inference.

### 10.2 Required frame matrix

Each course suite must include:

- Address/play frame.
- Close green frame.
- Close bunker frame.
- Mid-flight/landing frame.
- Elevated hole overview.
- High course overview.
- Horizon/world-edge frame.
- UI frame.

### 10.3 Test layers

| Layer | Purpose | Examples |
|---|---|---|
| Pure unit | Normalize data and compile deterministic fields | profile merge, coast selection, placement exclusion |
| Contract | Keep server/browser payloads safe and stable | schema validation, path sanitization, version failure |
| Physics parity | Prevent floating/sinking | terrain modifier height and gradient parity |
| Renderer smoke | Catch load/shader/resource failure | render all fixture courses, assert no console error |
| Visual artifact | Catch unintended seams or overlays | fixed-frame diff, world-edge mask, UI visibility |
| Performance | Protect frame time and leaks | scripted route, five-load resource loop |
| Human visual review | Judge realism and course identity | real-photo + GSPro/TrackMan side-by-side rubric |

### 10.4 Milestone evidence

Every sub-plan PR includes:

- Before/after captures from the frames it claims to improve.
- Full fixture manifest with commit SHA, configuration, resolution, and course revision.
- `npm test` result.
- Visual-capture smoke result.
- Performance delta if it adds materials, meshes, post-processing, reflections, or LOD.
- Explicit list of known remaining artifacts.

---

## 11. Failure modes registry

| Failure | Severity | Detection | Required behavior |
|---|---|---|---|
| Curated pack missing | Low | Loader result | Use automatic presentation silently |
| Curated pack corrupt/unsupported | High | Schema validation | One actionable diagnostic; automatic fallback |
| Display name changes/collides | Critical | identity contract tests | Match stable ID or alias + origin; never name alone |
| Package preparation throws midway | Critical | activation transaction test | Keep prior course active; emit typed diagnostic |
| Curated asset missing | High | Asset registry | Identify pack, key, and expected path; disable only affected feature |
| Asset key escapes pack root | Critical | HTTP traversal/allowlist test | Reject without path disclosure |
| Coast detector false-positive | Critical | Sawgrass regression fixture | No automatic sea unless confidence/gate passes |
| World skirt exposes crack | High | Horizon capture | Reject sub-plan; do not hide with camera restrictions |
| Surface shader compile fails | Critical | Renderer smoke/console | Feature flag fallback to last known material |
| HD seam worsens | Critical | High overview comparison | Revert phase; protect QL1 relief |
| Terrain feature differs from physics | Critical | Parity test | Do not ship visual feature |
| Vegetation invades green/water/bunker | High | placement unit + capture | Exclusion zones enforced before instancing |
| Curated content leaks to another course | Critical | course-switch test | Module reset and identity-key check |
| Old async load completes after a new course | Critical | delayed-load race test | Ignore and dispose stale result |
| Repeated course switch leaks GPU assets | High | five-load benchmark | Module disposal required |
| Performance misses profile budget | High | scripted benchmark | Reduce quality or ship off by default |
| UI/debug layer contaminates survey frame | High | UI visibility test | Fail visual suite |

---

## 12. Product and technical decisions

### Locked

- Maintain automatic and curated tiers.
- Evaluate M1 with all curated packs disabled.
- Chambers Bay is the first hero course.
- Three.js remains the renderer.
- `GolfScene` stays the orchestrator.
- New systems use deep module interfaces; `scene.js` does not receive a larger configuration surface.
- Course-art packs are versioned and validated.
- Prepare and commit course activation atomically.
- Match curated content by stable course identity, never display name alone.
- Keep the automatic adapter free of per-course identity/name maps.
- Keep legacy curated sidecars out of pack-disabled automatic mode.
- Key and verify base caches by stable identity; version the name-independent HD fingerprint.
- Compile gameplay terrain features once into serialized patches shared by physics and rendering.
- Serve curated assets through an active-package allowlist and package large data through
  `extraResources`.
- Use course/content revisions plus cancellation to reject stale asynchronous work.
- Gate optional package sections by implemented runtime capabilities; no placeholder compiler is allowed.
- Height-changing visual features require physics parity.
- Capture and performance evidence are required before visual claims merge.
- P2 surface work is recovered and verified rather than reimplemented from scratch.

### Deferred to a sub-plan gate

- Exact coastline source: curated metadata first, automated OSM coastline detection second.
- Context skirt implementation: expanded coarse DEM, generated radial mesh, or both by quality tier.
- Whether the far-photo/HD seam is best solved through normal blending, relief LOD, or macro-photo response.
- Whether LiDAR already provides enough bunker depth at target courses.
- Hero asset storage: Git LFS, release archive, or small bundled processed assets.
- The final in-app authoring UI; version 1 may use validated JSON plus a preview/reload workflow.

---

## 13. Program completion criteria

### Automatic Course Baseline complete

- All automatic hard gates pass on Chambers, Sawgrass, St Andrews, and a missing-data fixture.
- Weighted human review reaches 5.5–6.5/10 on all three real courses.
- No course-specific name checks remain in `GolfScene`.
- Default 1080p performance budget passes.
- The automatic adapter requires no manual course file.

### Curated Hero Course complete

- Chambers Bay reaches 7.5–8.5/10 against the fixed real-photo and pro-sim rubric.
- Puget Sound, course silhouette, vegetation structure, greens/bunkers, and signature landmarks are recognizable.
- The course-art pack installs and runs offline in the packaged application.
- Removing the pack returns to the automatic baseline without breaking play.
- A second small curated pack proves the interface is not Chambers-specific.
- No critical failure-mode registry item remains open.
