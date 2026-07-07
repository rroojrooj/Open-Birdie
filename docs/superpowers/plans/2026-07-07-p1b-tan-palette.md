# Phase 1b — Tan-first course identity (sub-plan)

> Sub-plan of [`2026-07-06-reality-master-plan.md`](2026-07-06-reality-master-plan.md). REQUIRED SUB-SKILL after
> `/plan-eng-review`: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.
>
> **RE-ARCHITECTED 2026-07-07 by eng-review + outside voice (see GSTACK REVIEW REPORT at bottom).** The naive
> "paint the splat tan" plan does NOT achieve tan-links: the splat is only one of FOUR colour sources, and the
> other three override it (verified in code). This plan coordinates all four via one manual `courseDry` scalar.

**Goal:** Chambers Bay reads as a **firm tan-gold links** (fescue rough dominates, minimal stripes) at BOTH
play and overview; TPC Sawgrass stays **lush green parkland** (unchanged). One manual course-level dryness
scalar `courseDry ∈ [0,1]` drives every colour source coherently. #1 gap from both assessors; critical path to P2.

**Target palette (`reference/chambers-bay/CATALOG.md`):** dry rough **#c0a666** (gold-tan, dominant), fairway
**#5e7d3d** (cool olive), green **#6b894a** (stays green — NOT tan), sand **#b7a98b** (already shipped).

## Architecture — one scalar, FOUR coordinated colour sources

```
courseDry (0=lush parkland .. 1=dry links)   [MANUAL, client-side map keyed by course name]
   │
   ├─(1) SPLAT palette   paint base with lerp(lushPalette, dryPalette, courseDry)   [greens EXCLUDED]
   ├─(2) BLADE tint      _fairwayZoneColor reads the SAME blended palette, not raw COLORS
   ├─(3) SHADER warm-mix  uCourseDry pulls the turf.js:226 zone-mix warm endpoint toward neutral
   │                      (so the tan comes from the base, not a double-counted multiplier)
   ├─(3) SHADER stripes   uCourseDry scales mow-stripe strength toward a LOW FLOOR (not zero)
   └─(4) FAR-PHOTO        uCourseDry lowers uMacroPhotoFar so the lit TAN turf shows at overview
                          instead of the green summer aerial washing back over it
```

