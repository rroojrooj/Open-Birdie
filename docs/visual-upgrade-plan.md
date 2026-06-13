# Open-Birdie Visual Upgrade Plan

> Status: **Steps 1–2 + procedural part of Step 3 shipped (1.5/10 → 5/10).**
> The lighting/grade/relief lanes are tapped out; the remaining 5 → 6-7 lever is the
> turf **albedo material** (bundled CC0 PBR tiles + per-surface split), not more
> post-processing.
> Produced via research + an engineering plan review + an independent outside-voice red-team.
> This doc is self-contained so a fresh coding session can pick it up cold.
> See the **Progress log** at the bottom for what shipped, the tuned constants, and
> the independent before/after critique arc.

## Goal

The procedurally-generated golf course currently reads like a low-poly, blocky game world.
Make it read like a credible sim (closer to premium commercial golf simulators) **without
abandoning the open-data procedural pipeline** (OpenStreetMap geometry + AWS terrain tiles,
generated at load time in the browser/Electron).

All rendering lives in `public/render/scene.js` (a ~604-line `GolfScene` class). The course
is loaded by `public/app.js` → `loadGeometry()` → `scene.loadCourse(geo)`. The dev/runtime
server is `server.js`. Three.js is loaded via the importmap in `public/index.html`
(`three/addons/` → `/vendor/three/examples/jsm/`).

---

## The core finding (why it looks "fake")

The biggest lever is **lighting and color grade, not missing textures.** Evidence in
`scene.js`:

- `toneMappingExposure = 0.55` (line ~50) crushes the image dark.
- Light is counted three ways: directional sun intensity `2.6` (line ~120), a `0.45`
  hemisphere fill (line ~127), AND a PMREM-baked Sky environment map (lines ~114-117).
- Base surface colors are hand-saturated (`COLORS`, line ~29: `#4f9040`, `#55ab57`) and
  painted straight into the splat canvas with no value variation.

Adding PBR textures on top of that pipeline produces a textured version of the same blocky
look. Fix the light first.

For reference, premium commercial golf sims do **not** generate procedurally. Their courses
are hand-built in a game engine from LIDAR/photogrammetry over weeks, with 4K PBR textures,
high-end library assets, baked global illumination, and heavy color grading. We cannot match
that content pipeline; we can close most of the *perceived* gap with real-time technique. The
realism trick is mostly lighting, grade, and post-processing, not raw asset count.

---

## Locked decisions

- **D1 — Bundle assets in the repo.** Any CC0 textures / tree art go in `public/assets/`,
  committed, served by `server.js`. Preserves the offline behavior and keeps licensing clean
  (CC0 only: Poly Haven, ambientCG). This extends to the post-FX addon JS: packaged Electron
  must ship `three/examples/jsm` or `EffectComposer`/passes 404 offline.
- **D2 — Refactor before features, just-in-time per module.** Extract `PostFX` with Step 1,
  `Vegetation` with Step 2, `TerrainPainter` with Step 3. Behavior-preserving refactor first,
  then the behavioral change. Not one monolithic refactor up front.
- **D3 — Grade and lighting first; the screenshot is the reassess gate.** Steps 3-4 (the
  expensive 80%) are conditional on what the Step 1 screenshot shows.
- **D4 — Trees stay volumetric instanced geometry.** Improve the crown mesh; do **not**
  switch to cross-billboards. The camera orbits 360° at ground level (`_inputs`,
  `pointermove` yaw), and billboards show flat seams under free orbit. The current lit
  icosahedron crowns with per-instance HSL variation already read as 3D volume from any angle.

---

## Build order

