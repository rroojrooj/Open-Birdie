# Phase 0 — Debug-Artifact Purge (sub-plan)

> Sub-plan of [`2026-07-06-reality-master-plan.md`](2026-07-06-reality-master-plan.md). REQUIRED SUB-SKILL after
> `/plan-eng-review`: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** remove every placeholder/debug/leaked-UI artifact from the beauty/overview/play captures so the
renderer stops reading as "a GIS viewer with its debug layer on." Both dual-assessors called these out as
"costing more credibility than any missing technique." Target: the fixed 6-frame Chambers sweep shows
**zero** placeholder artifacts; play-mode gameplay UI still renders correctly; no regression to the
never-regress set (lidar landform, registration, sky, greige sand).

**Approach:** ROOT-CAUSE, not cosmetic hide. Several artifacts are not statically obvious from code reading
(the "yellow T", the pond "checker", the override "halftone"), so **Task 0 is a live diagnostic gate** that
identifies each object/material/code-path before any fix. Two distinct classes emerged in diagnosis and the
fixes differ:
- **(A) Real rendering bugs** — pond aliasing/checker, override-fill dot-screen, HD patch tonal seams.
- **(B) Gameplay UI leaking into non-play framings** — the dashed aim line (real, `scene.js:1152`
  `LineDashedMaterial`, shown by `_idleTargets` at `:1232`), the unidentified "T" 3D object. These render
  correctly in PLAY mode; the fix is camera/mode gating, NOT deletion. (DOM distance markers `scene.js:114`
  are NOT in canvas captures — no action for beauty shots.)

**Tech stack:** Three.js (`scene.js` object/material builds, water.js), the headless capture/render loop
(verify server :8223 + sink :9100), fixed 6-frame sweep (`pro_ov_south/ov_high/play/green/h15/sand`).

**Diagnosis already done (do not re-derive):**
- Aim line = `THREE.Line` + `LineDashedMaterial` (white, 0.45 opacity), built in `_aimLineUpdate`
  (`scene.js:1140`), set visible in `_idleTargets` (`:1232`), hidden in `playShot` (`:1165`). Not hidden in
  `free`/overview → leaks into survey captures.
- Water = a full animated shader (`water.js` — ripple normals + envMap + Fresnel + foam + per-pond
  `Reflector`), NOT a debug texture. The "blue grid/checker" is therefore a rendering artifact of that
  material at overview distance (candidate causes: ripple-normal × envMap moiré with no distance LOD /
  anisotropy; or the 1024² `Reflector`), to be confirmed live in Task 0.
- Pin flag is red (`0xd83a3a`); no tee-marker mesh exists in `scene.js` → the "yellow T" is an
  unidentified 3D object requiring a live raycast.

---

## Task 0: Live diagnostic gate — identify + classify all 6 artifacts (HARD go/no-go)

**Files:** none (live inspection + capture only). **Output:** a precise per-artifact fix list; gates Tasks 1–6.

- [ ] **Step 1:** Start verify server :8223 + sink :9100, load Chambers, wait HD (~13s). Re-capture the
  fixed 6-frame sweep (the exact framings from the assessment) as the BEFORE set.
- [ ] **Step 2 — the "yellow T":** in `pro_sand`'s framing, raycast from the camera through the glyph's
  screen position (and/or `scene.traverse` logging name/type/material/color of small objects near the green)
  to identify the object. Record: what it is, where it's built, whether it's gameplay UI (gate it) or a
  stray placeholder (fix/remove it).
- [ ] **Step 3 — pond "checker":** frame the pond from `pro_ov_south`. Toggle live to isolate the cause:
  (a) hide the `Reflector` meshes (`userData.isWaterReflector`) → recapture; (b) set `uChop=0` (flat
  normal) → recapture; (c) check the water texture/anisotropy. Record which toggle removes the checker →
  that's the root cause (reflector vs ripple-moiré vs filtering).
- [ ] **Step 4 — override "halftone" stamps:** in `pro_ov_high`, identify the dotted orange fill. Candidates:
  the NDVI classmap sand at low res, the OSM `bunker` splat fill, or a curated-override layer. Toggle the
  classmap surfaces texture (as done in prior arcs) + inspect the bunker splat to pin the source.
- [ ] **Step 5 — HD patch tonal seams:** confirm the rectangular value steps in `pro_ov_high` are the
  HD-patch macro edges (vs the course-wide tint). Note the seam magnitude.
- [ ] **Step 6 — baked cloud shadows:** confirm the dark blobs in the drape are capture-day shadows in the
  aerial (vs live sun). Assess only.
