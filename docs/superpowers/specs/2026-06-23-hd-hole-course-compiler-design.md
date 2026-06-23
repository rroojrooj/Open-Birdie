# HD Hole Course Compiler — Design Specification

**Date:** 2026-06-23

**Status:** Approved prototype design

**Prototype:** Bandon Dunes, Hole 1

**Scope:** Offline compiler for one high-detail real hole, plus runtime bundle loading

## 1. Decision

Build a local, offline course compiler that converts public geospatial sources into a
versioned Open-Birdie hole bundle. The first bundle covers Bandon Dunes Hole 1 and combines:

- OpenStreetMap course semantics already cached by Open-Birdie;
- full-hole USGS 3DEP elevation at approximately 1 m spacing;
- public USDA NAIP aerial imagery at the best consistent acquisition available; and
- the existing PBR turf, vegetation, lighting, water, and near-camera grass renderer.

Compilation happens before gameplay. Runtime loading is local and requires no network.

This is intentionally different from the earlier
[photoreal renderer design](2026-06-14-photoreal-renderer-design.md). That design declared
course-data ingestion a non-goal and improved how generic OSM/elevation data was shaded.
This design improves the source content itself. Existing renderer work remains useful as
the close-detail layer over the new site-specific macro imagery and terrain.

## 2. Why this is the next lever

The current pipeline provides good semantic structure but limited site-specific detail:

- the base elevation grid uses 5 m cells;
- approximately 1 m 3DEP patches cover greens only;
- course color comes from generated surface masks and generic tiled assets; and
- procedural shaders invent variation that is not tied to the real site.

More shader tuning cannot reconstruct real drainage patterns, grass-condition variation,
native vegetation boundaries, paths, wear, or small terrain rolls that are absent from the
inputs. TrackMan-grade content requires surveyed site data and authored processing. This
prototype tests the open-data approximation of that content pipeline before any attempt to
process an entire course.

## 3. Goals and success criteria

### Goals

1. Produce a reproducible HD bundle for one real hole from public data.
2. Preserve true macro color/detail from aerial imagery without making close turf look like
   a flat photograph.
3. Replace the full prototype area’s coarse base terrain with high-resolution elevation.
4. Keep compilation separate from gameplay and preserve offline runtime operation.
5. Establish provider, bundle, validation, and loader boundaries that can later scale to
   additional holes without committing to full-course automation.
6. Surface source and processing failures with actionable stage-specific errors.

### Measurable acceptance gates

- The padded Hole 1 area is covered by high-resolution terrain without a visible boundary
  seam against the surrounding base grid.
- Aerial imagery and OSM green/fairway/bunker geometry align within approximately 2 m at
  manually selected landmarks.
- Fixed tee, landing-zone, and approach screenshots preserve recognizable real macro
  variation and do not show obvious stretching, tile seams, or color discontinuities.
- Close turf retains PBR normal/roughness response and near-camera grass geometry.
- Runtime makes no data-provider requests.
- Target performance on the current RTX 3060 at 1920×1080 is 60 FPS average and at least
  45 FPS 1%-low during a repeatable representative camera path.
- The HD hole loads from local storage in under 5 seconds after application startup.
- Incremental GPU memory attributable to the bundle remains below 250 MB.
- Existing gameplay, terrain sampling, physics, and rendering tests remain passing.
- Re-running the compiler with the same pinned manifest yields the same logical outputs and
  source identifiers. Binary hashes may differ only where a documented encoder version
  prevents byte-for-byte reproducibility.

## 4. Non-goals

- A complete 18-hole HD course in the first implementation.
- TrackMan parity or reconstruction of proprietary TrackMan assets/pipelines.
- Drone capture, photogrammetry, LiDAR point-cloud meshing, or manually modeled buildings.
- AI image generation as a source of ground truth. AI may later assist semantic labeling or
  quality control, but it must not hallucinate terrain or course geometry in this prototype.
- A hosted compiler, job queue, account system, or CDN.
- An in-app course-builder UI.
- Runtime downloading or conversion of geospatial source data.
- Automatic tree-species recognition, building extraction, or furniture placement.
- Replacing working renderer modules unrelated to the new macro data.

## 5. Confirmed prototype data

The cached Bandon course currently provides:

- origin near latitude `43.188372`, longitude `-124.391261`;
- Hole 1, par 4, approximately 380 m along its OSM routing;
- routing bounds approximately 143 m × 324 m before padding;
- a 5 m base elevation grid; and
- four existing high-resolution green patches across the cached course.

