# Changelog

All notable changes to Open-Birdie are documented here.

## [Unreleased]

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
