# Overview Realism — "kill the flat-photo look at survey range" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every elevated / overview shot read as a **lit 3D landscape** instead of a **re-projected aerial photo draped on a heightfield** — the last standing facet of the original "satellite photo painted on the surface" complaint (independent assessor: ground-level + relief are beaten, overview is not).

**Architecture:** The 3D-cue machinery already exists (sun `DirectionalLight` + 4096 shadow map, `FogExp2` aerial fog, `GTAOPass`, ACES tone-map) — it is simply **scoped to the active hole**, so the rest of the course in an overview has no cast shadows and reads flat. This arc **scales the existing cues to the visible course** (shadow coverage first), then tunes atmospheric depth + the far-field photo. NO new subsystems; NO new runtime deps. All changes are in `public/render/**` (client — page-reload to verify, no server restart) except knobs in `config.js`.

**Tech stack:** Three.js (`DirectionalLight.shadow.camera` ortho frustum, `FogExp2`, `GTAOPass`, `MeshStandardMaterial` `onBeforeCompile` turf shader), the headless capture/render loop (`docs/HANDOFF.md` §6 / the verify server on :8223 + sink on :9100).

**Non-goals (deferred, separate arcs):** authored 3D green complexes (phase B); the milky *mid*-distance issue is in scope here only as far-field de-wash; a full CSM (cascaded shadow map) rewrite (we try a single wider frustum + a bigger map first, CSM only if that regresses near-hole crispness).

---

## The diagnosis (grounded, so we don't re-derive it)

Read before implementing — every claim here was read from the current code:

- **Shadows are hole-scoped.** `scene.js _fitShadows(hole)` sizes the sun's ortho shadow frustum to `span = hypot(pin - tee) * 0.62 + 70` around the hole midpoint (`c.left/right/top/bottom = ±span`, `near 200 / far 1400`). For a ~1.8 km course (Chambers) an overview shows most of the course **outside** that frustum → **no cast shadows on the distant dune relief → it reads as a flat photo.** THIS IS THE PRIMARY LEVER.
- **Far-field is the raw aerial photo.** `turf.js` macroBlend crossfades the RAW photo in at 60–150 m (`courseAerialPhotoFar: 0.88`). It's applied to `diffuseColor` (so it IS lit) — but past the hole-scoped shadow frustum there are no shadows to light it with, so it reads as flat baked albedo. A prior "global de-light" of the far photo was tried and **went milky-grey → reverted** (see `turf.js` macroBlend comment) — do NOT simply de-light.
- **Distant trees are flat.** `treeCap: 450` (config) — a big course's distant tree cover is the aerial photo's baked-in (flat) trees + the `horizonTrees` perimeter band, not 3D geometry.
- **Aerial fog is on but gentle.** `FogExp2` `fogDensity: 0.00019` to the HDRI horizon colour (`atmosphere.js`). Real aerial perspective desaturates + lightens with distance; ours mostly lightens.
- **GTAO is screen-space** (`postfx.js`) — helps contact grounding, limited range at overview; not the primary lever but verify it isn't disabled by the shadow change.

---

## Task 0: Diagnostic gate — prove the shadow-coverage thesis (HARD go/no-go)

**Files:** none (capture only). **This gates all of Task 1.**

- [ ] **Step 1:** Start the verify server (`open-birdie-verify`, :8223) + sink (:9100). Load Chambers Bay, wait for HD (18 patches) to settle (~13 s after reload).
- [ ] **Step 2:** Capture a high overview (camera ~320 m above the course centroid, looking down) — call it `ov_before.jpg`.
- [ ] **Step 3:** In the page, TEMPORARILY widen the shadow frustum live and re-render the same camera:
  ```js
  const c = S.sun.shadow.camera; c.left=-900; c.right=900; c.top=900; c.bottom=-900; c.near=50; c.far=2500; c.updateProjectionMatrix(); S.sun.shadow.map?.dispose?.(); S.sun.shadow.map=null;
  ```
  Capture `ov_wideshadow.jpg`.
- [ ] **Step 4: GATE.** Compare. If `ov_wideshadow` shows visibly more shadowed dune relief across the course (the overview reads more 3D) → **GO, shadow coverage is the lever, proceed to Task 1.** If it looks the same → **STOP and escalate**: the flat read is dominated by something else (far-photo albedo / fog / tree flatness) and Tasks 2–4 must lead instead. Record which.

---