Provider discovery on 2026-06-23 found public NAIP catalog items covering the prototype,
including Oregon 2022 imagery with a reported ground sample distance of 0.3 m. The compiler
must pin the selected item IDs and acquisition date in its source manifest rather than
silently switching to a newer acquisition.

Primary public references:

- [NAIP on the Registry of Open Data on AWS](https://registry.opendata.aws/naip/)
- [USGS 3DEP LiDAR Point Clouds](https://registry.opendata.aws/usgs-lidar/)
- [USGS 3DEP Elevation ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer)
- [Planetary Computer NAIP STAC collection](https://planetarycomputer.microsoft.com/dataset/naip)

The prototype uses the Planetary Computer STAC catalog to locate a public NAIP COG because
the AWS visualization bucket is Requester Pays. Provider access is isolated so a later
catalog/source can replace it without changing the compiler core or runtime bundle format.

## 6. Architecture

The system has two hard-separated paths.

### 6.1 Build path

```text
cached OSM course + build manifest
              │
              ▼
      source discovery adapters
     ┌────────┴────────┐
     │                 │
  3DEP DEM         NAIP STAC/COG
     │                 │
     └────────┬────────┘
              ▼
     normalize to Open-Birdie
       local-metre coordinates
              │
              ▼
    crop → resample → mask → validate
              │
              ▼
      atomic versioned hole bundle
```

### 6.2 Runtime path

```text
local hole bundle → manifest/checksum validation → HD course loader
                                                ├─ high-res terrain sampler/mesh
                                                └─ aerial macro texture + masks
                                                            │
                                                            ▼
                                                existing PBR turf/grass renderer
```

Runtime never imports compiler dependencies and never calls STAC, 3DEP, AWS, or Azure.

## 7. Compiler components

Each component has one responsibility and an explicit data contract.

### 7.1 CLI orchestrator

Proposed command:

```powershell
npm run build:hd-hole -- --course "Bandon Dunes Golf Resort" --hole 1
```

Responsibilities:

- parse and validate arguments;
- resolve exactly one cached course and hole;
- load a checked-in build manifest;
- run named stages in order;
- emit concise progress, timing, and byte counts;
- preserve a diagnostic workspace on failure;
- publish only after every validation passes; and
- return a non-zero exit code on any failed stage.

The orchestrator must not contain provider-specific HTTP logic or raster algorithms.

### 7.2 Bounds and coordinate model

The cached OSM course origin remains the coordinate authority. Hole routing, relevant
surface polygons, and a configurable padding distance determine the compilation extent.
The default padding for the prototype is 150 m, then snapped outward to the chosen output
grid. The expected working area is therefore roughly 450 m × 625 m.

All published bounds use Open-Birdie local metres. Provider adapters may use WGS84, Web
Mercator, or a source UTM CRS internally, but must return rasters mapped to this local frame.
Coordinate conversion functions are shared and tested against known points; they are not
reimplemented separately per adapter.

### 7.3 3DEP elevation adapter

Reuse and generalize the existing `lib/lidar.js` ImageServer work:

- request the full padded hole extent at a target spacing of approximately 1 m;
- download Float32 elevation data plus authoritative response extent/dimensions;
- reject all-NoData, excessive NoData, implausible heights, truncated payloads, and metadata
  mismatches;
- resample into the Open-Birdie local grid;
- store heights relative to the course base elevation; and
- create an edge blend ring against the coarse course grid where necessary.

The current gameplay loader treats 3DEP as optional and intentionally swallows provider
failures. The compiler requires a strict API that throws contextual errors. Runtime best-
effort behavior may continue using the existing optional API; strict compiler behavior must
not be implemented by parsing logs or guessing whether a `null` means failure.

### 7.4 NAIP imagery adapter

Responsibilities:

- search the NAIP STAC collection for items intersecting the padded bounds;
- select one consistent acquisition year/date and the best suitable resolution;
- require complete spatial coverage, including multiple adjacent source items when needed;
- pin collection, item IDs, acquisition timestamp, GSD, asset URLs, and immutable source
  metadata in the build manifest;
- fetch only required COG ranges or provider tiles into the diagnostic workspace;
- composite and resample RGB into the local north-up output grid; and
- expose a linear mask for missing pixels so validation can reject gaps.

The adapter must not silently combine different years or fall back to screenshots/map
tiles. A source-selection command may propose candidates, but the committed build manifest
is authoritative for reproducible builds.

### 7.5 Semantic mask generator

Rasterize existing OSM surfaces into the exact aerial-image UV space. At minimum publish:

- fairway;
- green;
- tee;
- bunker;
- water; and
- a validity/coverage mask.

Masks are not used to repaint the ground with flat colors. They control how much aerial
macro color survives and where the existing fine PBR materials, mowing response, sand, and
water treatment apply. Polygon edges are supersampled before downsampling to avoid jagged
boundaries.

### 7.6 Image normalization and encoding

The source orthophoto is a macro-albedo starting point, not a finished material. The build
stage applies deterministic, conservative normalization:

- remove obvious global color cast using pinned parameters;
- cap black/white extremes that produce lighting artifacts;
- avoid baked sharpening halos;
- retain real large-scale variation; and
- produce a color-managed sRGB output with mipmaps suitable for GPU upload.

The first implementation should favor a browser-native compressed image such as WebP or
JPEG for simplicity. KTX2/Basis is a later optimization only if measured load time or GPU
memory requires it. Source and normalized previews remain in the ignored build workspace,
not the shipped bundle.

### 7.7 Bundle validator and atomic publisher

Validation runs before publication and checks:

- manifest schema/version;
- exact output dimensions and bounds;
- finite terrain values and expected min/max/gradient ranges;
- source coverage percentage;
- image/mask decodability;
- checksums and byte sizes;
- OSM landmark alignment samples;
- maximum configured bundle size; and
- absence of unexpected files.

Output is first written to a sibling staging directory. Only a fully validated bundle is
renamed into its final location. A failed run never overwrites the last known-good bundle.

## 8. Bundle contract

Proposed layout:

```text
data/hd-courses/
  bandon-dunes/
    manifest.json
    provenance.json
    holes/
      01/
        terrain.f32
        orthophoto.webp
        surfaces.png
        coverage.png
```

`manifest.json` includes:

- schema and compiler versions;
- course identity and cached-course fingerprint;
- hole number and local/WGS84 bounds;
- base elevation, terrain spacing, dimensions, and byte order;
- image dimensions, color space, and local UV mapping;
- file names, content hashes, and byte sizes;
- required runtime capabilities; and
- selected source IDs/dates.

`provenance.json` records source organization, dataset, item/service identifiers, access
date, source URL, license/public-domain statement, compiler parameters, and relevant tool
versions. It is data provenance, not a substitute for repository asset documentation.

The compiler workspace and downloaded raw COG/DEM data live under an ignored build-cache
directory. Final prototype bundles also remain ignored initially because their size is not
suitable for normal Git history. A release/distribution strategy is a separate decision
after the prototype passes visual gates.

## 9. Runtime integration

### 9.1 Server

Add a path-safe, read-only route for the active course’s validated HD assets. The route:

- resolves paths only beneath `data/hd-courses`;
- serves binary/image MIME types with content length and local cache headers;
- exposes bundle metadata through the existing course-geometry response or a dedicated
  metadata endpoint; and
- never serves raw compiler workspaces.

The server validates the manifest and cached-course fingerprint before advertising an HD
bundle. Missing bundles are normal. Invalid bundles produce an actionable warning and are
not advertised.

### 9.2 Terrain

The renderer and physics need one consistent height model. For the prototype:

- the HD patch covers the entire padded hole and overrides the coarse base grid within its
  extent;
- rendering uses the high-resolution grid to construct the local terrain mesh;
- gameplay/physics uses the same raw height source through `makeTerrain`, retaining its
  existing optional smoothing behavior for physics; and
- the patch edge blends into the base grid over a documented ring to prevent steps.

Do not build an independent visual-only terrain that disagrees with ball physics.

### 9.3 Turf material

Extend the existing turf material with an optional macro-albedo texture and local-bounds
mapping:

- aerial RGB supplies low-frequency/site-specific color;
- semantic masks control surface treatment;
- existing tiled PBR grass normal/roughness supplies sub-metre detail;
- existing grass geometry supplies near-camera silhouettes and parallax;
- bunker and water materials continue to override aerial pixels where appropriate; and
- aerial contribution fades or is filtered at close range if photographic artifacts become
  visible.

The aerial image is never used as the only grass material. It is one layer in a scale-
separated material stack.

### 9.4 Fallback behavior

- **No bundle:** use today’s procedural course without warning noise.
- **Valid bundle:** show a small diagnostic indication in development builds and load it.
- **Invalid or incompatible bundle:** reject it, log/display the exact validation reason,
  and use the procedural course.
- **Failure after a valid bundle begins loading:** dispose partial GPU resources, surface the
  error, and reload the procedural course as one coherent state.

There is no mixed half-HD state.

## 10. Error handling and observability

Compiler errors include a stage code, course/hole, provider, request/source identifier, and
the underlying exception. Sensitive query tokens, if a future provider needs them, are
redacted.

Named stages:

```text
resolve-course
compute-bounds
discover-elevation
download-elevation
discover-imagery
download-imagery
reproject
rasterize-masks
encode
validate
publish
```

Every stage records elapsed time and input/output byte counts in a build report. Network
operations use bounded concurrency, timeouts, and limited exponential-backoff retries.
Coverage/validation failures are not retried because they are deterministic input issues.

Runtime logs distinguish `bundle absent`, `bundle rejected`, and `bundle load failed`.
Only absence is a normal silent fallback.

## 11. Testing strategy

### Unit tests

- local/WGS84/provider coordinate transformations;
- bounds padding and grid snapping;
- deterministic imagery-item selection;
- source-manifest pinning and schema validation;
- Float32 terrain decoding/resampling/edge blend;
- NoData and truncated-response rejection;
- polygon-to-mask rasterization and edge antialiasing;
- bundle path containment and checksum validation; and
- aerial/PBR blend configuration.

### Integration tests

- compile from small checked-in synthetic fixtures with no network;
- validate a complete fixture bundle;
- confirm atomic publication preserves the prior bundle after failure;
- serve bundle files with correct MIME/range/cache behavior;
- load/unload/reload an HD bundle without leaked renderer resources;
- confirm physics and renderer sample the same terrain values; and
- confirm a corrupt bundle produces an explicit rejection and coherent fallback.

### Live provider smoke test

A separately invoked, non-default smoke test verifies current 3DEP and NAIP access for the
pinned Bandon bounds. Normal `npm test` remains offline and deterministic.

### Visual/performance verification

- capture fixed tee, landing-zone, and approach camera frames in procedural and HD modes;
- inspect alignment and seams at full resolution;
- compare macro color/detail without changing lighting between captures;
- run the existing test suite;
- record load time, average FPS, 1%-low FPS, and peak GPU texture memory where available;
  and
- save the prototype report and representative captures outside normal release assets.

## 12. Size and delivery estimates

For the approximately 450 m × 625 m padded prototype area:

- processed hole bundle: expected 30–150 MB;
- temporary/raw source and intermediate files: expected 0.5–3 GB;
- incremental GPU memory: budget below 250 MB; and
- implementation size: roughly 1,000–2,000 focused lines plus tests and documentation.

These are budgets, not promises. The compiler reports real sizes, and the implementation
must prefer measured output over preserving an estimate. A full 18-hole course is likely
hundreds of megabytes to several gigabytes depending on coverage, mipmaps, and packaging;
that distribution decision is deferred.

## 13. Security, licensing, and data hygiene

- Treat provider responses and manifests as untrusted input.
- Constrain all cache, staging, and published paths beneath configured roots.
- Limit downloads, decoded pixel counts, grid dimensions, and final bundle size.
- Use temporary files plus atomic rename; never stream provider data directly into the final
  bundle.
- Record NAIP public-domain attribution/provenance and USGS public-domain provenance.
- Do not commit raw provider downloads or large generated bundles to normal Git history.
- Do not incorporate imagery from consumer map screenshots or sources whose terms prohibit
  redistribution.

## 14. Documentation impact

During implementation:

- add the compiler command and prerequisites to `README.md`;
- add provider and generated-bundle provenance guidance to `ASSETS.md` or a dedicated data
  provenance document;
- update `.gitignore` for raw workspaces and generated bundles;
- add the bundle schema/version contract near the compiler source; and
- update `docs/visual-upgrade-plan.md` so future work does not return to shader-only tuning
  as the primary realism strategy.

No persistent external “memory” is required. This approved specification and the later
implementation plan are the repository source of truth.

## 15. Delivery sequence

1. Establish fixtures, schemas, bounds, coordinates, and strict errors.
2. Build and validate the full-hole 3DEP terrain path.
3. Build and validate pinned NAIP discovery/download/compositing.
4. Generate semantic masks and the atomic bundle publisher.
5. Add secure runtime bundle serving and validation.
6. Integrate one consistent HD terrain source with renderer and physics.
7. Blend aerial macro color into the existing PBR turf stack.
8. Capture visual/performance evidence and tune only against acceptance gates.
9. Document the command, provenance, actual sizes, and remaining limits.

Each step must leave tests passing and be independently reviewable. Full-course scaling is
considered only after the one-hole evidence passes.
