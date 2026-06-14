# Photoreal Renderer — Design Spec

**Date:** 2026-06-14
**Status:** Design (awaiting approval → per-tier implementation plans)
**Scope:** Visual upgrade of the Open-Birdie 3D course renderer toward TrackMan-grade photorealism.

---

## 1. Problem & goal

The current renderer (`public/render/scene.js` + `postfx.js` + `textures.js`, three r0.184) reads as a *stylized low-poly game*, not a real golf course. A live render of the current HEAD on Augusta National confirmed:

- Trees are flat, faceted, translucent-looking icosahedron blobs (one archetype).
- The world ends at the course bounding box — an empty, washed-out white horizon.
- Heavy bluish fog washes the midground to near-white; sky is a bare Preetham gradient, no clouds.
- Turf is a single painted canvas splat + one tiled normal map, uniform roughness; mowing stripes are 2D paint.
- No native/fescue grass, flat painted bunkers, flat glossy water, no cart paths.

**Goal:** Chase TrackMan photorealism within the project's constraints.

**Locked constraints (decided with stakeholder):**
- **Asset strategy:** bundle CC0 assets freely (offline — shipped in-repo, no runtime CDN). Maintain an attribution file.
- **Performance target:** desktop-only. Optimize for the sim PC's GPU; ignore the mobile/tablet mirror's visual budget.
- **Fidelity bar:** chase TrackMan photorealism, accepting significant effort.
- **Clouds:** static HDRI clouds now; raymarched volumetric clouds are a later optional stretch.
- **Review rigor:** spec-document-reviewer loop on this doc, then `/plan-eng-review` + `/plan-design-review` on each tier's implementation plan before executing it.

### Non-goals
- 1:1 parity with TrackMan's bespoke per-course hand art (out of scope; "convincingly photoreal" is the bar).
- Mobile/tablet visual quality (functional mirror only; may run a reduced tier or static fallback).
- Changing course data ingestion (OSM/elevation pipeline) — we consume existing data.
- Gameplay/physics changes, except where bunker carving necessarily moves `hAt`/the ball rest height (must be verified, not extended).

---

## 2. Design principles

1. **Fix the light before adding detail.** Wrong exposure/atmosphere makes good assets look bad. The lighting/atmosphere foundation lands first (Tier 0).
2. **One source of truth for the sun.** A single `sunDir` drives the directional light, shadow camera, HDRI rotation, and any cloud/grass shader.
3. **Physically-based, not painted.** Mowing stripes → anisotropic BRDF; bunkers → geometry; depth → aerial-perspective fog.
4. **Reuse existing course data.** Masks and placement derive from existing surface polygons, the surface-classification lookup, `hAt()`, the elevation grid, and `mulberry32`. No new course pipeline. *(Note: the classification lookup `makeSurfaceLookup`/`surfaceAt` currently lives in `lib/course.js` and is consumed only by `lib/physics.js`/`lib/game.js`; the renderer does not import it today — see §4 Tier 2 and §7.)*
5. **Isolated single-purpose modules.** Each system (`sky/env`, `trees`, `turf`, `grass`, `water`, `bunkers`, `postfx`) is an ownable, testable, individually-revertable unit. `scene.js` orchestrates; it does not balloon.
6. **Budgeted & flag-gated.** Every heavy system (grass density, AO, DoF, clouds) has an on/off + quality knob, so we can profile, dial, and isolate regressions.

---

## 3. Architecture overview

`scene.js` becomes a thin orchestrator that wires together focused modules. Proposed module layout under `public/render/`:

```
render/
  scene.js          # orchestrator: camera, frame loop, course load, module wiring
  env.js            # NEW: HDRI load, PMREM env, GroundedSkybox, sunDir source of truth
  atmosphere.js     # NEW: aerial-perspective fog (height/dual-color)
  trees.js          # NEW: instanced foliage-card trees + wind/SSS shader + cutout shadows
  turf.js           # NEW: per-surface PBR splat material (onBeforeCompile), anisotropic stripes
  grass.js          # NEW: instanced Bézier-blade ground cover + fescue, rough-only placement
  bunkers.js        # NEW: height-grid carving (lip/basin) + sand material + raked normal
  water.js          # NEW: animated-normal + fresnel + shoreline-foam water shader
  postfx.js         # EXTEND: GTAO, LUT, vignette, gated Bokeh; final pass order
  textures.js       # EXTEND: procedural masks (region, anisotropy/stripe, raked sand)
  assets.js         # NEW: CC0 asset registry + loaders (offline paths)
  config.js         # NEW: feature flags + quality knobs (single import)
```

