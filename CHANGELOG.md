# Changelog

All notable changes to Open-Birdie are documented here.

## [Unreleased]

### Added
- **Real 3D terrain on every pixel (course-wide 1 m lidar)** — the base terrain now fetches USGS
  3DEP 1 m lidar across the WHOLE course (tiled + mosaicked, with a per-node fall back to the coarse
  ~9.5 m grid over water / outside the US), so every hole, fairway, and rough renders as genuinely
  sculpted landform — mounds, bunker pits, green contours — not an aerial draped on a smooth sheet.
  Chambers Bay goes from a 217×363 @ 5 m grid to 1081×1816 @ 1 m (~2 M nodes). Physics samples the
  finer relief too. (`lib/elevation.js` `fetch3depBase`/`planLidarTiles`; `CACHE_VERSION` 4.)
- **Multi-patch HD rendering** — the runtime renders every built hole's 1 m HD bundle at once
  (`resolveHdBundles` scans the bundles dir; server `activeHd` is an array; `/api/course-geometry`
  `hd` + the readiness handshake are plural; the client builds one HD mesh per patch with
  overlap-clipping). Previously only `active.json`'s single hole rendered.
- **Sharper course aerial (0.6 m → 0.3 m, USGS NAIPPlus)** — the course-wide ground photo now comes
  from High-Resolution Orthoimagery (~0.3 m over urban areas), tiled past the export-size cap and
  mosaicked, so greens / sand / bunkers / cart paths read distinctly; the turf shader leans more on
  the real photo (course-aerial weight 0.90 close / 0.99 far). (`tools/add-course-aerial.mjs`, `scene.js`.)
- **HD hole compiler — foundation (Plan 1)** — the offline contract layer for compiling real
  public geodata (USGS 3DEP elevation + USDA NAIP imagery + cached OSM) into versioned, immutable
  hole bundles the runtime loads with no network. This phase is scaffolding only — no data is
  fetched or rendered yet (that is Plans 2–3):
  - Strict, stage-coded `HdCompileError` with URL/token redaction, cross-platform path-traversal
    guards, and a fail-closed bounded HTTP primitive (`tools/hd-course/{errors,paths,http}.mjs`).
  - A reproducible build-manifest schema + loader and a canonical course fingerprint that excludes
    generated HD green patches; the pinned Bandon Hole 1 manifest ships `discovered:"pending"`
    until a later discovery command resolves bounds/ETags (`tools/hd-course/{config,course-source}.mjs`).
  - A dependency-light runtime bundle validator returning typed `absent | rejected | valid` status,
    with little-endian Float32 terrain decode and hand-rolled PNG/WebP/JPEG header checks
    (`lib/hd-bundle.js`), plus an atomic immutable bundle publisher (`tools/hd-course/publisher.mjs`).
  - Toolchain raised to **Node 22** (drops EOL Node 18) with a Windows CI gate; 54 new offline tests.
- **HD hole compiler — provider ingestion (Plan 2)** — the compiler now ingests real data
  (still offline scaffolding; the live Bandon build is an opt-in capstone):
  - Shared coordinate/grid contracts (local↔WGS84↔UTM, snap to coarse + HD cell lines).
  - Strict 3DEP terrain acquisition — `lib/lidar.js` gains a throwing `fetchPatchStrict`; gameplay's
    best-effort `fetchPatch` is unchanged. Rejects data coarser than the pinned native spacing.
  - Range-only NAIP COG reads via a custom geotiff client bounded to ≤2 in-flight requests — never a
    full-object download — with deterministic pinned-item selection and ETag/length drift guards.
  - UTM→local imagery reprojection (corner-color tested), pure-JS semantic masks, pinned-LUT
    normalization, and deterministic encoding (`terrain.f32` byte-reproducible).
  - An 11-stage compiler behind `npm run build:hd-hole` that validates each staged bundle against the
    Plan 1 runtime validator before the atomic publisher swaps it in. +52 offline tests (151 total).
- **HD hole compiler — runtime integration (Plan 3)** — loads a validated bundle into the live game so
  a compiled hole becomes *viewable*:
  - Physics terrain injection — render and physics ground heights identical (raw h / smoothed grad),
    plus a real NaN-guard fix for a compiler-pre-blended (`edgeBlendM:0`) patch at its exact boundary.
  - Secure asset serving — `GET|HEAD /api/hd-assets/<id>/<key>`, key-allow-listed + range-safe, with no
    path/height leak through course JSON.
  - A verified browser loader (SHA-256 + dimensions, all-or-nothing, idempotent dispose).
  - A unified HD terrain mesh — coarse cells removed inside the snapped HD rect + the HD mesh filling
    it with zero positive-area overlap; the browser sampler has parity with physics.
  - Aerial macro color layered into the PBR turf shader (low-frequency tint; detail/stripes survive).
  - A course-revision readiness handshake (loopback nonce, constant-time compare, bounded-timeout
    procedural fallback) so HD physics activates only after the matching scene is ready.
  - +37 offline tests (188 total). The browser render path is verified in the running app (Plan 4).
