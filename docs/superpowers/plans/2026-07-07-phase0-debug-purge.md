# Phase 0a — Debug-UI Visibility Gate (sub-plan)

> Sub-plan of [`2026-07-06-reality-master-plan.md`](2026-07-06-reality-master-plan.md). REQUIRED SUB-SKILL after
> `/plan-eng-review`: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.
>
> **Re-scoped 2026-07-07 after eng-review + outside voice (see GSTACK REVIEW REPORT at bottom).** The original
> "purge all 6 artifacts" P0 was split: the surface-material bugs (classmap dot-screen, HD macro tonal seam)
> were deferred to **P2**, which rewrites those exact `turf.js` surfaces via the SDF pipeline — fixing them now
> would be thrown away. What remains here (P0a) is the genuinely-blocking work: **stop debug/gameplay UI from
> leaking into survey/beauty framings**, which contaminates every later phase's verification captures.

**Goal:** the renderer stops reading as "a GIS viewer with its debug layer on" in survey/overview/beauty
framings, by gating out leaked gameplay/debug UI. Ships fast (~half day) so P1's assessment captures are clean
of leaked UI.

> **BUILT + VERIFIED 2026-07-07.** The UI gate shipped: `framing.js` (pure `isPlayFraming`/`ballReadScale`/
> `pinReadScale`) wired into `scene.js:_frame`, gating the aim line + ball/pin auto-scale to play framings only.
> `test/scene-ui-gating.test.mjs` added (294/294 green). Verified live on the render harness: BEFORE free-cam
> frame showed the dashed aim line + a 6.2×-inflated ball at 113 m; AFTER free-cam frame is clean (aim line
> hidden, ball/pin at 1×); idle play frame keeps the aim line + readability scale (no gameplay regression).
> Committed capture fixture: `docs/fixtures/chambers-sweep.json`.
>
> **Task-0 diagnosis outcomes (live, Chambers):** (1) the "yellow T" is **NOT a discrete object** — the scene
> has **0 sprites** (462 meshes, 0 sprites, 0 yellowish materials), so the master-plan "tee sprite" claim was
> false → it's a surface/classmap artifact, **deferred to P2**. (2) The pond "checker" is **NOT a cheap
> Reflector-gate** — hiding all 3 Reflectors was pixel-identical (reflOn == reflOff) and no grid shows at the
> overview → **deferred** (Task 2 skipped; not a P0a-sized fix). The re-scope held: the only actionable P0a
> work was the UI gate.

**Honest exit bar (not "zero artifacts"):** in the committed 6-frame survey sweep, **no leaked gameplay/debug
UI** (no dashed aim line, no giant auto-scaled ball/pin, no stray debug glyph); AND a real play/idle-mode frame
still shows the aim line + normal ball (no gameplay regression); AND the dual-assessor no longer flags a
"debug-viewer / placeholder" read from leaked UI. Residual **surface** artifacts (pond checker, classmap dots,
HD seam) are known-deferred to P2/later and are explicitly allowed to remain — the assessor is told so.

**Tech stack:** Three.js (`scene.js` object visibility + `_idleTargets`/`_freeTargets` scale logic), the
headless capture/render loop (verify server :8223 + sink :9100, `toDataURL`→sink; the render loop is paused and
frames captured manually — this harness is ad-hoc/manual, see `memory/preview-webgl-screenshots.md`), a
**committed capture fixture** pinning the 6 framings.

**Diagnosis already done (verified against code — do not re-derive):**
- Aim line = `THREE.Line` + `LineDashedMaterial` (white, 0.45 opacity), built in `_aimLineUpdate`
  (`scene.js:1140`). Its visibility is set false only in `playShot` (`:1165`) and true again at replay-end
  (`:1232`). **It is NOT camMode-gated at all** — it is added once and rides along in every non-replay mode
  (idle, free/overview). That is why it leaks. (Corrects the earlier note that `_idleTargets` shows it — it
  does not; `_idleTargets` is `:1246`.)