Module contract (for each): **what it does**, **its public interface** (e.g. `buildTrees(geo, sunDir, env) -> Group`), and **its dependencies** (course data, sunDir, env, config). A module can be turned off via `config.js` and the scene still renders.

**Asset pipeline:** CC0 source files are processed offline (decimation, atlas baking, ORM packing, resizing) into a committed `public/assets/` tree. `assets.js` loads only the processed files at runtime. `ASSETS.md` (or `docs/`) records every source URL + CC0 license for attribution.

---

## 4. The plan, tier by tier

Each tier is an independent plan → eng/design review → execute → verify cycle. After each tier we re-capture the same Augusta reference frames (tee POV par 3 + long par 5) for before/after proof.

### Tier 0 — Light & atmosphere foundation (do first; biggest impact/hour)

- Replace Preetham `Sky` with a **CC0 HDRI** (Poly Haven 4K `.hdr`, partly-cloudy parkland default; per-course override later) as `scene.background` + `scene.environment` via existing `PMREMGenerator`.
- Add **GroundedSkybox** (`three/addons/objects/GroundedSkybox.js`) sized to course bounds so the HDRI ground/mountains meet the course edge — fills the empty horizon and hides the floating edge.
- Rework fog: replace flat `Fog(0xa6c2d6, 1600, 7000)` with **aerial-perspective fog** — `FogExp2` or a dual-color depth fog (`onBeforeCompile` overriding the fog chunks) tinted to the HDRI horizon band. Near haze neutral, distance tints toward sky.
- Remove the `toneMappingExposure 0.45` and `environmentIntensity 0.5` band-aids; re-balance once against the real HDRI.
- Establish single `sunDir` (read from HDRI sun azimuth/elevation), drive directional light + shadow frustum + HDRI rotation from it.

**Acceptance:** horizon is full and believable; midground no longer washes to white; turf/foliage color reads correct under consistent light; sun direction and shadows agree with the HDRI. **Concrete check:** on the two fixed Augusta capture frames, the midground/horizon turf must no longer clip toward white — verify via a luminance histogram on the captured frames (no large near-1.0 luminance spike in the turf region) and a target neutral mid-gray turf value, so "balanced exposure" is measured, not eyeballed.

### Tier 1 — Trees & vegetation

- Replace icosahedron crowns with **instanced cross-quad foliage cards** via `three-custom-shader-material` (CSM) patching `MeshStandardMaterial`:
  - View-space layered-sine wind driven by a `uTime` uniform (trunks rigid via per-card mask).
  - Fake subsurface/backlight term (wrapped diffuse) tinted leaf-green for the low-sun glow.
  - `alphaTest` (~0.4–0.5) cutout; matching `customDepthMaterial` (same alpha map + alphaTest) so canopies cast cutout shadows, not boxes.
  - 3–4 archetypes (conifer + deciduous), per-instance HSL + scale + inflate variance (extends existing `setColorAt`).
- Keep existing `spots[]` placement, `mulberry32` seeding, `hAt()` grounding, per-instance matrix loop.
- Optionally wire an MSAA composer target if we adopt `alphaToCoverage` for soft edges (else stick with alphaTest + SMAA).

**Assets:** decimated Poly Haven `fir_tree_01` / `pine_tree_01` + a deciduous equivalent → baked foliage atlas; Quaternius textured low-poly trees for variety/fallback.

**Acceptance:** trees read as real conifers/deciduous from the tee POV; canopy shadows are cutout-shaped; no obvious cloning; framerate holds at current instance counts (~4800).

### Tier 2 — Turf & ground cover

