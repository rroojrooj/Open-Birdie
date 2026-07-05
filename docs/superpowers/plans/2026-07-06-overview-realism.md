# Overview Realism — "kill the flat-photo look at survey range" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every elevated / overview shot read as a **lit 3D landscape** instead of a **re-projected aerial photo draped on a heightfield** — the last standing facet of the original "satellite photo painted on the surface" complaint (independent assessor: ground-level + relief are beaten, overview is not).

> **IMPLEMENTED 2026-07-06 (commit 6deee10).** Task-0 gate outcome: the shadow-casting / camera-adaptive-frustum / CSM work (Tasks 1) was **DROPPED as unnecessary** — a live A/B proved enabling terrain `castShadow` + a course-wide frustum changed the overview by *nothing* (the 88% far photo washes lighting out), while dropping `courseAerialPhotoFar` *transformed* it (the diffuse-lit HD relief already carries the form). Shipped = **`courseAerialPhotoFar` 0.88→0.62 (config) + `turf.js` v30 stripe/checker distance-fade** (`1-smoothstep(120,280,dist)`, so the grooming grid doesn't over-read at altitude). Verified: Chambers flat→3D, play frame pixel-unchanged, Sawgrass unregressed, 291 tests. Tasks 3 (fog) + 4 (trees) left as optional follow-ups (the knob alone cleared the bar). The eng-review + outside voice earned their keep: they killed the wrong plan before a line of it was built.

**Architecture:** REVISED after eng-review (outside voice, code-verified). The 3D-cue machinery *partly* exists (sun `DirectionalLight` + 4096 shadow map, `FogExp2` aerial fog, `GTAOPass`, ACES tone-map) but the two dominant causes of the flat read are **DISABLED / OVERPOWERED in code**, not "scoped to one hole":
1. **The terrain never casts shadows.** `scene.js:474` + `hd-terrain.js:68,77` set `receiveShadow=true` but NO `castShadow=true`. So the dune relief cannot self-shadow — the sun only casts tree/building shadows. (Extending shadow *coverage* is a near no-op until the terrain is a caster.)
2. **The far field is 88% raw photo.** `turf.js:133` `grass = mix(grass, photo, mvalid*edgeW*0.88*photoFar)` past 60–150 m — lighting is mixed OUT before shadows/normals could modulate it. This is the dominant lever and it was sequenced last in the first draft.
3. **The shadow map re-renders every frame** (`renderer.shadowMap.autoUpdate` default `true`, no override anywhere) though sun+terrain are static — a free perf win to bank while we're here.

This arc **enables the disabled cues** (terrain casting, static-shadow perf) and **lets lighting show through the far field** (reduce the raw-photo weight), then scales shadow coverage to the overview (camera-adaptive) and tunes atmosphere. NO new subsystems, NO CSM (see NOT-in-scope), NO new runtime deps. Changes are in `public/render/**` (client — page-reload to verify) + a new pure `shadow-fit.js`.

**Tech stack:** Three.js (`Mesh.castShadow`, `DirectionalLight.shadow.camera` ortho frustum, `renderer.shadowMap.autoUpdate`, `FogExp2`, `MeshStandardMaterial` `onBeforeCompile` turf shader), the headless capture/render loop (`docs/HANDOFF.md` §6 / verify server :8223 + sink :9100).

**Eng-review decisions locked in:** **D2 = camera-adaptive shadow coverage** (hole-tight for play, course-wide only at overview — never soften the play view; no 8192/CSM). **D3 = re-scope to the real levers** (terrain castShadow + far-photo weight lead; frustum-coverage is secondary).

---

## The diagnosis (grounded + code-verified — do not re-derive)

- **Terrain is not a shadow caster** — verified: `grep castShadow public/render` → terrain meshes absent (`scene.js:474`, `hd-terrain.js:68,77` receive only). **This is the first thing to fix.**
- **Far field is 88% raw aerial photo** (`turf.js:133`, `courseAerialPhotoFar: 0.88` in config) applied to `grass`; a prior *global de-light* of it went milky-grey and was reverted (`turf.js` macroBlend comment) — so **reduce the WEIGHT / restore contrast, don't de-light.**
- **Shadow frustum is hole-scoped** (`scene.js:1127 _fitShadows`, `span = hypot(pin-tee)*0.62+70`, near 200/far 1400) — relevant only AFTER terrain casts; then D2 (camera-adaptive) covers the overview.
- **`shadowMap.autoUpdate` uncontrolled** (default true) — static sun+terrain re-render the depth pass every frame.
- **near/far is light-space DEPTH, not terrain z-range** (outside-voice #3): for a low grazing sun the light-space depth of a wide course is driven by its HORIZONTAL extent, not its ~50 m z-range. The `shadow-fit` fn must derive near/far from the course extent projected on the light axis, or far corners clip.
- **Aerial fog already lightens toward horizon** (`atmosphere.js` FogExp2) — a second in-shader distance-desaturate (old Task 2) would double-count and risk the milky horizon Task 3 fights (outside-voice #8): reconciled below.
- **`treeCap: 450` is a GLOBAL cap** consumed by on-course trees first (`scene.js:703-717`) — raising it raises near density too; distant-tree work needs a SEPARATE cap / LOD ring, not a global bump (outside-voice #7).
- **Overview reachability (outside-voice #6):** the graded `hAt+450` top-down may exceed the shipping rig (idle orbit ≤26 m height; free-cam ≤600 m dist / −88° pitch). Task 0 Step 0 checks this so we don't optimize an unreachable framing.

---

## Task 0: Diagnostic gate — measure which lever is real (HARD go/no-go)

**Files:** none (live toggles + capture only). Gates the ordering of Tasks 1–2.

- [ ] **Step 0 (reachability):** Confirm an elevated/wide shot IS reachable via the shipping free-cam (`enterFreeCam`, `free.dist` up to 600, pitch −88°). Capture the *most elevated reachable* framing; if it still reads flat-photo, the arc is valid. If only the QA `hAt+450` harness shot reads flat, STOP and escalate (we'd be fixing a non-shippable camera).
- [ ] **Step 1:** Verify server :8223 + sink :9100, Chambers loaded + HD settled (~13 s). Capture `ov_before.jpg` at the reachable elevated framing.
- [ ] **Step 2 (LEVER A — casting + far-photo):** Live in the page: set every terrain/HD/patch mesh `castShadow=true` (`S._terrain` + traverse HD patch meshes), `S.sun.shadow.autoUpdate` handling aside, widen the frustum (`c.left/right/top/bottom=±900; near=50; far=2500`), AND drop the far-photo weight (set the `uMacroWeights`/`uMacroPhotoFar` uniform or reload with `courseAerialPhotoFar≈0.4`). Capture `ov_leverA.jpg`.
- [ ] **Step 3 (LEVER B — far-photo only):** Reset casting; ONLY drop `courseAerialPhotoFar≈0.4`. Capture `ov_leverB.jpg`.
- [ ] **Step 4: GATE.** Rank `before` vs `leverA` vs `leverB`. Expected: far-photo (B) moves realism most; casting adds relief shadows on top (A > B). Record the ranking — it sets whether Task 1 (casting) or Task 2 (far-photo) leads. If NEITHER moves it, STOP: the flat read is the photo's own baked flatness and needs a different attack (normal-driven relief shading), escalate.

---

## Task 1: Terrain casts shadows + static-shadow perf + camera-adaptive coverage (D2)

**Files:** Create `public/render/shadow-fit.js` (pure, DOM-free); Modify `public/render/scene.js` (`_terrainMesh`, `_addGreenPatches`/HD patch build, `_fitShadows`, renderer init), `public/render/hd-terrain.js`, `public/render/env.js`, `public/render/config.js`. **Test:** `test/shadow-fit.test.mjs`.

- [ ] **Step 1 — terrain becomes a caster:** Set `castShadow = true` on the base terrain mesh (`_terrainMesh`, `scene.js:474`), the HD patch meshes (`hd-terrain.js:68,77`), and the lidar green patches (`scene.js:1017,1052`). Verify no shadow-acne (tune `sun.shadow.bias`/`normalBias` — already `-0.0006`/`0.35`; a self-shadowing heightfield may need a touch more `normalBias`). Render-loop A/B a play-height frame: relief now self-shadows without acne.
- [ ] **Step 2 — static-shadow perf (outside-voice #5):** Set `renderer.shadowMap.autoUpdate = false` at init; set `sun.shadow.needsUpdate = true` once whenever the sun/terrain change (course load, HDRI-ready `scene.js:153`, `_fitShadows`). Now the depth pass renders once per hole/course, not per frame — banks the cost of the bigger frustum.
- [ ] **Step 3 — pure fit fn (TDD, folds in the testability finding):** Create `shadow-fit.js` exporting `fitShadowFrustum({ mode, hole, bounds, zMin, zMax, sunDir, sunDist })` → `{ left, right, top, bottom, near, far, centerX, centerY }`. `mode==='hole'` reproduces today's math EXACTLY. `mode==='course'` centers on the course-bounds center, `span = max(spanX,spanY)/2 + margin`, and derives **near/far from the course extent projected onto the light axis** (NOT the z-range — outside-voice #3). Write `test/shadow-fit.test.mjs` FIRST: hole-mode matches current numbers; course-mode covers full bounds; `far > near > 0`; near/far grow with horizontal extent, not z.
- [ ] **Step 4 — camera-adaptive wiring (D2):** `_fitShadows` picks `hole` when `camMode==='idle'` (play/orbit — unchanged, crisp), `course` when `free`/overview, gated on `RENDER_CONFIG.shadowCoverage` (`'adaptive'|'hole'|'course'`, default `'adaptive'`). Re-fit + `needsUpdate=true` ONLY on camera-MODE change (never per frame — avoids shadow-swimming, outside-voice #5). `shadowMapSize` stays 4096.
- [ ] **Step 5:** Render-loop A/B (reachable overview + play frame) on Chambers (dunes/HD) + Sawgrass (flat). Overview relief reads 3D; **play frame pixel-unregressed**. `npm test` green. Commit.

---

## Task 2: Let lighting show through the far field (the dominant lever)

**Files:** `public/render/config.js` (`courseAerialPhotoFar`), `public/render/turf.js` (macroBlend far-photo), **Test:** `test/hd-turf.test.mjs`.

- [ ] **Step 1:** Reduce `courseAerialPhotoFar` from `0.88` toward the Task-0-measured sweet spot (~0.5–0.65) so the lit turf (now with cast relief shadows + normals) shows through the far field instead of a flat baked photo. Config-only first — cheapest lever, biggest measured mover.
- [ ] **Step 2 (de-wash, not de-light):** If the far field now reads under-contrast/milky, apply a gentle **contrast + saturation lift** to the raw far photo in macroBlend (NOT a de-light — that went grey). Confirm the highlight rolloff (`turf.js:274`, compresses >0.66) isn't crushing it; raise the rolloff threshold for TRUE far range if needed. **Any `turf.js` shader-text change → bump `customProgramCacheKey` (v29→v30) AND update `hd-turf.test.mjs`** (eng-review code-quality finding — the GTAO/cache-key gotcha that bit this arc twice).
- [ ] **Step 3:** Render-loop A/B overview. Far field reads as lit, contrasty ground; mid-range shipped look unregressed. Commit.

---

## Task 3: Aerial perspective — reconcile with the far field (outside-voice #8)

**Files:** `public/render/config.js` (`fogDensity`), `public/render/atmosphere.js`.

- [ ] **Step 1:** Tune `fogDensity` (currently `0.00019`) for depth recession — but do it AFTER Task 2 so we don't stack two distance-desaturations (the in-shader desat from the old draft is CUT — fog already provides aerial perspective; adding a second milks the horizon). Small A/B steps.
- [ ] **Step 2:** If fog-lightening alone reads unnatural (real aerial perspective also desaturates + cools), add the desaturate **in the fog color / density tint** (one place), not a second shader term — keeps it reconciled with Task 2. Render-loop A/B. Commit.

---

## Task 4 (stretch): distant tree density — a SEPARATE cap, not the global bump (outside-voice #7)

**Files:** `public/render/config.js`, `public/render/scene.js` (`_addTrees`/`_horizonSpots`), `public/render/vegetation.js`.

- [ ] **Step 1:** Do NOT raise the global `treeCap: 450` (it spends on near trees first). Add a separate distant/horizon budget + a billboard-LOD ring for the tree-line so distant cover reads as 3D silhouettes, not the flat baked photo. Measure instances/FPS at the reachable overview.
- [ ] **Step 2:** Render-loop A/B; distant trees read 3D without a perf cliff. If perf-bound, `log()` the cap and defer. Commit.

---

## What already exists (reuse, don't rebuild)

- Sun + 4096 shadow map (`env.js makeSun`) — reused; we enable terrain casting + static-update, not a new light.
- `FogExp2` aerial fog (`atmosphere.js`) — reused; Task 3 tunes it (no second desat term).
- `GTAOPass` (`postfx.js`) — already on; verify it survives the casting change (screen-space, unaffected).
- `_fitShadows` (`scene.js`) — extended (pure fn + camera-adaptive), not replaced.
- Material-first tint + far-photo (`turf.js` macroBlend) — Task 2 tunes the WEIGHT; the pipeline stays.

## NOT in scope (considered, deferred — with rationale)

- **CSM (cascaded shadow maps)** — the "proper" large-area shadow tech, but it's a Three.js *addon* requiring per-material `csm.setupMaterial` patching of the already-heavily-patched turf `onBeforeCompile` (outside-voice #4): multi-day, real conflict risk. D2 (camera-adaptive single frustum) makes it unnecessary — course mode's softness is acceptable at the wide shot. Revisit only if course-mode shadows read too coarse after Task 1.
- **8192 shadow map** — 256 MB VRAM; D2 avoids needing it.
- **Authored 3D green complexes / lidar relief (phase B)** — separate greens arc.
- **Real 3D distant vegetation at scale** — Task 4 is a stretch; a full impostor/LOD forest is its own arc.

## Failure modes (per new codepath)

| Codepath | Realistic prod failure | Test? | Error handling? | Silent? |
|---|---|---|---|---|
| terrain `castShadow=true` | shadow acne on the 1 m heightfield (self-shadow bias) | visual A/B (Task 1 Step 1) | tune bias/normalBias | visible (acne) — not silent |
| `shadow-fit.js` course mode | near/far clips far-course shadows (wrong axis) | `shadow-fit.test.mjs` (far>near, extent-driven) | pure fn asserts | test-caught |
| `autoUpdate=false` | shadow goes stale (missed `needsUpdate` on sun/hole change) | visual A/B on hole switch | set `needsUpdate` on every sun/course change | **could be silent** → CRITICAL: add an explicit `needsUpdate` on hole change + verify on course switch |
| `courseAerialPhotoFar` reduce | far field too dark/procedural (over-reduced) | Task 0 measures the sweet spot | config knob, reversible | visible |

**Critical gap flagged:** the stale-shadow failure (`autoUpdate=false` without a `needsUpdate` on a state change) would be SILENT — Task 1 Step 2 must set `needsUpdate` on every sun/course/hole change and Step 5 must verify shadows update on a hole switch.

## Worktree parallelization

Sequential — Tasks 1–3 all converge on the same overview render + `turf.js`/`scene.js`, and Task 2's photo weight interacts with Task 1's shadows (you tune them against the same frames). Task 0 gates the order. No independent lanes worth splitting; Task 4 (trees) is the only separable stretch lane.

## Verify / done

- `npm test` green throughout (new `shadow-fit.test.mjs` for the pure fn; `hd-turf.test.mjs` cache-key bump on any shader change).
- Every visual claim backed by a captured overview + play A/B (Chambers dunes + Sawgrass flat). Never claim a visual fix without a frame.
- Update `docs/TODO.md` + `docs/HANDOFF.md` in the same change.
- Finish with superpowers:finishing-a-development-branch (present PR/merge options).

## Implementation Tasks
Synthesized from this review's findings. Each derives from a specific finding above.

- [ ] **T1 (P1, human: ~1h / CC: ~15min)** — terrain — add `castShadow=true` to base + HD + green-patch meshes; tune bias for acne
  - Surfaced by: Outside voice #1 (verified) — terrain never casts shadows
  - Files: `public/render/scene.js`, `public/render/hd-terrain.js`
  - Verify: play-height A/B — relief self-shadows, no acne
- [ ] **T2 (P1, human: ~30min / CC: ~10min)** — perf — `shadowMap.autoUpdate=false` + `needsUpdate` on sun/course/hole change
  - Surfaced by: Outside voice #5 (verified) — shadow re-renders every frame; CRITICAL: stale-shadow guard
  - Files: `public/render/scene.js`
  - Verify: shadows update on hole switch; frame time drops
- [ ] **T3 (P1, human: ~2h / CC: ~20min)** — shadow-fit — pure `fitShadowFrustum` fn + camera-adaptive `_fitShadows` (D2) + test
  - Surfaced by: eng-review D2 + testability finding + outside-voice #3 (near/far axis)
  - Files: `public/render/shadow-fit.js` (new), `test/shadow-fit.test.mjs` (new), `public/render/scene.js`, `public/render/config.js`
  - Verify: `npm test`; overview 3D, play frame unregressed
- [ ] **T4 (P1, human: ~1h / CC: ~15min)** — far-field — reduce `courseAerialPhotoFar` to the Task-0 sweet spot; de-wash if needed (cache-key bump)
  - Surfaced by: Outside voice #2 — 88% raw photo washes out lighting (the dominant lever)
  - Files: `public/render/config.js`, `public/render/turf.js`, `test/hd-turf.test.mjs`
  - Verify: overview reads lit ground; mid-range unregressed
- [ ] **T5 (P2, human: ~30min / CC: ~10min)** — atmosphere — tune fog for depth WITHOUT a second in-shader desat
  - Surfaced by: Outside voice #8 — double-desat / milky-horizon conflict
  - Files: `public/render/config.js`, `public/render/atmosphere.js`
  - Verify: depth recession, no milky horizon
- [ ] **T6 (P3, human: ~2h / CC: ~30min)** — trees — separate distant cap + billboard LOD (not the global `treeCap` bump)
  - Surfaced by: Outside voice #7 — global cap conflation
  - Files: `public/render/config.js`, `public/render/scene.js`, `public/render/vegetation.js`
  - Verify: distant trees 3D, no perf cliff

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_found | 4 findings + 8 outside-voice; 1 critical gap (stale-shadow) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** not installed — outside voice ran as an independent Claude subagent.
- **CROSS-MODEL:** the outside voice CONTRADICTED the plan's primary thesis and won (verified in code): terrain never casts shadows (`castShadow` absent on terrain), and the far field is 88% raw photo. Plan re-scoped (D3) to lead with terrain-casting + far-photo weight; frustum-coverage demoted to secondary (camera-adaptive, D2). Perf win (`autoUpdate=false`) + near/far-axis bug + tree-cap conflation + fog double-count all folded in.
- **VERDICT:** ENG REVIEW COMPLETE — plan re-scoped and hardened, ready to implement. Decisions D2 (camera-adaptive shadows) + D3 (re-scope to real levers) locked. 1 critical gap (silent stale-shadow) has a mandatory guard in Task 1 Step 2 + failure-modes table.

**UNRESOLVED DECISIONS:**
- Task 0 Step 0 (overview reachability) is a live gate — if the flat read only appears at the non-shippable `hAt+450` harness camera and not at any reachable free-cam framing, the arc's premise needs revisiting before Task 1.
