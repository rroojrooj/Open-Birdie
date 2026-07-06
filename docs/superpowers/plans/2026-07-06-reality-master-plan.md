# Reality Master Plan — 3/10 → 6–7/10 (all phases)

> **How to use this doc:** this is the MASTER roadmap. Each phase gets its own detailed sub-plan
> (`2026-MM-DD-phase-N-<name>.md`, written when the phase starts) which goes through
> `/plan-eng-review` + an outside voice BEFORE implementation, then superpowers:subagent-driven-development
> or inline execution. Do NOT implement from this doc directly — it locks scope, sequence, and
> exit criteria, not steps.

**Goal:** move the renderer from **3/10** (dual-assessed 2026-07-06: one agent vs the 106-photo real
library, one vs the GSPro/EA/TrackMan bar — both independently scored 3/10) to the **6–7/10 band**:
"recognizably the real place, respectable next to GSPro at the elevated orbit camera."

**Evidence base (do not re-derive):**
- Dual assessment verdicts + fused gap list: memory + this doc's phase rationales. Renders graded:
  `pro_ov_south / pro_ov_high / pro_play / pro_green / pro_h15 / pro_sand` (scratchpad), framed to
  match real photos (`pro_ov_south` mirrors `reference/chambers-bay/misc/wide_south_looking_north.jpg`).
- Real-course ground truth: `reference/chambers-bay/` (106 photos) + `CATALOG.md` (palette hexes,
  character, licensing).
- **What's RIGHT (never regress):** QL1 lidar macro landform, aerial registration/routing, no HD color
  seam, sky pipeline quality, surface-class plumbing, east-rim housing. Every phase's verify gate must
  include a no-regression check on these.

