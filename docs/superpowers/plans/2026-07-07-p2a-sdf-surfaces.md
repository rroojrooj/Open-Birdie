# Phase 2a — SDF crisp surface delineation (sub-plan)

> Sub-plan of [`2026-07-06-reality-master-plan.md`](2026-07-06-reality-master-plan.md) Phase 2. REQUIRED
> SUB-SKILL after `/plan-eng-review`: superpowers:subagent-driven-development or executing-plans.
>
> **P2 is split** (it is the biggest phase, ~8-13 d, two loosely-coupled subsystems). This plan is **P2a: the
> geometry of edges** (crisp mow lines, fringe/collar, absorb the deferred dot-screen/seam). **P2b: turf light
> response** (detail-normal octaves + stripes-as-anisotropy, not albedo) gets its own sub-plan AFTER P2a ships —
> the light response rides on the crisp fairway P2a produces, so edges come first.

**Goal:** surface boundaries read as **mow lines**, not multi-metre airbrush feathers. Greens/fringe/collar,
fairway/rough, and bunker edges get a crisp ~**10-20 cm** transition with an automatic fringe/collar ring;
"sticker-green blobs" at distance are killed. The P0a-deferred **classmap dot-screen** + **HD macro tonal
seam** are absorbed here (they live in the same `turf.js` composite this rewrites — do them once).

**The core bet — signed distance fields (SDF).** A signed-distance texture stores, per texel, the distance to
the nearest surface boundary (negative inside, positive outside). `smoothstep(0, w, sdf)` then yields a crisp
edge of width `w` (10-20 cm) **even at the mask's ~0.45 m/px resolution** — that is the whole point of SDF:
sub-texel-crisp edges from a low-res field, because the edge is reconstructed from a smooth distance, not a
hard alpha. Fringe/collar = a band at a fixed SDF offset from the green boundary. **[Layer 1]** distance
transform: separable Felzenszwalb (exact Euclidean, O(pixels), one pass at course-load).

**Diagnosis already done (grounded — do not re-derive):**
- `_paintMask(b, kinds, colors)` (`scene.js:635`) rasterizes surface polys → a packed mask canvas at
  `ppm = min(2.2, 4096/maxExt)` (~0.45 m/px on a big course) with a 1px blur. **This is the SDF input.**
- Current green edge = an 8-tap AVERAGE dilation `gBlur` of the green channel → `gEdge`/`fr` over ~**1.8 m**
  (`turf.js:199-211`). That soft blur IS the "airbrush" P2a replaces with an SDF-driven tight edge + collar.
- Fairway/rough uses the mown gate `m` (mask .r) with a `smoothstep` edge (`edgeW`, `turf.js:100`) — also soft.
- Bunker edge = `uBunker` mask .r (soft). Sand halo bands come from this.
- `customProgramCacheKey` = `'turf-grain-v32'`/`-macro`. GTAO trap: any new `texture2D` sample must stay
  inside `#ifdef USE_MAP`. Every `turf.js` shader-text change bumps the cache key + updates `hd-turf.test.mjs`.
- Deferred-here bugs: the dot-screen is the NoColorSpace packed classmap leaking as a stipple; the macro seam
  is the un-feathered HD-patch macro-tint edge. Both are `turf.js`-composite / macro-tint issues (NOT the HD
  patch geometry — never touch `courseFingerprint` / `elevation.patches`).

**Tech stack:** a new pure SDF module (JS distance transform) + its test, `scene.js` (`_paintMask` → SDF
builder + a new SDF texture in `_turfInputs`), `turf.js` (edge-blend rewrite + fringe/collar + dot/seam fix),
the committed 6-frame fixture + a green-cam framing, `node --test`.

---

## Task 0: SDF spike GATE — prove a crisp 10-20 cm edge from a 0.45 m/px field (HARD go/no-go)

**Files:** `scratchpad/` probe only. **Output:** a validated distance-transform + shader-edge approach + the
resolution/perf numbers; gates Tasks 1-5.

- [ ] **Step 1:** In a Node/scratch probe, rasterize a real Chambers green polygon at ~0.45 m/px, run the
  separable Euclidean distance transform (signed: inside negative), normalize to a metre range (say ±8 m), and
  dump the field. Confirm the transform is correct (distances match hand-checked points) and fast (<300 ms for
  a 4096² worst case, run once at load).
- [ ] **Step 2 (the real risk):** in the live shader (or a minimal quad), sample the SDF and
  `smoothstep(0, edgeW, sdf)` at `edgeW` ≈ 0.15 m. Verify at the GREEN CAM the edge is crisp AND stable (no
  wobble/aliasing/staircasing) despite the 0.45 m/px field. Try a green-cam + an overview frame.
- [ ] **Step 3 — GATE:** if a stable 10-20 cm edge holds at both ranges, lock the transform + edgeW + the
  metre-normalization and proceed. **If the field is too coarse** (edge wobbles / needs >2.2 ppm, blowing the
  4096 cap on long holes), STOP and re-scope: either a higher local ppm around greens only, or accept a wider
  (~0.4 m) edge. Do NOT build the shader rewrite on an unvalidated field.

---

## Task 1: Pure SDF builder module (TDD)

**Files:** create `public/render/sdf.js`; `test/sdf.test.mjs` (create).