```
STEP 1  Lighting + color grade  <- cheapest, highest impact, REASSESS GATE
  - exposure 0.55 -> ~1.0; rebalance sun(2.6)/hemi(0.45)/env so light isn't triple-counted
  - desaturate base COLORS (let light do the work, not the paint)
  - EffectComposer: bloom + SMAA only. SAO/SSAO DROPPED (flat height-grid terrain has
    nothing to occlude; it haloes over the 12000 far plane).
  - handle preserveDrawingBuffer (screenshot/recording feature relies on it) vs composer
    render targets; resize() must also call composer.setSize + setPixelRatio.
  - extract PostFX module (D2).
  - SCREENSHOT before/after  ->  decide whether Steps 3-4 are still worth it.
        |
        v  (only if the regraded scene still falls short)
STEP 2  Better instanced tree crowns
  - stacked cones / noisier crown mesh, a few species; reuse existing InstancedMesh + HSL.
  - no new image assets. extract Vegetation module (D2).
        |
        v  (only if still needed after 1-2)
STEP 3  THE HEAVY LANE (bundle assets + async + tiers, together)
  - async loadCourse + load-token guard + 404 -> flat-color fallback (CRITICAL gaps).
  - fix app.js un-awaited loadGeometry caller (setHole/hAt run against half-built scene).
  - PBR ground = a material-system rewrite, NOT "reuse the canvas":
      * _paintSplat currently emits a finished colored ALBEDO, not a region mask.
        Rewrite it to emit region-ID channels (R=grass, G=sand, B=bark...).
      * world-space UVs in-shader (current terrain UV is a single 0..1 stretch over the
        whole course; tiling needs world-space).
      * mask resolution: ppm = min(2.2, 4096/maxExtent) ~= 2.7 px/m on a 1500m course,
        which mushes fairway edges. Need higher-res mask near the ball or detail-tiling
        decoupled from the mask resolution.
  - RENDER_CONFIG quality tiers + a real mobile-detection signal (devicePixelRatio / GPU
    string). The README sells a tablet/phone mirror, so mobile is a first-class client.
  - extract TerrainPainter module (D2).
        |
        v  (polish, may be cut)
STEP 4  Grass
  - redesign for the STATIC tracer cam + idle cam, NOT radius-around-ball (a moving radius
    leaves a visible grass/no-grass ring on the tracer shot, where the camera is static and
    the ball flies 200m+ away).
  - instanced tapered blades, vertex-shader wind (global sway + gust + per-blade), behind
    the mobile tier gate. Mobile: off by default or a small capped count.
```

---

## Review findings (reference)

Format: `[severity] (confidence/10) file:line — finding`.

### Architecture
- `[P1] (9/10) scene.js:169` — `loadCourse` is synchronous; PBR/asset loading forces it
  async. Needs async + a load-token guard so a second course load can't race the first into
  a wrong-course render. (Step 3.)