- **Ball/pin auto-scale (missed by the first pass, found by outside voice):** `_idleTargets` scales the ball
  up to **26×** and the pin up to **6×** by camera distance "to keep them readable" (`scene.js:1322-1324`:
  `ball.scale.setScalar(clamp(bd*0.055, 1, 26))`, `pin.scale.setScalar(clamp(pd*0.013, 1, 6))`). At survey
  distance the ball becomes a giant hovering sphere — a "debug billboard" read, exactly this phase's target.
- The "T" is **undiagnosed** (the master-plan claim that it is a "tee marker sprite" is WRONG — there is no
  `Sprite`/tee mesh anywhere in `public/render/`; the pin group `scene.js:172-206` is pole + red flag
  `0xd83a3a` + black cup). Candidate hypothesis to TEST in Task 0: it is **classmap-channel bleed** — the mask
  packs `{default:'#ff0000', green:'#ffff00'}` in NoColorSpace (`scene.js:444`), so a green/tee channel
  leaking through the composite would read as a **yellow** blob, and the same leak at threshold edges would
  produce the orange "dot-screen." If so, the T and the (deferred) dots share one root cause.
- Water (`water.js`) is a full animated shader + per-pond 1024² `Reflector`, NOT a debug texture — pond
  "checker" is a rendering artifact of that material at overview distance (out of P0a scope unless Task 0
  finds a cheap Reflector-gate; see Task 2).
- DOM distance markers (`scene.js:114`) are NOT in the canvas captures — no action.

---

## Task 0: Live diagnostic gate — identify + classify the UI-leak artifacts (HARD go/no-go)