- [ ] **Step 1 (TDD):** `test/sdf.test.mjs` FIRST — `signedDistanceTransform(binaryMask, w, h, metresPerPx)`
  returns a Float32Array where a point 1 texel inside a straight edge ≈ `-metresPerPx`, 1 outside ≈
  `+metresPerPx`, interior far points are large-negative, and a known small square's centre distance matches
  its half-width. Monotone across the edge. Run → fail.
- [ ] **Step 2:** Implement the separable Felzenszwalb 1D EDT (two passes: rows then cols on the squared
  distance), signed by the inside/outside mask, scaled by `metresPerPx`. Pure, no DOM/three. Run → pass. Full
  `npm test` green.

## Task 2: Build per-class SDF textures at load (scene.js)

**Files:** `public/render/scene.js` (`_paintMask` neighbourhood → an `_buildSdf` that rasterizes then EDTs;
add the SDF texture(s) to `_turfInputs`).

- [ ] **Step 1:** Add `_buildSdf(b, kinds)`: rasterize the polys (reuse `_paintMask`'s raster), read the alpha
  to a binary mask, run `signedDistanceTransform`, pack the normalized SDF into a texture channel (a
  `DataTexture`, `NoColorSpace`, linear filter). Build a green SDF + a mown (fairway) SDF + a bunker SDF (or
  pack three classes into RGB of one SDF texture to save memory — decide in Task 0/1).
- [ ] **Step 2:** Add the SDF texture to `_turfInputs` (so BOTH base + HD-patch materials get it, like
  `uCourseDry`). Guard: aerial-less/edge cases default to the old soft path (no crash). Verify no console error
  on Chambers + Sawgrass load.

## Task 3: Shader edge-blend rewrite — crisp edges + auto fringe/collar (turf.js)

**Files:** `public/render/turf.js` (replace the `gBlur` soft dilation + `edgeW` with SDF reads; cache key v33).

- [ ] **Step 1:** Add the SDF uniform(s) + GLSL decl. Replace the green membership: `gEdge =
  smoothstep(-edgeW, edgeW, -greenSdf)` (crisp 10-20 cm). Derive the collar as an SDF offset band:
  `collar = smoothstep(0, cw, greenSdf) * (1 - smoothstep(cw, 2*cw, greenSdf))` (a ring just OUTSIDE the green).
  Replace the fairway/rough `edgeW` and the bunker edge the same way. Keep everything inside `#ifdef USE_MAP`
  (GTAO trap). Bump `customProgramCacheKey` v32→v33 (both variants) + update `hd-turf.test.mjs`.
- [ ] **Step 2:** Verify at the GREEN CAM: green edge is a crisp mow line with a distinct fringe/collar ring,
  not a 1.8 m airbrush; fairway/rough + bunker edges crisp; greens don't "sticker" at overview. `npm test` green.

## Task 4: Classmap/SDF reconciliation + absorb the dot-screen & macro seam

**Files:** `public/render/turf.js` (the classmap union + macro composite).

- [ ] **Step 1:** Where OSM-known SDF edges and the feathered NDVI classmap both exist, the crisp SDF edge
  takes precedence; the classmap union stays only for COVERAGE (surfaces OSM missed). Ensure the classmap
  composites as smooth coverage (kills the P0a dot-screen — the NoColorSpace stipple).
- [ ] **Step 2:** Feather the HD-patch macro-tint edge into the course-wide tint (the deferred macro seam),
  using the same SDF/edge machinery or a soft alpha ramp. Do NOT touch `courseFingerprint` inputs.
- [ ] **Step 3:** Verify `ov_high`: no dot-screen, no rectangular tonal seam; Chambers + Sawgrass classmap
  behaviour unregressed; `npm test` green.

## Task 5: Tune + verify on the sweep (the REAL gate)

**Files:** tuning constants; `docs/TODO.md`, `docs/HANDOFF.md`.

- [ ] **Step 1:** Capture the 6-frame fixture + a green-cam framing for Chambers AND Sawgrass, before/after.
  Targets: mow-line edges at the green cam; fringe/collar ring reads; no sticker-greens; no dot-screen/seam;
  P1b tan + registration + QL1 relief + sky unregressed. Iterate `edgeW`/collar width.
- [ ] **Step 2:** Update `docs/TODO.md` + `docs/HANDOFF.md`; note P2b (turf light response) is the next
  sub-plan.

---

## P2b — turf light response (OUTLINED, next sub-plan after P2a ships)

- Two detail-normal octaves + roughness breakup noise (`turf.js` `normal_fragment_maps` — extends the tiltV at
  `:327`); **stripes as light response** — the albedo band (`turf.js:256`) becomes a small normal-Y flip /
  anisotropic sheen driven by the stripe mask, NOT a colour band; stripe width 7 m → 3-4 m. Fixes the
  "vinyl/beach-towel" play-height read. Its own Task-0 (does anisotropic sheen read at the orbit cam?) + review.

## Verify / done (P2a)

- 6-frame sweep + green cam, Chambers + Sawgrass, before/after: crisp mow-line edges + fringe/collar; no
  sticker-greens; no dot-screen/seam; P1b tan / registration / QL1 relief / sky unregressed.
- `test/sdf.test.mjs` + full `npm test` green (cache key v32→v33; `hd-turf.test.mjs` updated).
- Optional dual-assessor pass — confirm boundary dimensions (b)/(c) move a grade.
- Finish with superpowers:finishing-a-development-branch.