- `[P1] (8/10)` — offline behavior. Assets must be bundled and served locally, not fetched
  from a CDN (a one-way door against the README's offline behavior). Resolved by D1.
- `[P2] (7/10) scene.js:585` — single `renderer.render()` call. Post-FX needs EffectComposer
  + passes; use the stock passes, do not hand-roll. (Step 1.)
- `[P3] (8/10)` — module boundaries: new systems should be siblings under `public/render/`,
  not more methods on `GolfScene`. Resolved by D2.

### Code quality
- `[P2] (9/10) scene.js:279 (fillKind) + scene.js:310 (_stripedLayer)` — duplicated
  polygon-trace + per-kind fill loop. DRY into one `forEachSurface(kinds, cb)` before adding
  texture blending.
- `[P2] (8/10)` — `GolfScene` is a god-class; will cross ~900 lines. Extract modules. (D2.)
- `[P3] (7/10)` — magic constants (blur radii, stripe widths, tree cap 4800 at scene.js:369,
  grass density) should live in a central `RENDER_CONFIG` keyed by quality tier.

### Tests (rendering is visual; right-size, do not unit-test everything)
- **CRITICAL** asset-load 404 must fall back to the current flat-color material, never a
  black course. Error handling, not just a test.
- **CRITICAL** course-switch race: load-token guard + a test firing two loads asserting only
  the latest renders.
- Recommended: a headless screenshot smoke harness (`tools/test-render.js` style, matches the
  existing `tools/test-*.js` convention). One smoke per step.
- Existing physics tests (`npm run calibrate`) are retained and unaffected.

### Performance
- `[P1] (8/10)` — grass instance counts: the 50k-200k figures are desktop/WebGPU. Gate behind
  a quality tier + radius; hard mobile cap (~15-25k) or off.
- `[P2] (8/10)` — `_paintSplat` already builds up to a 4096px canvas (scene.js:245). Tiling
  PBR (3 x 2K) adds ~50MB GPU memory before grass. Budget it; 1K on the mobile tier.
- `[P2] (7/10)` — SAO is the most expensive post pass AND near-useless here (flat terrain).
  Dropped.
- `[P3] (7/10)` — shadow map is 2048^2 (scene.js:122). Tie to the quality tier.

---

## Outside-voice findings (independent red-team, all folded in)

1. (9/10) The fake look is the lighting/grade, not textures. **Reordered the whole plan.** (D3)
2. (8/10) Cross-billboard trees are a downgrade under this free-orbit ground camera. (D4)
3. (7/10) SAO near-useless on flat height-grid terrain + haloes over the far plane. Dropped.
4. (7/10) EffectComposer landmines: `preserveDrawingBuffer`, `resize()` must size the
   composer, packaged Electron must ship the addon JS. Folded into Step 1 + D1.
5. (8/10) The splat canvas is a finished albedo, not a blend mask. Step 3 is a material-system
   rewrite (region IDs + world-space UVs + mask resolution). Scope corrected.
6. (6/10) Tune sequencing: grade before PBR; the baked env map desyncs from the per-course
   sun reposition (`_fitShadows` moves the sun but not the baked environment).
7. (7/10) `app.js` `loadGeometry` calls `loadCourse` un-awaited then runs `setHole`/`hAt`;
   the async refactor is not local to scene.js. Folded into Step 3.
8. (6/10) Grass "radius around the ball" assumes a chase cam; this game uses a static tracer +
   idle cam. Redesign or cut. Folded into Step 4.
9. Highest-leverage single change: do the grade/lighting pass first and screenshot it; you may
   find half the plan unnecessary. Adopted as D3.

---

## NOT in scope (deferred, with rationale)
- Photogrammetry/LIDAR course meshes — different product (kills auto-generation).
- Volumetric clouds / god-rays — atmosphere polish, after the base reads right.
- Water screen-space reflections — current flat physical material is acceptable.

## Unresolved decisions (decide at build time, non-blocking)
- Mobile grass: off by default vs small capped count (lean off).
- Mobile texture resolution: 1K vs 2K (lean 1K); only relevant if Step 3 happens.

## Asset sourcing guidance (if Step 3 happens)
- Use **CC0 only** (Poly Haven, ambientCG): legally safe to commit under the repo's MIT
  license, no attribution burden. Avoid CC-BY and "free for personal use".
- Ground: grass/sand/bark albedo + **normal** + **roughness** (the normal maps are the point;
  they turn flat plastic into lit turf). The scene already bakes a Sky env map, so PBR
  surfaces light correctly with no new lighting work.
- Keep dynamic things procedural (grass blades, water ripples, sky tint, mow stripes).

---

## Implementation tasks
- [ ] **T-grade (P1)** — Step 1: exposure + light rebalance + desaturate COLORS + EffectComposer
  (bloom + SMAA, no SAO). Extract `PostFX`. Handle `preserveDrawingBuffer` + composer resize.
  Render before/after screenshot. Files: `public/render/scene.js`, new `public/render/postfx.js`.
- [ ] **T-trees (P2)** — Step 2: better instanced crown mesh, extract `Vegetation`. No assets.
  Files: `public/render/scene.js`, new `public/render/vegetation.js`.
- [ ] **T-async (P1, only with Step 3)** — async `loadCourse` + load-token guard + 404
  flat-color fallback; fix `app.js` un-awaited caller. Files: `public/render/scene.js`,
  `public/app.js`. Verify: course-switch race test + offline smoke.
- [ ] **T-tiers (P1, with Step 3)** — `RENDER_CONFIG` quality tiers + mobile detection.
- [ ] **T-pbr (P2, Step 3)** — rewrite `_paintSplat` to emit a region mask; world-space UVs;
  tiling PBR ground. Extract `TerrainPainter`. Files: new `public/render/terrain-painter.js`.
- [ ] **T-grass (P3, Step 4, may cut)** — instanced wind grass redesigned for the static
  tracer/idle cam, behind the mobile tier gate.

## Verdict
Eng review CLEARED. Plan reviewed, red-teamed, rescoped. Start at Step 1 (small, reversible:
a handful of constants + one bloom pass), screenshot it, then decide whether the heavy lane
(Step 3) is worth building.

---

## Progress log

### Steps 1–2 — DONE (lighting/grade + sky + surface contrast + better trees)
New module `public/render/postfx.js` (`PostFX`): EffectComposer with
RenderPass → UnrealBloomPass → OutputPass → SMAAPass, wired into `scene.js`
(`_frame` → `postfx.render()`, `resize` → `postfx.setSize`). `preserveDrawingBuffer`
is retained and the final pass renders to screen, so the screenshot/recording path
still works.

Key reversal vs the original diagnosis: the scene was **over-exposed, not crushed
dark**. Raising exposure to 1.0 (as Step 1 first proposed) blew the sky and turf to
white. Verified on-screen, so the grade went the other way.

Tuned constants now in the source (arrived at by live tuning against rendered
screenshots of Augusta + Bandon):
- `toneMappingExposure`: 0.55 → **0.48**
- Sky uniforms: turbidity 8→**2.5**, rayleigh 2.2→**2.0**, mie 0.005→**0.0022**
  (clearer, bluer, less white haze). Sun elevation 34°→**30°** for raking shadows.
- Sun `DirectionalLight`: 2.6 → **2.4**, warmer (`0xfff4e0`).
- `HemisphereLight`: 0.45 → **0.25**; `scene.environmentIntensity` = **0.5**
  (the ambient fill was triple-counted: sun + hemisphere + full-strength env).
- `Fog`: `0xbcd2e8, 700, 5200` → `0xb8cfe0, 2200, 9000` (was washing the whole
  midground; now only the far distance hazes).
- `COLORS`: re-spread by **value** (dark rough → light fairway → lighter green)
  so the hole reads as a hole, while staying muted enough not to go neon.
- Terrain material roughness 0.95 → **0.97** (matte turf).
- Trees: crown is now a per-vertex-displaced detail icosahedron (organic, not a
  perfect blob); trunks cast shadows; crowns receive.
- **Bloom dropped to near-zero (strength 0.05).** The Preetham sky is broadly
  bright, so any real bloom strength haloes the entire sky into a wash — same
  evidence-based call as dropping SAO. SMAA is the part of the post chain that
  actually earns its place.

### Independent before/after critique
Same outside critic, blind: **1.5/10 → 4/10.** Verdict went from "first-week
three.js tutorial" to "borderline yes, a layperson would say 'golf course' at a
glance." Credited: color grade/contrast (biggest win), sky/atmosphere, trees for
scale, water, terrain shadows.

### Step 3 (partial) — DONE: procedural turf relief, sharper shadows, macro variation
Chose **procedural over bundled textures** (keeps the zero-asset/offline ethos):
- New `public/render/textures.js` (`grassNormalTexture`): a tileable, in-canvas
  grass-relief **normal map**, applied to the terrain material and tiled at
  **world scale** (~every 2.5m via `normalMap.repeat = extent / tileM`, sharing
  the terrain's 0..1 uv). This is what broke the "carpet" look — but only at
  **golfer eye-level**, where the grazing sun rakes the relief. From an elevated
  camera the per-meter relief goes sub-pixel.
- `_paintSplat` now lays down **macro mottling** (large soft soft-light patches)
  before the surface fills, so the turf still reads as varied grass from above.
- Shadows sharpened: shadow map 2048 → **4096**, frustum fit tightened
  (`*0.62 + 70`), `normalBias` 0.5 → 0.35 — tree shadows read as canopies, not
  ink-blots.
- Grade richened: exposure 0.48 → **0.45**, fog `0xa6c2d6, 1600, 7000` (deeper,
  closer — greens read richer, horizon recedes).

Independent score after this pass: **5/10** ("a green hilly golf-ish landscape,
not yet a real course"). The eye-level turf is no longer carpet; the lighting/grade
lane is now tapped out (diminishing returns confirmed).

### The remaining 5 → 6-7 lever is the turf MATERIAL (not more post-processing)
Three critic rounds agree the #1 cap is now the grass **albedo**, not relief:
1. **Grass albedo is uniform noise** — no real mowing stripes, no fairway/rough/
   green texture split, no blade grain near camera. This is the largest surface
   on screen and the flattest. Likely needs **bundled CC0 grass/sand albedo +
   normal + roughness** (Poly Haven / ambientCG) and a per-surface material split
   — i.e. the `_paintSplat` → region-mask + world-UV rewrite the plan describes,
   now feeding real PBR tiles instead of a flat color. The procedural normal got
   the relief; the albedo grain is what's left.
2. **Trees** are flat uniformly-lit billboards with no AO grounding (they float);
   need species/size/color variety + contact AO.
3. **Bunkers** are soft tan smears (no lip/shadow); **water** is flat solid blue
   (no shoreline/specular). Both increasingly conspicuous now that turf has detail.
4. Soft fairway "spotlight" at the ball = the lighter fairway/tee polygon softened
   by the `_paintSplat` blur; the region-mask rewrite (item 1) removes it.

### Score arc
1.5 (baseline) → 4 (lighting/grade + sky + surface contrast + trees) → 5 (turf
detail-normal + macro variation + sharper shadows + grade). Verified on Augusta
(parkland) and Bandon (links).

### Verification method (no cached courses ship in the repo)
Courses were downloaded live from OSM and cached to `data/courses/` (gitignored):
Augusta National (831 trees — parkland showcase), Le Golf National, Bandon Dunes
(treeless links). Rendering was captured headlessly via `canvas.toDataURL`
(`preserveDrawingBuffer`) POSTed to a throwaway local sink, because the preview
screenshot tool stalls on the continuous `setAnimationLoop`.