- **HD hole compiler — manifest discovery + first live render (Plan 4)** — the pipeline now produces and
  renders a *real* hole bundle end-to-end from open data:
  - A `discover` command (`npm run discover:hd-hole`) resolves a `pending` build manifest into a buildable
    one — pins the canonical course fingerprint, the snapped compilation bounds, and each NAIP tile's live
    content-length + ETag (`tools/hd-course/discover.mjs`). Provider calls are injected so the resolver is
    unit-tested offline; the committed Bandon Hole 1 manifest is now resolved.
  - First live **Bandon Dunes Hole 1** build against USGS 3DEP (≈3 m) + USDA NAIP (0.3 m, 2022), verified
    on screen in the running app — real aerial (fairway mow lines, the green, gorse, waste bunkers) draped
    on continuous high-resolution terrain. This shakes out the previously untested live provider wiring.
  - Two render-wiring bugs the live build surfaced, now fixed: the HD patch edge ring blended toward 0
    instead of the coarse terrain (a baked zero-ring seam cliff) — it now blends to the coarse grid via the
    runtime's shared `gridSampler`, so the patch sits flush; and the legacy LIDAR green patches crashed on
    the HD terrain Group — now cleanly skipped when an HD bundle is active (the aerial supplies the greens).
  - +6 offline tests (194 total).
- **Renderer quality pass (A–G)** — a sweep to take the runtime-procedural course from
  "indie sim" toward a convincing ~6–7/10 (photoreal-named-course specifics remain a future
  baked-content phase). Each system is a `public/render/config.js` flag so it can be toggled:
  - **Planar water reflections** — each pond gets a `THREE.Reflector`, so the tree line and
    banks mirror in the water instead of only the flat sky (`config.waterReflect`, `water.js`).
  - **Richer turf** — multi-scale colour mottling + a mid-scale clump octave + grass-blade
    chroma + a cross-cut mow pattern, so fairways/greens read as varied turf rather than a
    flat carpet (`turf.js`).
  - **Vegetation** — warm pine-straw litter mats under the on-course trees and vivid azalea
    flower beds at the tree lines that frame each hole (`config.pineStraw`, `config.flowers`,
    `vegetation.js`).
  - **Forest framing** — a denser, taller perimeter tree wall so each hole reads as carved out
    of pines, with a touch more aerial-fog depth.
  - **Bunker rakes** — an instanced rake in each sand bunker (`config.props`, `props.js`).
  - **LIDAR green relief** (Phase 1) — real USGS 3DEP elevation drapes finer green meshes so
    putting-surface contours show (`lib/lidar.js`, `lib/elevation.js`).
  - **Foreground grass objects** — a camera-anchored patch of short, dense, distance-faded
    grass blades on the mown corridor (fairway/tee — never greens or rough, which has its own
    fescue), tinted per-instance from the turf zone underneath so the near foreground reads as
    real grass instead of a smooth surface. Blades collapse to nothing past ~22m from the
    camera, so the mid/far field stays the proven shaded turf (no sub-pixel blade smear) and the
    patch re-anchors as the ball moves down the hole (`config.foregroundGrass` + radius/cap/
    height/fade knobs, `grass.js` `buildGrass` `colorAt`/`cameraFade`, `scene.js`).

### Changed
- **GTAO ambient occlusion + filmic bloom enabled** — contact AO darkens tree bases, bunker
  lips and terrain folds; a restrained bloom lifts the hottest highlights (sun glints on water,
  bright sand) without hazing the sky (`config.gtao`, `postfx.js`).
- **Crisp bunkers** — bunkers render as their own sharp-edged polygon meshes with real sand
  PBR instead of a soft painted patch (`turf.js` `makeSandMaterial`, `drape.js`).
- **Turf lush + manicured + sheen finish pass** — play surfaces retuned toward a lush
  TrackMan-style green (fairway/green/base, plus a green Augusta-second-cut rough), with bolder
  cross-cut mow stripes, low-frequency procedural sun-play for gentle 3-D form, and a
  glitter-free specular sheen (smooth single-octave normal perturbation — fbm facets alias
  without TAA — distance-gated so the near turf stays matte instead of wet-vinyl). The
  multi-scale mottling and the dry-zone colour were then calmed so undulating holes read as
  clean lush fairway rather than churned mud (`turf.js`, `scene.js` `COLORS`).