**Measurement protocol (every phase):** re-capture the SAME 6-frame sweep (deterministic framings,
HD settled ~13s after reload, captures through `S.postfx.render()`), then re-run ONE dual-assessor pass
(vs-real + vs-pro-sim agents, fresh context) after the phase merges. Log the two scores in the phase's
sub-plan. Expected trajectory: P0 → ~3.5, P1 → ~4.5–5, P2 → ~5.5–6, P3 → ~6–6.5, P4 → ~6.5–7.
(Scores are directional, not contractual — the gate is "both assessors confirm the phase's target gaps
closed with no regressions," not the number itself.)

**Sequencing + dependencies:**
```
P0 (purge) ──> P1a (Sound) ──> P4 (vegetation+atmosphere polish)
         └──> P1b (palette) ──> P2 (crisp surfaces) ──> P3 (bunkers+greens geometry)
```
- P0 first — cheap, and it un-pollutes every later verification capture.
- P1b (tan-first palette) BEFORE P2 (edges): edge crispness is judged against the final rough color —
  tuning edges against the wrong (green) rough would need redoing.
- P2 (SDF edges + turf response) BEFORE P3 (geometry): P3's bunker lips/green tiers meet P2's edges;
  the collar/fringe ring from P2 is the boundary condition for P3's green surrounds.
- P1a (Sound) is independent of P1b/P2/P3 — can run as a parallel lane (different files).
- P4 last — vegetation/atmosphere polish reads differently against the corrected palette + water.

---

## Phase 0 — Debug-artifact purge (~1 day) — "no shipping sim shows its debug layer"

**Why first:** the assessors flagged these as costing "more credibility than any missing technique,"
and they contaminate every future verification capture.

**Scope (each item needs a short diagnosis first — root cause, not cosmetic hiding):**
1. **Pond renders as a blue grid/checker placeholder** (`pro_ov_south` left-center). Suspects: broken/
   missing water texture on the on-course ponds, or the reflection/foam path rendering a debug pattern
   at this camera. Fix = correct material; a flat animated-normal + fresnel water is acceptable (hours,
   per the pro-sim reality check).
2. **Floating yellow "T" glyph** (verified in `pro_sand`) — the tee marker rendering as a bare sprite.
   Replace with a proper small tee-marker mesh or hide beyond N metres camera distance.
3. **Dashed white polyline + stray blue path line** visible in overview/hole captures (aim line and/or
   OSM path-line rendering). Gameplay UI must not render in non-play framings: fade the aim line with
   camera distance/mode; decide whether path polylines should render at all (real cart paths are in
   the aerial already).
4. **Halftone/dot-pattern override stamps** (orange dotted patches, `pro_ov_high` left edge) — the
   override/curated-bunker fill pattern. Make the fill match the real sand material (no dot screen).
5. **HD patch tonal seams** (rectangular value steps, `pro_ov_high`) — the long-deferred "macro color
   edge-feathering" polish from the HD compiler arc. Feather patch-edge color into the course-wide layer.
6. **Baked cloud shadows in the drape read as dirt stains** (fight the live sun) — assess only:
   if a cheap luma high-pass/normalization on the far-photo layer helps, take it; else document as
   accepted limitation (full de-shadowing is out of scope — the "de-light went milky" lesson).

**Files (likely):** `public/render/scene.js` (markers, aim line, water build), `public/render/turf.js`
(override fill), `tools/hd-course/*` or `scene.js` `_macro` (patch feathering), water material module.
**Exit criteria:** the 6-frame sweep shows zero placeholder/debug artifacts; play + overview
unregressed; 291+ tests green.

---

## Phase 1a — Puget Sound + world edge (~2–3 days) — the #1 "not Chambers Bay" tell

**Why:** half of every real wide frame is steel-blue water; the sim's world hard-cuts at the course
tile into a pale void ("Google Earth mesa"). Nothing else says "this is Chambers Bay" louder.

**Scope:**
1. **Sea plane**: a large water surface at the correct sea level extending west/north beyond the course
   bounds (Chambers: the Sound is west). Pewter/steel tone per `CATALOG.md` — matte, calm, fresnel tint;
   NOT tropical blue, NOT simulation water (reality-check: hours-grade material, not Gerstner).
2. **Context skirt**: a low-detail terrain apron beyond the course tile (fade-to-fog or a coarse
   DEM ring) so the silhouette never hard-cuts against sky.
3. **Horizon integration**: distance/height fog tinted from the HDRI horizon band (the overview arc's
   deferred Task 3) so far terrain + sea dissolve together. Marine-layer preset can land in P4.
4. **Generalization**: sea presence must be data-driven (course near coastline → sea plane at datum), not
   hardcoded to Chambers. Inland courses (Sawgrass) get skirt+fog only. (OSM coastline or a simple
   per-course `sea: {level, bearing}` sidecar — decide in the sub-plan.)

**Files (likely):** `public/render/scene.js` (world-edge build), `public/render/atmosphere.js`,
`public/render/env.js`, `lib/course.js` (sea metadata), `config.js` knobs.
**Exit criteria:** `pro_ov_south` framing shows water filling the west like the real photo; no
hard world edge in any sweep frame; Sawgrass unregressed (no phantom sea).

---

## Phase 1b — Tan-first course identity (~2–3 days) — the inverted palette

**Why:** the sim renders a green course with tan smudges; the real Chambers is a tan-gold course with
green ribbons (60–70% tan). The fescue rough system essentially doesn't exist. Already half-scoped in
`CATALOG.md` with real-photo hexes.

**Scope:**
1. **Palette to reference hexes**: fairway → cool muted olive `#5e7d3d`; rough/off-line → gold-tan
   fescue `#c0a666` DOMINANT; green `#6b894a` (barely brighter than fairway).
2. **Course-aware character** (`uCourseDry`): links = tan-first + MINIMAL stripes; parkland (Sawgrass)
   = green + bold stripes stays. Detector: sample the aerial at FAIRWAY polys inside `_buildMacroTint`
   (playable-mean does NOT separate the classes — verified: Chambers 0.047 vs Sawgrass 0.023).
   Propagate via a shared `{value}` uniform (the `uMacroAvg` pattern) across base + HD macro paths.
3. **Stripe strength rides the character**: links ≈ 0.08–0.12 amplitude (near-invisible, per real
   photos); parkland keeps ~0.38/0.17. (The v30 distance-fade stays.)
4. **Fescue character in the rough band**: warm the existing `zone` color drift toward the tan hexes on
   dry courses so off-line ground reads gold even where the aerial is weak.

**Files (likely):** `public/render/turf.js` (palette + uCourseDry), `public/render/scene.js`
(`_buildMacroTint` fairway sampling + uniform), `public/render/config.js`, tests (`hd-turf`,
a pure detector helper + test).
**Exit criteria:** Chambers sweep reads tan-first with green ribbons (side-by-side vs
`wide_south_looking_north`); Sawgrass sweep unchanged-to-better; the vs-real assessor confirms
dimension (a)/(b)/(c) move from OFF/MISSING to CLOSE.

---

## Phase 2 — Crisp surfaces: SDF delineation + turf light response (~8–13 days) — highest payoff-per-effort

**Why:** every surface boundary is a multi-metre airbrush feather; greens are "tint blobs." Pro courses
are authored splines with mow-line edges. Also turf is albedo-only — stripes are paint, not light.

**Scope:**
1. **SDF surface masks**: rasterize the existing OSM/override polygons into signed-distance textures
   (client-side, the `_paintMask` pipeline already rasterizes at ~0.5 m/px — extend to SDF). In
   `turf.js`, blend surface classes across a **10–20 cm** edge; derive an automatic **fringe/collar
   ring** as an SDF offset band from the green spline. Kills: airbrushed green blobs, sand halo bands,
   sticker-greens at distance.
2. **Turf detail-material pass**: two detail-normal octaves + roughness breakup noise; **stripes as
   light response** (stripe mask drives a small normal-Y flip / anisotropic sheen term, NOT an albedo
   band); stripe width 7 m → 3–4 m. Fixes the "vinyl/beach-towel" play-height read.
3. **Classmap/SDF reconciliation**: NDVI classmap unions stay for coverage, but crisp OSM-known edges
   take precedence over the feathered classmap where both exist.

**Constraint carried from history:** every `turf.js` change bumps `customProgramCacheKey` + updates
`hd-turf.test.mjs`; GTAO recompile trap (new samples inside `#ifdef USE_MAP`).
**Files (likely):** `public/render/scene.js` (`_paintMask`→SDF builder), `public/render/turf.js`
(edge blend + detail materials), new pure SDF helper + tests, `config.js`.
**Exit criteria:** green/fringe/fairway/bunker boundaries read as mow lines at the green cam;
play-height turf shows micro normal/roughness life; both assessors move dimensions (b)/(c)/(e)
at least one grade.

---

## Phase 3 — Bunker + green geometry (~8–12 days) — the money surfaces

**Why:** bunkers are flat decals with visible tiling and no lips; greens are flat discs. The real
course: recessed grey-cream amoebas with eroded lips + fescue islands; raised tiered green plateaus
melting into run-off skirts (edge = mow line, not a wall — `CATALOG.md` synthesis).

**Scope:**
1. **Bunker recess**: displace terrain inside bunker polys (drop ~0.3–0.5 m, raised lip ring), keeping
   physics (`hAt`) and HD patches consistent — the displacement must go into the height source, not a
   visual-only mesh, or balls will float/sink.
2. **Sand material**: ripple normals (2–3 octaves) + high-freq roughness glint; kill the diamond-weave
   tiling; keep the greige albedo (v31). Grass-overhang cards on lips (stretch).
3. **Green complexes (phase B, long-deferred)**: tiered/tilted putting surfaces from the lidar green
   patches (`_addGreenPatches` already builds finer meshes — extend to shape/tiers where lidar shows
   them), muted `#6b894a` color, P2's collar ring as the surround transition; run-off skirts mown into
   the surround.
4. **Waste vs pot bunker types** (stretch): two edge treatments — ragged fescue-fingered waste edges
   vs crisp deep pot lips (real course has both).

**Files (likely):** `public/render/scene.js` (terrain build, `_addGreenPatches`), `lib/` height
pipeline (recess into elevation), `public/render/turf.js` (sand material), physics-facing tests.
**Exit criteria:** `pro_sand` framing shows recessed, lipped, non-tiling sand; `pro_green` shows a
shaped putting surface with a collar; ball physics unchanged on flat lies (regression test);
assessors move (d)/(e) to CLOSE.

---

## Phase 4 — Vegetation + atmosphere identity (~5–8 days)

**Why:** "skyline conifer confetti suburbanizes the links" — reality is a treeless interior, ONE lone
fir, and a solid dark rim wall. Plus the PNW marine haze that makes distances dissolve.

**Scope:**
1. **Links vegetation logic**: on dry/links courses (reuse `uCourseDry`/course character), suppress
   interior scatter trees entirely; render OSM-mapped trees only (the Lone Fir IS in OSM as a tree
   point — verify) + a DENSE continuous rim/perimeter forest wall from OSM woods (not evenly-spaced
   cones). Parkland keeps current behavior + density bump.
2. **Tree quality at the rim**: imposter/billboard LOD ring for distant walls (alpha-to-coverage,
   no white fringes); the near broadleaf/conifer cards stay.
3. **Marine-layer atmosphere preset**: per-course-character haze (links/PNW = milky aerial
   perspective; the P1a fog gets a stronger preset), optional overcast HDRI variant (stretch —
   sky pipeline stays, add one alternate).
4. **Scenery stretch (optional, if budget allows)**: rail-line ribbon + quarry-ruin boxes at 17 from
   OSM data — the last identity landmarks. Explicitly cuttable.

**Files (likely):** `public/render/scene.js` (`_addTrees`/`_horizonSpots`), `tree-cards.js`,
`vegetation.js`, `atmosphere.js`, `config.js`.
**Exit criteria:** Chambers reads treeless-links with a solid rim wall + lone fir; hazy distance;
Sawgrass keeps its parkland trees; assessors move (g)/(j) to CLOSE.

---

## Standing rules for every phase

- Sub-plan → `/plan-eng-review` + outside voice → implement (subagent-driven where tasks are separable).
- Diagnose-before-build: any phase whose thesis can be cheaply falsified live (the P0 pond, P1a sea
  level, P3 recess-vs-physics) starts with a Task-0 gate. This discipline has killed two wrong plans
  already (shadow epic; classmap blame).
- Verify on BOTH courses (Chambers = links, Sawgrass = parkland control) at the fixed sweep framings.
  Never claim a visual fix without a captured frame.
- `npm test` green throughout; docs (`TODO.md` + `HANDOFF.md`) updated in the same change; one PR per
  phase (or per sub-arc for P1a/P1b which may land separately).
- **Don't-chase list (standing):** geometry blade grass, real-time GI, simulation-grade water,
  EA-hero authoring, higher-res imagery, dynamic time-of-day.

## Phase index

| Phase | Name | Effort | Depends on | Target score after |
|---|---|---|---|---|
| 0 | Debug-artifact purge | ~1 d | — | ~3.5 |
| 1a | Puget Sound + world edge | ~2–3 d | P0 | ~4.5–5 (with 1b) |
| 1b | Tan-first course identity | ~2–3 d | P0 | ~4.5–5 (with 1a) |
| 2 | SDF surfaces + turf light response | ~8–13 d | P1b | ~5.5–6 |
| 3 | Bunker + green geometry | ~8–12 d | P2 | ~6–6.5 |
| 4 | Vegetation + atmosphere identity | ~5–8 d | P1a, P1b | ~6.5–7 |
