# Phase 1b — Tan-first course identity (sub-plan)

> Sub-plan of [`2026-07-06-reality-master-plan.md`](2026-07-06-reality-master-plan.md). REQUIRED SUB-SKILL after
> `/plan-eng-review`: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** the sim stops rendering every course as lush green striped parkland. Chambers Bay reads as a **firm
tan-gold links** (fescue rough DOMINATES, minimal stripes); TPC Sawgrass stays **lush green parkland** (bold
stripes). One course-level "dryness" scalar, **auto-detected from fairway-grass colour**, drives both the turf
palette bias and the stripe strength. This is the #1 gap both assessors flagged, and it's on the critical path
to P2 (SDF edges get judged against the final rough colour).

**Target palette (from the 106-photo reference `reference/chambers-bay/CATALOG.md`):** dry-links rough
**#c0a666** (gold-tan, should dominate the frame), fairway **#5e7d3d** (cool olive), green **#6b894a**, sand
**#b7a98b** (greige — already shipped in `makeSandMaterial`). Lush-parkland stays near today's greens.

**Architecture — `uCourseDry` shader uniform (NOT a splat repaint):**
- **Why a uniform, not new per-course splat colours:** the splat is painted at course-load *before* the aerial
  loads (`scene.js` loadCourse), but the dryness signal comes FROM the aerial. A uniform is set later in the
  `_buildMacroTint` aerial callback (exactly where `m.avg` is already set, `scene.js:528`), sidestepping the
  ordering problem with no splat repaint / turf rebuild.
- **Why the existing lush↔tan mix isn't enough:** `turf.js:226` already lerps grass toward warm-desaturated
  `(1.13,1.03,0.74)` by a NOISE field (`zone`), but (a) it's noise-driven, not course-driven, and (b) a pure
  multiplier can't turn lush green `#4a8038` into gold-tan `#c0a666`. P1b adds a `uCourseDry`-scaled bias that
  **rebuilds chroma from luma toward an explicit tan target** on rough/base turf (so it CAN reach gold-tan),
  gated OFF greens and mown-stripe fairway (those keep their manicured character).
- **Stripes:** `turf.js:247` stripe strength (0.38/0.17) is fixed; scale it down by `uCourseDry` (links minimal,
  parkland bold).

**Diagnosis already done (grounded — do not re-derive):**
- Palette lives in `scene.js` `COLORS` (~:48-60): base `#3c6736`, rough `#4a8038`, fairway `#5aa848/#4f9a40`,
  green `#4c8f42/#447f38` — all lush green, course-independent.
- Turf shader (`turf.js`): base = `diffuseColor` (splat) × blade detail (:178); noise lush↔tan mix (:226);
  stripes (:247, `sFade` distance-faded); greens gated by `gEdge` (:207). `customProgramCacheKey` must bump on
  shader-text change (currently `'turf-grain-v31'` / `'turf-grain-v31-macro'`).
- `_buildMacroTint(m)` (`scene.js:490`) rasterizes surface polys into the aerial canvas + computes the
  playable-mean via `averageLinearColor` (:528). **This is where fairway-grass sampling + `uCourseDry` go.**
- Memory warning (`golf-realism-research` / detector notes): aerial playable-MEAN greenness does NOT separate
  links vs parkland — Chambers greenness 0.047 vs Sawgrass 0.0233 is BACKWARDS. The clean signal is
  fairway-grass **warmth/desaturation**, sampled specifically over fairway, not whole-frame greenness.

**Tech stack:** Three.js `onBeforeCompile` GLSL (turf shader), the `_buildMacroTint` aerial-sampling path, the
committed 6-frame capture fixture (`docs/fixtures/chambers-sweep.json`), `node --test`.

---

## Task 0: Detector calibration GATE — a fairway-warmth metric that separates links vs parkland (HARD go/no-go)

**Files:** `scratchpad/` probe only (no repo change yet). **Output:** a validated `dryness(aerial, fairwayPolys)`
formula + the three course numbers; gates Tasks 1-4.

- [ ] **Step 1:** Write a Node probe that, for **chambers-bay** (links), **tpc-sawgrass** (parkland), and
  **bandon-dunes** (links), loads the cached course + its aerial, rasterizes the OSM **fairway** (and tee)
  polygons into a mask, and samples the aerial's mean colour over ONLY those fairway pixels (linear space).
- [ ] **Step 2:** Compute candidate dryness metrics on the fairway-mean colour: warmth `(R - B)`, green-dominance
  `G - (R+B)/2`, saturation, value. Find a combination where **links (Chambers, Bandon) score clearly higher
  dryness than parkland (Sawgrass)** with a separating threshold. Normalize to `uCourseDry ∈ [0,1]`
  (0 = lush parkland, 1 = dry links).