### Fixed
- **No more fescue growing in bunkers** — bunkers map as islands inside a rough polygon, so the
  grass scatter used to sprout tufts in the sand; the scatter now excludes bunker/water areas
  (`scene.js` `_grassSpots`).

## [0.8.0] - 2026-06-21

### Added
- **One-click Windows installer** — `npm run dist` produces an NSIS installer
  (`Open-Birdie-Setup-<version>.exe`) via electron-builder: per-user install (no admin
  prompt), Start Menu + desktop shortcuts, launch-on-finish. Ships unsigned for now
  (Windows SmartScreen → "More info → Run anyway"); a code-signing cert drops in via the
  `CSC_LINK` env var with no rework. App icon generated offline from the existing `pngjs`
  dep (`tools/make-icon.js`, `npm run make-icon`).

### Fixed
- **Course cache works in a packaged build** — the cache lived at an `__dirname`-relative
  path that is read-only inside `app.asar` once packaged, so a packaged install couldn't
  cache downloaded courses. `lib/course.js` now resolves its data dir from `BIRDIE_DATA_DIR`,
  and `main.js` points that at per-user AppData when `app.isPackaged`. Dev (`npm start`) and
  headless (`node server.js`) are unchanged. Regression test added (`test/cache-path.test.js`).

## [0.7.1] - 2026-06-15

### Fixed
- **Malformed launch-monitor packets no longer corrupt the round** — `handleShot` now
  validates/sanitizes ball data and rejects implausible speeds, so one partial/garbage
  frame can't push `NaN` into the physics and permanently break play (it used to stay
  broken until restart). (`lib/game.js`)
- **A course with no playable holes is rejected, not loaded** — `parseOsm` throws and
  `setCourse` guards before mutating, so a bad OSM course can't wedge the app on every
  state read. (`lib/course.js`, `lib/game.js`)
- **Atomic course-cache writes + corrupt-cache recovery** — cache is written via temp+rename
  (an interrupted download no longer bricks startup), corrupt cache files are quarantined
  instead of silently vanishing, and a zero-hole cached course is ignored. (`lib/course.js`)

### Changed
- **HTTP server binds to localhost by default** — the unauthenticated API is no longer
  exposed to the LAN unless you opt in with `BIRDIE_HOST=0.0.0.0`. (`server.js`)
- **`BIRDIE_SPEED_SCALE`** corrects monitors that report ball speed in m/s (which played
  ~2.2× short, silently). (`server.js`)
- Added regression tests for the malformed-packet and zero-hole cases (`test/robustness.test.js`).

## [0.7.0] - 2026-06-15

### Changed
- **Waving pin flag** — the flagstick's flag is now a subdivided cloth rippled in the
  vertex shader (amplitude grows toward the free edge) instead of a rigid faceted cone —
  the shot's focal point now moves with the wind like the grass/trees/water
  (`public/render/scene.js`).
- **Calibrated color grade** — dropped the global blue shadow lift (it tinted turf shadows
  cyan and fought the grass palette) for a warm, slightly-desaturated shadow tone
  (`public/render/postfx.js`).
- **Foliage volume shading** — tree canopies now have a height gradient (dark, cool core
  and underside → bright, warm sunlit top) instead of flat uniform lighting, the biggest
  "video-game tree" fix (`public/render/tree-cards.js`).

### Added
- **Water shoreline foam** — a bright wet/shallows band hugs the waterline where terrain
  sits just under the surface. A one-draw terrain depth pre-pass (`public/render/water-depth.js`)
  feeds the water shader, which compares scene vs water eye-depth and whitens the shallow
  band (animated for a living edge). `config.waterFoam` (`public/render/water.js`, `scene.js`).
- **Distant horizon tree-line** — a jittered tree band around the course perimeter so the
  far horizon reads as a hazy distant forest edge (aerial fog supplies the atmospheric
  falloff) instead of bare turf meeting sky (`public/render/scene.js`, `config.horizonTrees`).

## [0.6.0] - 2026-06-15

### Fixed
- **GPU memory leaks on hole reload** — `loadCourse` now disposes `alphaMap`/`normalMap`/
  `roughnessMap`, the turf's shader-injected textures, and each foliage `customDepthMaterial`
  (previously only `.map` was freed, leaking foliage/turf textures every reload).
- **Per-frame trail material leak** — the shot tracer's `LineBasicMaterial` was reallocated
  every frame (~840 leaked objects/shot); it's now created once and reused.
- Stale per-course wind callbacks are reset on reload; hoisted a per-blade allocation out of
  the fescue build loop.