- [ ] **Step 7 — GATE:** produce the fix list — for each of the 6, the exact object/material/file:line + the
  fix approach + class (A bug / B UI-gate) + a difficulty flag. Any artifact that turns out to be a
  non-issue (e.g. the "T" is a legit in-play marker only visible because the capture forced a weird camera)
  is downgraded to "capture-methodology, no product fix" and documented. STOP and re-scope if >1 artifact is
  actually a large hidden arc (e.g. the pond needs a full water LOD system) rather than a purge-sized fix.

---

## Task 1: Gate gameplay UI out of survey/beauty framings (aim line + "T" if UI)

**Files:** `public/render/scene.js` (`_aimLineUpdate` / `_idleTargets` / a new visibility helper), `config.js`.

- [ ] **Step 1:** Add a single source of truth for "is this a play framing" — aim line + any in-play markers
  visible ONLY when `camMode === 'idle'` AND not `anim`/`static`; hidden in `free` and whenever the app is
  in a non-play/overview state. (The aim line is already hidden in `playShot`; extend to `free`/overview.)
- [ ] **Step 2:** If Task 0 found the "T" is gameplay UI, route it through the same gate. If it's a stray
  placeholder, remove it at its source instead.
- [ ] **Step 3:** Verify: the sweep (survey cameras) shows no aim line / no "T"; then load a PLAY-mode frame
  and confirm the aim line STILL renders in play (no gameplay regression). Commit.

## Task 2: Pond water artifact (per Task-0 root cause)

**Files:** `public/render/water.js`, possibly `scene.js` (reflector gating), `config.js`.

- [ ] **Step 1:** Apply the Task-0-identified fix. Likely one of: (a) distance-LOD the ripple detail (fade
  `uChop`→0 and drop to a flat envMap tint beyond ~120 m so the moiré vanishes at overview), (b) raise the
  water map anisotropy / mip handling, or (c) frustum/distance-gate the per-pond `Reflector` so it doesn't
  render the checker at overview. Keep near/play water quality intact.
- [ ] **Step 2:** Verify: `pro_ov_south` pond reads as calm flat water (not a grid) at overview AND a
  play-height pond frame still ripples/reflects. Commit.

## Task 3: Override / classmap fill dot-screen (per Task-0 source)

**Files:** `public/render/turf.js` (sand/classmap composite) or `scene.js` (splat/override paint).

- [ ] **Step 1:** Make the identified fill render as the greige sand MATERIAL (no dot/halftone). If it's the
  classmap sand at low res, the P0-scope fix is to stop the dot-screen read (e.g. ensure `cls.b` composites
  as smooth coverage, not a thresholded stipple); deeper classmap resolution is P2, not here.
- [ ] **Step 2:** Verify: `pro_ov_high` override areas read as continuous sand, no dot pattern; classmap
  behaviour on Chambers/Sawgrass unregressed. Cache-key bump + `hd-turf.test.mjs` if the shader text changes.
  Commit.

## Task 4: HD patch tonal seams (the deferred macro edge-feather)

**Files:** `public/render/scene.js` (`_macro`/HD patch macro build) or the HD tint path.

- [ ] **Step 1:** Feather the HD-patch macro-tint edge into the course-wide tint (a soft alpha ramp over the
  patch boundary) so the rectangular value step dissolves. This is the "macro color edge-feathering" polish
  deferred from the HD arc. Do NOT touch `courseFingerprint` inputs (non-fingerprinted scenery only).
- [ ] **Step 2:** Verify: `pro_ov_high` shows no rectangular tonal seams; HD relief + registration
  unregressed. Commit.

## Task 5 (assess-only): baked cloud shadows in the drape

- [ ] **Step 1:** If a cheap luma normalization / gentle high-pass on the far-photo layer reduces the
  "dirt-stain" cloud shadows WITHOUT the "de-light went milky" regression, apply it (small, knobbed).
  Otherwise document as an accepted limitation and move on (full de-shadowing is out of P0 scope).

---

## Verify / done (whole phase)

- Re-capture the fixed 6-frame sweep; **zero** placeholder/debug artifacts; capture a play-mode frame to
  confirm gameplay UI (aim line, markers) still renders in play.
- Never-regress check: lidar landform, registration, sky, greige sand all intact on the sweep.
- `npm test` green (cache-key/test updates if any shader text changed). Update `docs/TODO.md` +
  `docs/HANDOFF.md` in the same change; note any artifact downgraded to "capture-methodology, no fix."
- Optional but recommended: re-run ONE dual-assessor pass on the cleaned sweep to log the P0 score delta
  (expected ~3 → ~3.5) and confirm no new artifacts.
- Finish with superpowers:finishing-a-development-branch (present PR/merge options).