- [ ] **Step 3 — GATE:** if a clean metric separates all three (links > parkland by a comfortable margin),
  lock the formula + threshold and proceed. **If NO aerial metric separates them** (the memory's warning
  proves fatal), STOP the auto-detector and fall back to a **manual `courseDry` field in the course JSON**
  (still ships the tan look; auto-detect becomes a documented follow-up). Do not build the palette bias on an
  unvalidated detector.

---

## Task 1: `uCourseDry` uniform + shader dry-bias (TDD the pure colour helper first)

**Files:** `public/render/turf.js`, `public/render/turf-color.js` (create — pure helper), `test/turf-color.test.mjs` (create).

- [ ] **Step 1 (TDD):** Extract the dry-bias as a pure JS helper mirroring the GLSL, `dryTanBias(rgb, dry)`:
  rebuild chroma from luma toward the gold-tan target so `dry=1` maps lush rough `#4a8038` → ~`#c0a666`,
  `dry=0` is identity. Write `test/turf-color.test.mjs` asserting the endpoints + monotonicity. Run → fail → implement → pass.
- [ ] **Step 2:** Add `uCourseDry` uniform (default 0) to the turf shader. After the existing lush↔tan mix
  (`turf.js:~227`), apply the dry-bias to grass **only on rough/base** — gate it OFF greens (`gEdge`) and OFF
  the mown-stripe fairway (`m`) so those keep their manicured colour: `grass = mix(grass, dryTan(grass),
  uCourseDry * (1.0 - gEdge) * (1.0 - 0.7*m))`. Bump `customProgramCacheKey` v31 → v32 (both variants).
- [ ] **Step 3:** Verify `npm test` green (new colour test + no regression); shader compiles (no black turf).

## Task 2: Course-aware stripe strength

**Files:** `public/render/turf.js`.

- [ ] **Step 1:** Scale the stripe term (`turf.js:247`) by `(1.0 - uStripeDamp * uCourseDry)` so links get
  minimal stripes, parkland keeps bold ones. Pick `uStripeDamp` so Chambers stripes are ~faint-but-present
  and Sawgrass is unchanged. (No new uniform needed if folded into the existing `uCourseDry`.)
- [ ] **Step 2:** Verify: cache key already bumped in Task 1; `npm test` green.

## Task 3: Wire the detector → `uCourseDry`

**Files:** `public/render/scene.js` (`_buildMacroTint` + the turf uniform ref), `public/render/turf.js` (expose the uniform setter).

- [ ] **Step 1:** In `_buildMacroTint` (`scene.js:490`), after computing `m.avg`, sample the fairway-grass mean
  (reuse the surface rasterization already there) and compute `courseDry` via the Task-0 formula (or read the
  manual `courseDry` field if Task 0 fell back). Push it to the turf material's `uCourseDry` uniform.
- [ ] **Step 2:** Guard: HD-bundle / aerial-less courses default `courseDry` to 0 (lush) or the manual field —
  never `NaN`. Verify Chambers gets a high value, Sawgrass ~0, in the `[render]` log.

## Task 4: Tune + verify on the 6-frame sweep

**Files:** tuning constants in `turf.js`; `docs/TODO.md`, `docs/HANDOFF.md`.

- [ ] **Step 1:** Capture the committed sweep (`docs/fixtures/chambers-sweep.json`) for Chambers AND Sawgrass,
  before/after. Target: Chambers rough reads gold-tan and DOMINATES; fairway cool-olive; stripes faint;
  greens + registration + relief unregressed. Sawgrass stays lush green with bold stripes (no regression).
- [ ] **Step 2:** Iterate the tan target + `uCourseDry` mapping + `uStripeDamp` until the vs-real assessor
  would call Chambers "tan links" not "green parkland," without Sawgrass regressing.
- [ ] **Step 3:** Update `docs/TODO.md` + `docs/HANDOFF.md`; note the detector formula (or manual fallback).

---

## Verify / done (whole phase)

- 6-frame sweep (fixture) for Chambers + Sawgrass, before/after: Chambers tan-links, Sawgrass lush-parkland,
  no regression to greens / registration / QL1 relief / no-HD-seam / sky.
- `test/turf-color.test.mjs` + full `npm test` green (cache key bumped v31→v32).
- Optional: one dual-assessor pass on the Chambers sweep — confirm the "green parkland" read flips to "tan
  links" (expected P1 score lift toward ~4.5-5 with P1a).
- Finish with superpowers:finishing-a-development-branch (present PR/merge options).