- **Per-surface PBR turf:** patch the terrain material via `onBeforeCompile` to **splat-blend 4 PBR surface sets** (fairway / green / rough+tee / bunker-sand) weighted by a **region mask** baked from the surface polygons (reuse `_paintSplat`'s rasterization to output a mask, not final colors). Pack AO+Rough+Metal into one ORM per surface to stay under the 16-sampler limit (promote to `DataArrayTexture` only if >4 surfaces needed later).
  - Slope-masked **triplanar** (whiteout normal blend) on steep faces; **anti-tiling** (IQ technique-3 or stochastic/`gridless`) + macro×detail blend + distance detail fade.
- **Mowing stripes, physical:** switch terrain to `MeshPhysicalMaterial`; bake an **`anisotropyMap`** (RG = grass-comb direction bands, B = strength) from the existing stripe geometry so bands brighten/darken with view angle. Optional normal/roughness modulation as augment.
- **Instanced ground-cover grass:** GPU-instanced Bézier-blade grass (fork of `CK42BB/procedural-grass-threejs`, WebGL2 path) — vertex-shader layered wind, per-clump color/height, fake translucency.
  - Placement: candidate points (jittered grid / `MeshSurfaceSampler`) kept only where the surface is rough; **tall golden fescue** banded just outside fairway/green polygons; height via `hAt`, orientation via grid normal, deterministic via `mulberry32`.
  - **Plumbing dependency:** the surface lookup (`makeSurfaceLookup`/`surfaceAt`) lives in `lib/course.js` and is not currently imported by the renderer. The Tier 2 plan must either (a) wire `makeSurfaceLookup(course)` into the render layer, or (b) derive the rough mask directly from the surface polygons via the same rasterization `_paintSplat` already does. Pick one explicitly at plan start; do not assume `surfaceAt` is callable from `scene.js`.
  - LOD: real blades near camera + per-hole frustum; alpha-card clumps at distance; aggressive frustum/distance culling (reuse per-hole shadow bounds). Blades receive terrain shadow; only nearest LOD casts (or skip cast) to protect the 4096 shadow budget.

**Assets:** ambientCG `Grass004` (+ darker/tighter variant for greens, coarser for rough) and a CC0 fine sand, 4K, maps = Color(sRGB)/NormalGL/Roughness/AO/(Displacement); Poly Haven `grass_medium_01` dry variant for fescue cards.

**Acceptance:** fairway/green/rough/sand are visibly distinct materials with no carpet-repeat; stripes invert with view angle; fescue lines the rough edges and moves in wind; framerate holds with grass enabled near camera.

### Tier 3 — Polish

- **AO:** `GTAOPass` with small world-space `radius` (~0.5–1.5 m) + steep `distanceExponent`/`thickness` so it only darkens contact (trunks, bunker lips) and never haloes over the far plane (the bug that got AO removed before). Layer-mask multiply as escape hatch.
- **Bunkers as geometry:** carve the height grid inside bunker polygons (raised lip ring + lowered basin; densify grid near rims), sand PBR material (roughness ~0.85–0.95), procedural raked-sand normal (concentric/parallel ridges, baked like `grassNormalTexture`). Verify `hAt`/physics: ball now rests lower — confirm shot logic still correct.
- **Water:** custom shader on the existing `ShapeGeometry` plane — dual scrolling normal maps + fresnel env reflection + depth-based shoreline opacity/foam. No extra scene renders (vs stock `Water`/`Water2` which re-render per pond). Animate via `clock.elapsedTime` in `_frame()`.
- **Grade & furniture:** `LUTPass` with a bundled `.cube` grade (after `OutputPass`) + subtle custom vignette `ShaderPass`; cart paths (spline-draped gravel ribbon, ~1.5–3 m, +0.05 m offset); flag cloth wave + recessed cup liner + tee markers.
- **Final pass order:** `RenderPass → GTAOPass → [BokehPass, gated to idle/address only] → UnrealBloomPass → OutputPass → LUTPass → VignetteShaderPass → SMAAPass`. (GTAO/Bokeh/Bloom in linear HDR before tone map; LUT/vignette in display space after; SMAA last to preserve the screenshot path.)

**Assets:** ambientCG sand + gravel (2–4K, Color/NormalGL/Roughness/AO); reuse three's `waternormals.jpg` or a CC0 water normal; an authored `.cube` LUT (subtle teal-shadow/warm-highlight).

**Acceptance:** contact AO present with no far-plane halos; bunkers have real lip/depth and self-shadow; water moves and reflects sky with a soft shoreline; final image has a cohesive cinematic grade; framerate within budget with all passes on.

---

## 5. Performance budget & flags

- Target: stable 60 fps on the sim PC's desktop GPU at the capped pixel ratio (≤2), with all default-on systems enabled. **Measured as:** sustained average ≥60 fps AND 1%-low ≥45 fps over a scripted ~10 s flythrough of a representative hole, plus no stutter on the static idle/address frame. The first tier that adds a heavy system (Tier 1) pins the exact measurement script.
- `config.js` flags (default state in parens): `hdriEnv(on)`, `groundedSky(on)`, `foliageTrees(on)`, `pbrTurf(on)`, `anisoStripes(on)`, `groundGrass(on)`, `gtao(on)`, `bunkerGeo(on)`, `waterShader(on)`, `lut(on)`, `vignette(on)`, `dof(off)`, `volumetricClouds(off)`.
- Quality knobs: grass density + draw radius, shadow map size, GTAO radius/samples, HDRI background resolution (separate small env-bake vs large background).
- Profiling gate per tier: capture frame time before/after; any system that can't hit budget ships off-by-default with a documented reason.

---

## 6. Testing & verification

- **Visual regression:** the established headless capture harness (render-to-canvas → local sink → file; documented in memory `preview-webgl-screenshots`) re-shoots the two fixed Augusta frames after every tier. Before/after pairs are the acceptance evidence.
- **Determinism:** placement (trees, grass) seeded by `mulberry32` so frames are stable between loads and comparable across runs.
- **Physics guard (Tier 3):** existing shot/putt tests must pass after bunker carving; add a check that ball rest height inside a bunker is below the lip.
- **Console/error gate:** no WebGL warnings (sampler limits, sRGB/linear mismatches) introduced; checked via preview console logs.
- **Offline check:** app renders with no network (all assets local).

---

## 7. Key risks & gotchas (carried from research)

- **sRGB/linear discipline:** albedo/atlas = `SRGBColorSpace`; normal/roughness/AO/anisotropy/alpha/data + HDRI env = linear/`NoColorSpace`. #1 source of "looks subtly wrong."
- **Alpha foliage shadows:** require a `customDepthMaterial` carrying the same alpha map + alphaTest, or canopies cast solid boxes.
- **`alphaToCoverage` needs MSAA** on the composer target; the current SMAA-only chain won't trigger it. `alphaHash` needs TAA/SSAA, not SMAA.
- **GTAO halos** over the 12 km far plane — small radius + steep falloff first; mask-multiply as fallback.
- **Sampler limit (16):** pack ORM; cap at 4 surface sets before moving to texture arrays.
- **Triplanar normals** must use whiteout/swizzle blend; apply only on slope mask (3× fetches).
- **Water reflection cost** scales per pond — custom env-reflection shader avoids per-pond scene re-renders.
- **Bunker carving moves `hAt`/physics** — gameplay verification required, not just visual.
- **Exposure rebalance** must happen once after HDRI; do not carry the 0.45/0.5 band-aids forward.
- **Sun consistency:** one `sunDir` or shadows/HDRI/clouds disagree.

---

## 8. Decomposition & sequencing

1. Tier 0 (foundation) — plan → eng/design review → execute → verify.
2. Tier 1 (trees) — same cycle.
3. Tier 2 (turf + grass) — same cycle (may split turf vs grass into two plans).
4. Tier 3 (polish) — same cycle (AO, bunkers, water, grade/furniture may split).

Each tier is independently shippable and revertable. Asset processing for a tier happens within that tier's plan.

---

## 9. Open questions (non-blocking; resolve in tier plans)

- HDRI selection per course/biome (single default vs a small set keyed by course terrain type).
- **(Resolve at START of the Tier 1 plan — architectural fork, costly to reverse later):** introduce an MSAA composer target for `alphaToCoverage` soft foliage edges, or stay alphaTest + SMAA.
- **(Resolve at START of the Tier 2 plan — architectural fork, costly to reverse later):** turf material hand-rolled `onBeforeCompile` vs adopting `three-landscape`'s `TerrainMaterial` wholesale.
- Grass: fork vs vendor `CK42BB/procedural-grass-threejs`.
- Exact split of Tier 2/Tier 3 into sub-plans.