**Why these four (all verified against code — the review's load-bearing findings):**
1. **Splat** — base grass = `diffuseColor` (splat painted from `COLORS`, `scene.js:629-631`). Re-color it.
2. **Blades** — `_fairwayZoneColor` (`scene.js:890`) hard-refs `COLORS.fairwayA/tee/base` → foreground grass
   tufts stay kelly-green on tan ground unless retinted from the same blended palette.
3. **Shader warm-mix** — `turf.js:226` `grass *= mix((0.93,1.0,0.9),(1.13,1.03,0.74), clamp(zone*1.7+0.5,0,1))`
   is an UNCONDITIONAL noise-driven warm multiplier (warms ~half of EVERY course). A tan splat under it
   double-counts → overshoots past #c0a666. `uCourseDry` must pull the warm endpoint toward neutral.
4. **Far-photo** — `turf.js:135` crossfades to the raw green NAIP aerial past ~60-100 m (`courseAerialPhotoFar
   0.62`). The tan splat is underneath → washed to green at overview, exactly where "links" reads most.

**`courseDry` home = a CLIENT-SIDE map (NOT the course JSON).** Verified: `courseGeometry()` (`server.js:276`)
and `loadCourse` (`lib/course.js:392`) both return FIXED field allow-lists — a `courseDry` JSON field is
silently dropped in transit (tests green, feature dead). A client map keyed by course name in a small render
module avoids transit + the cache-version foot-gun (old caches lacking the field) entirely, and doesn't touch
`courseFingerprint` (safe — `canonicalCourse` is an allow-list). The per-course surface-override sidecar was
considered and rejected (server-side → same transit problem; overkill for one scalar).

**Never break:** `courseDry=0` must be **byte-identical to today** for every course → derive `lushPalette`
FROM the live `COLORS` object (don't retype hexes). Greens stay green. `customProgramCacheKey` bumps v31→v32.

**Tech stack:** Three.js `onBeforeCompile` GLSL, the splat paint + `_fairwayZoneColor` blade tint, the
`_buildMacroTint`/far-photo path, the committed 6-frame fixture (`docs/fixtures/chambers-sweep.json`), `node --test`.

---

## Task 1: `courseDry` map + blended-palette module (TDD the pure logic first)

**Files:** create `public/render/course-character.js`; `test/course-character.test.mjs` (create);
read `scene.js` `COLORS`.

- [ ] **Step 1 (TDD):** Write `test/course-character.test.mjs` FIRST: `courseDryFor(name)` returns the map
  value, clamps to [0,1], defaults **0** for unknown/missing; `blendPalette(lush, dry, 0)` deep-equals `lush`
  (byte-identical), `blendPalette(lush, dry, 1)` equals `dry`, monotone between; **greens are excluded**
  (`blendPalette(...).greenA === lush.greenA` at any courseDry). Run → fail.
- [ ] **Step 2:** Implement `course-character.js`: a `COURSE_DRY` map (`{ 'Chambers Bay': ~0.85, 'TPC Sawgrass':
  0, 'Bandon Dunes ...': ~0.8, default 0 }`), `courseDryFor(name)`, a `DRY_PALETTE` (rough #c0a666, fairwayA
  #5e7d3d, fairwayB slightly darker, base tan, tee olive; greenA/greenB = lush greens UNCHANGED), and
  `blendPalette(lush, dry, t)` = per-key lerp with greenA/greenB pinned to lush. Import `COLORS` as `lush`.
  Run → pass. Full `npm test` green.

## Task 2: Apply the blended palette to splat + blades

**Files:** `public/render/scene.js` (splat paint site ~:629, `_fairwayZoneColor` :890, loadCourse wiring).

- [ ] **Step 1:** At course-load, compute `const dry = courseDryFor(courseName)` and
  `const pal = blendPalette(COLORS, DRY_PALETTE, dry)`. Paint the splat (`fillKind` calls ~:629-631) from
  `pal.*` instead of `COLORS.*` (greens still `pal.greenA` = unchanged green).
- [ ] **Step 2:** Retint `_fairwayZoneColor` (:890) from `pal.fairwayA/tee/base` (not raw `COLORS`), so the
  foreground blades match the tan ground. Store `pal` on the scene so both read the same blend.
- [ ] **Step 3:** Verify `npm test` green; no console errors on Chambers + Sawgrass load.

## Task 3: `uCourseDry` shader uniform — warm-mix + stripes + far-photo

**Files:** `public/render/turf.js` (uniform + 3 shader edits + cache key), `scene.js` (set uniform on BOTH base + HD-patch turf materials).

- [ ] **Step 1:** Add `uCourseDry` uniform (default 0) to the turf material. Set it in `scene.js` on the base
  turf material AND the HD green-patch material (`_turfInputs` / `:973`) — else HD patches render lush while
  the base is dry (the `!_hdPatch` mismatch class from memory).
- [ ] **Step 2 (warm-mix, #4):** at `turf.js:226`, pull the warm endpoint toward neutral by `uCourseDry`:
  `mix((0.93,1.0,0.9), mix((1.13,1.03,0.74),(1.0,1.0,0.96), uCourseDry*0.7), clamp(zone*1.7+0.5,0,1))` — so a
  dry course's tan comes from the base, not a double-counted multiplier; `uCourseDry=0` is unchanged.
- [ ] **Step 3 (stripes, #7):** scale the stripe term (`turf.js:247`) by `(1.0 - uStripeDamp*uCourseDry)` with
  `uStripeDamp ~0.7` so links keep a LOW-but-nonzero stripe (Chambers is lightly mown, not stripe-free).
- [ ] **Step 4 (far-photo, #6):** scale `photoFar` (or `uMacroPhotoFar`) down by `uCourseDry`
  (e.g. `photoFar *= (1.0 - 0.7*uCourseDry)`) so dry courses show the lit tan turf at overview instead of the
  green aerial. Keep the mid-range chroma tint but let the tan base carry the overview.
- [ ] **Step 5:** Bump `customProgramCacheKey` `'turf-grain-v31'`→`'v32'` (both variants). Verify shader
  compiles (no black turf), `npm test` green.

## Task 4: Tune + verify on the 6-frame sweep (the REAL gate)

**Files:** tuning constants in `course-character.js` + `turf.js`; `docs/TODO.md`, `docs/HANDOFF.md`.

- [ ] **Step 1:** Capture the committed sweep (`docs/fixtures/chambers-sweep.json`) for **Chambers** AND
  **Sawgrass**, before/after. This is the load-bearing gate — the unit tests pass while the on-screen result
  could still be wrong (blades/warm-mix/far-photo interactions), so verify visually.
- [ ] **Step 2:** Targets: Chambers rough reads **gold-tan and dominates** at play AND overview; fairway
  cool-olive; **greens still green**; blades match ground (no green-tuft seam); stripes faint-but-present;
  registration + QL1 relief + no-HD-seam + sky unregressed. **Sawgrass byte-unchanged** (courseDry=0).
- [ ] **Step 3:** Iterate `COURSE_DRY['Chambers Bay']`, `DRY_PALETTE`, `uStripeDamp`, the far-photo factor
  until the vs-real assessor would call Chambers "tan links." Update `docs/TODO.md` + `docs/HANDOFF.md`.

## Task 5 (STRETCH — deferred): auto-detect `courseDry` from the aerial

- [ ] Build a fairway-warmth detector in `_buildMacroTint` (sample the aerial over OSM fairway polys; warmth /
  desaturation metric, NOT greenness — memory says greenness is backwards). Validate it reproduces the manual
  `COURSE_DRY` labels for Chambers/Sawgrass/Bandon within tolerance, then let it OVERRIDE the manual value.
  Ship only if it cleanly beats the labels; otherwise keep the manual map. Out of P1b's core scope.

---

## Verify / done (whole phase)

- 6-frame sweep (fixture) for Chambers + Sawgrass, before/after: Chambers tan-links at play AND overview,
  greens green, no blade seam; Sawgrass byte-unchanged; no regression to registration / QL1 relief / no-HD-seam / sky.
- `test/course-character.test.mjs` (incl. `courseDry=0 === COLORS` byte-identity + greens-excluded) + full
  `npm test` green (cache key v31→v32).
- Optional: one dual-assessor pass on the Chambers sweep — confirm "green parkland" → "tan links."
- Finish with superpowers:finishing-a-development-branch (present PR/merge options).

---

## Implementation Tasks
Synthesized from this review. Each derives from a specific finding. Checkbox as you ship.

- [ ] **T1 (P1, human: ~1-2h / CC: ~30min)** — `course-character.js` — courseDry client-map + `blendPalette`
  (lush derived from `COLORS`, greens excluded) + TDD test
  - Surfaced by: Arch Q1/Q2 + outside-voice #1/#8 — a JSON `courseDry` is dropped in transit; `lush` must `=== COLORS`
  - Files: `public/render/course-character.js`, `test/course-character.test.mjs`
  - Verify: test green — `courseDry=0`→byte-identical, `=1`→dry targets, greens pinned, clamp/default 0
- [ ] **T2 (P1, human: ~1-2h / CC: ~20min)** — `scene.js` — paint splat AND retint `_fairwayZoneColor` blades from the blended palette
  - Surfaced by: outside-voice #3 — blades hard-ref `COLORS.fairwayA` ([scene.js:890](public/render/scene.js:890)), bypass the splat → green tufts on tan
  - Files: `public/render/scene.js`
  - Verify: no green-blade seam on Chambers; Sawgrass unchanged
- [ ] **T3 (P1, human: ~2-3h / CC: ~45min)** — `turf.js` — `uCourseDry` uniform: pull warm-mix endpoint + stripe floor + lower far-photo for dry; set on base + HD-patch materials; cache v32
  - Surfaced by: outside-voice #4/#6/#7/#9 — warm-mix double-counts, far-photo washes tan at overview, HD patch needs the uniform
  - Files: `public/render/turf.js`, `public/render/scene.js`
  - Verify: Chambers tan at overview (photo doesn't wash back); greens green; `npm test` green
- [ ] **T4 (P1, human: ~2-3h / CC: ~1h)** — verify — tune + capture the 6-frame fixture, Chambers + Sawgrass, before/after (the REAL gate)
  - Surfaced by: outside-voice bottom-line — unit tests pass while on-screen can be wrong; the fixture is the gate
  - Files: `docs/fixtures/chambers-sweep.json`
  - Verify: Chambers "tan links" at play + overview, greens green, no seam; Sawgrass byte-unchanged; relief/registration/sky intact
- [ ] **T5 (P3, human: ~1-2d / CC: ~2-3h)** — `scene.js` — auto-detect `courseDry` from fairway warmth (STRETCH), validate vs manual labels before override
  - Surfaced by: Arch Q1 — manual first, auto = gated stretch (greenness is backwards)
  - Files: `public/render/scene.js`
  - Verify: reproduces the manual `COURSE_DRY` labels for Chambers/Sawgrass/Bandon within tolerance

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean (FULL_REVIEW) | 3 issues + outside-voice re-architecture, 0 critical gaps, 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE VOICE (Claude subagent, Codex not installed):** 10 findings, ALL verified against code. Proved the naive "paint the splat" plan insufficient — the splat is 1 of 4 colour sources (blades `scene.js:890`, shader warm-mix `turf.js:226`, far-photo `turf.js:135` all override it) — and that a `courseDry` JSON field is dropped in transit (`server.js:276` / `course.js:392`).
- **CROSS-MODEL:** 1 tension (P1b scope). Review + the 3 decisions assumed splat-only; outside voice proved it insufficient. Resolved → **full coherent tan** (courseDry drives all 4 colour sources; greens excluded). Correctness folds absorbed: client-side courseDry map (not JSON), `lush === COLORS`, HD-patch uniform, stripe floor, sidecar rejected.
- **VERDICT:** ENG CLEARED (FULL_REVIEW) — ready to implement P1b.

NO UNRESOLVED DECISIONS