## Task 1: Course-scale shadow coverage (the primary fix)

**Files:** Modify `public/render/scene.js` (`_fitShadows`), `public/render/env.js` (`makeSun` — shadow map size), `public/render/config.js` (new knobs).

Fit the shadow frustum to the **visible course**, not one hole, so relief casts shadows across the overview — without wrecking near-hole shadow crispness.

- [ ] **Step 1:** Add config knobs: `shadowCoverage: 'course'` (`'hole' | 'course'`), `shadowMapSize: 4096` (bump candidate 8192).
- [ ] **Step 2:** In `_fitShadows`, when `shadowCoverage==='course'`, center the frustum on the **course bounds center** and set `span = max(courseSpanX, courseSpanY)/2 + margin`; expand `near/far` to bracket the course's elevation range (`c.near`, `c.far` from the terrain z-extent + the 700 m sun distance). Keep the hole-scoped path behind the flag for A/B + rollback.
- [ ] **Step 3:** Verify near-hole shadow crispness didn't regress unacceptably (a bigger frustum at the same map = coarser shadows). If it did, bump `shadowMapSize` to 8192 in `makeSun` (measure perf) OR keep hole-scoped shadows for the *play* camera and course-scoped only when `camMode !== 'idle'`/at overview distance — decide from captures, document the choice.
- [ ] **Step 4:** Render-loop A/B (overview + a play-height frame) on Chambers (dunes, HD) AND a flat course (Sawgrass) — confirm: overview relief now reads 3D; play frame unregressed. Capture proof.
- [ ] **Step 5:** Commit.

---

## Task 2: Aerial perspective — depth by distance

**Files:** `public/render/config.js` (`fogDensity`), `public/render/atmosphere.js` (fog + optional distance desaturation).

- [ ] **Step 1:** Tune `fogDensity` up modestly so far terrain recedes (A/B — too much = washed horizon, the current 0.00019 was picked to avoid that; move in small steps).
- [ ] **Step 2 (if fog alone is weak):** Add a **distance-desaturation** term in the turf shader far-field (desaturate + slightly cool the albedo with `length(vViewPosition)`), matching real aerial perspective — this is the depth cue fog-lightening alone misses. Guard it so it only affects TRUE far range (past ~150 m) and never the play corridor.
- [ ] **Step 3:** Render-loop A/B overview. Confirm depth recession without a milky horizon. Commit.

---

## Task 3: Far-field de-wash (the "milky/semi-transparent" tell)

**Files:** `public/render/turf.js` (macroBlend far-photo), `public/render/config.js`.

The assessor flagged the far-field as milky / see-through. The prior *de-light* went grey; instead **restore contrast/saturation** to the far photo so it reads as solid ground, not tracing paper.

- [ ] **Step 1:** In macroBlend, apply a gentle contrast + saturation lift to the raw far photo (`courseAerialPhotoFar` path) instead of de-lighting it. Small, knobbed.
- [ ] **Step 2:** Confirm the highlight rolloff (`grass / (1 + 0.5*max(0, grass-0.66))`) isn't crushing the far field to pale — adjust the rolloff threshold for far range if needed.
- [ ] **Step 3:** Render-loop A/B. Far field reads solid + lit, not milky. No regression to the shipped mid-range. Commit.

---

## Task 4 (stretch): distant tree density

**Files:** `public/render/config.js` (`treeCap`), `public/render/scene.js` (`_addTrees` LOD/placement), `public/render/vegetation.js` (`horizonTrees`).

- [ ] **Step 1:** Raise `treeCap` (450 → measured budget) and/or strengthen the `horizonTrees` band so distant tree cover is 3D silhouettes, not the flat baked photo. Measure FPS/instances at overview.
- [ ] **Step 2:** Render-loop A/B overview; confirm distant trees read 3D without a perf cliff. Commit. If perf-bound, `log()` the cap and leave as-is.

---

## Verify / done

- `npm test` green throughout (these are mostly shader/scene knob changes; add asserts only where a pure helper is introduced, e.g. a shadow-frustum fit function — keep it testable/DOM-free where practical).
- Every visual claim backed by a captured overview A/B (Chambers dunes + Sawgrass flat). Never claim a visual fix without a frame.
- Update `docs/TODO.md` + `docs/HANDOFF.md` in the same change; note remaining gaps.
- Finish with superpowers:finishing-a-development-branch (present PR/merge options).