### Added
- **Deciduous tree variety** — added a broadleaf species (CC0 Jacaranda cluster atlas)
  with a rounded, feathery card canopy, mixed ~30% into the conifer stand for an
  Augusta-style mixed tree line. The tree builder is now species-parameterized
  (`public/render/tree-cards.js`).
- **Tree grounding** — soft contact-shadow decal blobs under each tree so they sit on
  the turf instead of looking pasted on. One instanced, unlit, depth-write-off,
  non-shadowing draped quad per tree (`public/render/grounding.js`, `config.grounding`).
  Chosen over GTAO, which can't run here (its normal pre-pass recompiles our custom
  `onBeforeCompile` materials and fails to compile).

## [0.5.0] - 2026-06-15

### Changed
- **Less uniform turf** — large-scale tonal variation (~50–120m patches) on the grass
  so fairway/rough reads as natural turf rather than a flat green carpet
  (`public/render/turf.js`).
- **Lush card-foliage conifers** — replaced the decimated film-model trees (which
  rendered as bare sticks — their 6.7M geometric needles collapse when decimated to an
  instanceable budget) with procedurally-built foliage cards: a tapered bark trunk plus
  a conical canopy of cross-fan cards textured with the fir's own needle-sprig atlas
  (`public/render/tree-cards.js`). Lush, photoreal, and ~800 tris/tree (vs ~80k),
  dropping the 17MB `conifer.glb` for three ~0.3–0.8MB textures.
- **Denser fescue** — rough grass now scatters in tight, bushy clumps (center-biased
  discs trimmed at the rough edge) instead of an even thin spread, with more blades
  per tuft and taller blades. Reads as real patchy fescue framing the holes rather
  than sparse isolated spikes (`public/render/scene.js`, `grass.js`, `config.js`).

## [0.4.0] - 2026-06-14

### Added
- **Animated water** — course water hazards now ripple and reflect the sky instead
  of sitting as a flat blue plane. An analytic wave field (golden-angle directions,
  non-harmonic frequencies) perturbs the surface normal in-shader to shimmer the HDRI
  reflection, with a Fresnel deep/shallow gradient and a sun-specular term — no texture
  asset, integrates with fog + post-FX (`public/render/water.js`). Gated by
  `config.water` (falls back to the static plane when off).

## [0.3.0] - 2026-06-14

Turf and atmosphere polish on top of the 0.2.0 renderer overhaul.

### Added
- **Bright sand bunkers** — tiled CC0 coast-sand texture (Poly Haven), brightened
  in-shader and mixed in on a dedicated bunker mask so bunkers read as light sand
  rather than flat tan (`public/render/turf.js`, `scene.js`).
- **Fescue / rough grass** — instanced geometry blades (green base → golden tip) with
  vertex-shader wind, clumped into tufts and scattered on the rough; the wispy long
  grass that frames a hole (`public/render/grass.js`).
- **Cinematic color grade** — a display-space grade pass after tone-mapping: gentle
  contrast + saturation, warm-highlight / cool-shadow split-tone, and a soft vignette
  (`public/render/postfx.js`).

### Notes
- Fescue lands as a foundation; density/LOD tuning is a later pass.
- Provenance for the new turf grass + sand textures added to `ASSETS.md`.

## [0.2.0] - 2026-06-14

Photoreal renderer overhaul — the course now reads as a real golf course under a
real sky instead of a flat low-poly scene.

### Added
- **Real sky** — bundled CC0 puresky HDRI for image-based lighting + a believable
  blue sky with clouds (`public/render/env.js`, `atmosphere.js`). Single sun source
  of truth drives the light + shadows.
- **Photoreal trees** — instanced, decimated CC0 pine model (Poly Haven fir,
  ~80k tris) with vertex-shader wind and alpha-cutout canopy shadows, replacing the
  low-poly icosahedron crowns (`public/render/trees.js`).
- **Real turf** — tiled CC0 PBR grass (albedo blade detail + normal + roughness) and
  shader-based mowing stripes gated to mown surfaces (`public/render/turf.js`).
- **Renderer config** — `public/render/config.js` feature flags + quality knobs
  (HDRI, fog, trees, turf, wind, tree cap/scale, GTAO scaffold).
- Node unit tests for the renderer's pure helpers (`test/`).

### Changed
- Replaced the procedural Preetham sky + band-aid exposure with HDRI-based lighting +
  aerial-perspective fog.
- Bundled CC0 art assets in `public/assets/` (offline) with provenance in `ASSETS.md`.

### Notes
- Ambient occlusion (GTAO) is scaffolded but disabled (`config.gtao`) pending a
  cleaner integration with the custom turf shader.
- See `docs/superpowers/specs/` and `docs/superpowers/plans/` for the design + tier plans.