**Files:** commit the capture fixture (below). Otherwise live inspection + capture. **Output:** a precise
per-artifact fix list; gates Tasks 1–2. **Budget note (eng-review #2):** this is the long pole — live
raycast/toggle/re-capture on a ~13s-settle headless harness that hangs on the SSE app (manual `toDataURL`+sink
dance per `memory/preview-webgl-screenshots.md`). Budget ~2-3h. If any single artifact turns out to be a large
hidden arc, STOP and re-scope (do not absorb it silently).

- [ ] **Step 1 (commit the fixture, eng-review #1):** Create a small committed capture fixture (JSON/JS)
  pinning `pos`/`target`/`fov` for all 6 frames (`pro_ov_south/ov_high/play/green/h15/sand`) so BEFORE/AFTER
  are pixel-comparable + re-runnable. **Overview/beauty frames** (`ov_south`, `ov_high`, `h15`, `sand`) are
  captured in **real free-cam** (`enterFreeCam`); the **`play` frame** in **real idle/play** mode with a
  ball+hole loaded — NOT a hand-posed free-cam approximation (eng-review #4: else the "aim line MUST still
  render in play" check never actually runs). Start verify :8223 + sink :9100, load Chambers, wait HD ~13s,
  capture the 6-frame BEFORE set through the fixture.
- [ ] **Step 2 — the "yellow T" (test the shared-root-cause hypothesis, outside-voice #5):** raycast from the
  camera through the glyph, and/or `scene.traverse` logging name/type/material/color near the green. FIRST
  test the classmap-bleed hypothesis: is the T the packed mask's green channel (`#ffff00`) leaking into
  visible albedo? Toggle the classmap/mask texture off → does the T vanish? Record: what it is, where built,
  and whether it shares a root cause with the (deferred-to-P2) orange dots. Classify: gameplay UI (gate it) /
  classmap bleed (note; the composite fix rides with P2's classmap work) / stray placeholder (remove at
  source).
- [ ] **Step 3 — ball/pin auto-scale (outside-voice #8):** confirm `scene.js:1322-1324` inflates ball→26× /
  pin→6× at the survey framings. Decide the survey-distance treatment for Task 1 (cap the scale, or hide
  ball/pin entirely in free/overview — the pin flag is a legitimate wayfinding aid, the giant ball is not).
- [ ] **Step 4 — pond "checker" (cheap-fix probe only):** frame the pond from `ov_south`. Toggle to isolate:
  (a) hide the `Reflector` meshes (`userData.isWaterReflector`) → recapture; (b) `uChop=0` → recapture. IF the
  Reflector toggle removes the checker, the fix is a **cheap distance/frustum gate of the Reflector** (mesh
  visibility, no shader text, no cache key — outside-voice #9) → keep in Task 2. IF it needs a shader-LOD arc,
  **defer** (document as a TODO; out of P0a scope).
- [ ] **Step 5 — GATE:** produce the fix list — for each UI-leak artifact: exact object/material/file:line +
  fix + class (gate vs remove) + difficulty. Downgrade any that turns out to be a legit in-play-only element
  to "capture-methodology, no product fix" and document. Confirm the surface artifacts (pond-if-arc, dots,
  seam, cloud shadows) are logged as **deferred to P2/later**, not silently dropped.

---

## Task 1: Gate leaked gameplay/debug UI out of survey/beauty framings

**Files:** `public/render/scene.js` (`_aimLineUpdate`, `_idleTargets`/`_freeTargets` scale, a new
`_isPlayFraming()` helper), `test/scene-ui-gating.test.mjs` (create).

- [ ] **Step 1:** Add a single source of truth `_isPlayFraming()` — true only when `camMode === 'idle'` and
  not `anim`/`static`; false in `free`/overview. Route through it: (a) `aimLine.visible` (currently ungated —
  add the gate); (b) the ball/pin readability scale — in a non-play framing, do NOT inflate the ball (cap at
  1×, or hide it); keep the pin visible but cap its scale to something sane. Keep play-mode behaviour exactly
  as-is.
- [ ] **Step 2:** Route the "T" per Task 0: if gameplay UI → same gate; if classmap bleed → note for P2 (the
  composite fix rides with P2's classmap work) and do NOT hack-hide it here; if a stray placeholder → remove
  at source.
- [ ] **Step 3 (unit test, eng-review #4):** `test/scene-ui-gating.test.mjs` (node --test, matches
  `test/*.test.mjs`) asserting the `_isPlayFraming()` predicate + the derived visibility/scale decisions:
  aim line hidden + ball not inflated for `free`/overview; aim line visible + normal ball for idle-play. Pure
  predicate, no renderer. Run `npm test`; expect green.
- [ ] **Step 4:** Verify through the fixture: survey frames (free-cam) show no aim line, no giant ball, no
  stray glyph; the real idle **play** frame still shows the aim line + normal ball (no gameplay regression).
  Commit.

## Task 2: Pond "checker" — ONLY if Task 0 found a cheap Reflector-gate

**Files:** `public/render/scene.js` (Reflector visibility) — mesh-visibility only, no `water.js` shader text.

- [ ] **Step 1:** If Task 0 Step 4 showed the Reflector is the cause: distance/frustum-gate the per-pond
  `Reflector` so it stops rendering the aliased 1024² texture at overview (mesh `.visible` by camera
  distance). No shader edit → **no cache-key change** (outside-voice #9). If Task 0 found it needs a shader
  LOD, this task is **skipped** and the pond is a deferred TODO — do NOT open the water shader in P0a.
- [ ] **Step 2:** Verify through the fixture: `ov_south` pond no longer reads as a grid at overview AND a
  play-height pond frame still ripples/reflects. Commit.

---

## Deferred out of P0a (folded into later phases — see master plan + TODO)

- **Classmap dot-screen** → **P2** (the SDF surface pipeline rewrites the `turf.js` classmap composite; if
  Task 0 found it shares the T's root cause, the fix lands there once). Do NOT stopgap it in P0a.
- **HD patch macro tonal seam** → **P2** (same `turf.js` edge-blend rewrite). The "macro edge-feather" polish
  moves there so it is not built twice.
- **Pond shader LOD** (if Task 0 found the checker is NOT a cheap Reflector-gate) → later (P4 atmosphere, or a
  standalone water-LOD TODO).
- **Baked cloud shadows in the drape** → assess-only, later (full de-lighting out of scope).

---

## Verify / done (whole phase)

- Re-capture the 6-frame sweep **through the committed fixture** (same pinned pos/target/fov; overview frames
  in free-cam, play frame in real idle): **no leaked gameplay/debug UI**; the play frame still shows the aim
  line + normal ball.
- `test/scene-ui-gating.test.mjs` green; full `npm test` green.
- Never-regress check on the sweep: lidar landform, registration, sky, greige sand intact.
- Update `docs/TODO.md` + `docs/HANDOFF.md` in the same change; record the P0→P0a re-scope and the deferred
  items. Correct the master-plan "T = tee sprite" note.
- Optional: one dual-assessor pass on the cleaned sweep — confirm the "debug-viewer / leaked-UI" read is gone
  (log the delta; expect ~3 → ~3.5 from the UI cleanup alone).
- Finish with superpowers:finishing-a-development-branch (present PR/merge options).

---

## Implementation Tasks
Synthesized from this review's findings. Each derives from a specific finding. Checkbox as you ship.

- [ ] **T1 (P1, human: ~2-3h / CC: ~45min)** — capture-fixture + Task 0 — commit the 6-frame fixture
  (free-cam overviews + a real idle play frame) and diagnose the UI-leak artifacts (aim line, 26× ball,
  yellow T, pond Reflector probe)
  - Surfaced by: Architecture #1 + outside-voice #4/#8 — harness is ad-hoc; pin framings for pixel-comparable before/after
  - Files: `docs/fixtures/chambers-sweep.json` (create), `public/render/scene.js` (read)
  - Verify: 6-frame BEFORE set captured through the fixture; per-artifact fix list produced
- [ ] **T2 (P1, human: ~2h / CC: ~20min)** — `scene.js` — add `_isPlayFraming()` and gate the aim line +
  ball/pin auto-scale out of free/overview; keep play-mode exact
  - Surfaced by: Section 1 + outside-voice #8 (`scene.js:1322-1324` ball 26×); aim line is ungated today
  - Files: `public/render/scene.js`
  - Verify: sweep shows no aim line / no giant ball; real idle play frame still shows aim line + normal ball
- [ ] **T3 (P1, human: ~30min / CC: ~5min)** — test — `test/scene-ui-gating.test.mjs` asserting the predicate
  + derived visibility/scale across camModes
  - Surfaced by: Test review #4 — no existing test covers aimLine/camMode (grep `NONE`)
  - Files: `test/scene-ui-gating.test.mjs`
  - Verify: `npm test` green
- [ ] **T4 (P2, human: ~1h / CC: ~15min)** — `scene.js` — distance/frustum-gate the per-pond `Reflector`
  **only if** Task 0 finds it is the checker cause (mesh visibility, no shader, no cache-key)
  - Surfaced by: outside-voice #9 — conditional on Task 0 Step 4
  - Files: `public/render/scene.js`
  - Verify: `ov_south` pond flat at overview AND a play-height pond still ripples

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean (SCOPE_REDUCED) | 4 issues + outside-voice re-scope, 0 critical gaps, 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE VOICE (Claude subagent, Codex not installed):** 10 findings; 3 load-bearing claims verified against code (ball 26× scale `scene.js:1322`, aim line un-gated, classmap `#ffff00` pack `scene.js:444`). Drove the P0→P0a re-scope.
- **CROSS-MODEL:** 1 tension (P0 scope). Review accepted 6-artifact P0; outside voice argued to shrink. Resolved → **re-scope to P0a** (ship UI gate; defer classmap-dots + macro-seam to P2, which rewrites those surfaces). All 4 eng-review findings folded; ball-scale added as a missed artifact; master-plan "T = tee sprite" claim corrected.
- **VERDICT:** ENG CLEARED (SCOPE_REDUCED) — ready to implement P0a.

NO UNRESOLVED DECISIONS
