# Changelog

All notable changes to Open-Birdie are documented here.

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
