# Phase 2a — Crisp surface delineation (sub-plan)

> Sub-plan of [`2026-07-06-reality-master-plan.md`](2026-07-06-reality-master-plan.md) Phase 2. REQUIRED
> SUB-SKILL after `/plan-eng-review`: superpowers:subagent-driven-development or executing-plans.
>
> **RE-ARCHITECTED 2026-07-07 by eng-review + outside voice (see GSTACK REVIEW REPORT at bottom).** The naive
> "whole-course SDF texture" was over-engineered: the crisp EDGE is free via `fwidth`; the SDF's only real
> value is the metre-offset fringe/collar RING, which is sub-texel-unstable at whole-course resolution. New
> approach: **`fwidth` edge everywhere + a LOCAL per-green SDF for the collar only.** P2b (turf light response)
> is still a separate later sub-plan.

**Goal:** surface boundaries (green/fringe/collar, fairway/rough, bunker) read as crisp ~10-20 cm **mow lines**
at the PLAY-TO-MID range, plus a distinct green **fringe/collar ring**. NOT an overview/distance fix — past
~60 m the far-photo (`turf.js:135`, `courseAerialPhotoFar`) owns the pixel, so the crisp edge is a
near/play-range change and the exit bar is scoped there.

## Approach — `fwidth` edge (cheap, everywhere) + LOCAL SDF collar (only where it earns it)

```
CRISP EDGE (everywhere)   fwidth(mask) screen-space AA on the RAW (unblurred) mask channel
                          smoothstep(0.5-fw, 0.5+fw, mask) -> a 1-2px antialiased mow line.
                          NO new texture, NO EDT, NO course/patch UV plumbing. [Layer 1]
FRINGE/COLLAR (greens)    a LOCAL, per-green, higher-res signed-distance field — ONLY around each
                          green (local res makes the 0.3-0.9 m collar band ~2-4 texels, not
                          sub-texel) -> a stable offset ring just outside the putting surface.
                          Built only if Task 0 proves the collar needs it AND a local SDF is stable.
```

**Why `fwidth`, not a whole-course SDF (outside-voice findings 3+7):** a crisp single-threshold edge is
sub-texel by construction with `fwidth` — no precomputed field needed. The SDF's ONLY advantage is a
metre-offset band (the collar). At whole-course 0.45 m/px a 0.3-0.9 m collar is 0.5-0.66 texels → quantization-
striped/unstable. So the field is worth building ONLY locally around greens (where higher res makes the band
resolvable), and ONLY for the collar. A course-wide SDF (~100 MB, course/patch UV plumbing) for something
`fwidth` does free is accidental complexity.

## TASK 0 GATE RESULT (2026-07-07 — spike run live, code reverted, close cam kept)

Ran the fwidth-edge spike on Chambers at a new ~18-26 m CLOSE green cam (added to
`docs/fixtures/chambers-sweep.json`). **GO on `fwidth`, but Task 1 is bigger than a `gEdge` swap.** Finding
(3 captured frames): the crisp mow-line **COLOR** edge is NOT owned by `gEdge`, and NOT fixed by reducing the
splat blur.
- Swapping `gEdge` (`turf.js:210`) to `smoothstep(0.5±fwidth(g), g)` sharpens the green **character**
  (checker/sheen/contour ride `gEdge`) but the visible green→tan **colour** boundary stayed soft.
- Reducing the green/fairway splat `fillKind` blur (1.0→0.35) sharpened the splat but the boundary STILL read soft.
- **Root cause:** the soft edge is the SUM of three soft contributors — the splat base colour, the `fr` collar
  (~1.8 m `gBlur` dilation), AND the aerial tint (`uMacroLow`, low-freq, soft) — all painting soft green
  across the boundary. Sharpening any one doesn't help.

**Revised Task 1 (the real build):** composite the surface BASE COLOUR **in-shader**, gated by a crisp
`fwidth` mask, so the final green/tan (+ fairway/rough, bunker) boundary is crisp — overriding the soft
splat+tint+collar AT the boundary. Needs the per-surface palette (`this._pal.greenA/rough/...`) as uniforms +
a composite block that (a) picks the base colour from the mask channels with `fwidth` AA and (b) lets the
tint/detail modulate INSIDE each surface without bleeding across the crisp line. Higher blast radius than a
`gEdge` swap (touches the base-albedo path + interacts with the P1b palette + aerial tint) → this is the
genuinely multi-day core of P2a. `fwidth` is confirmed the right edge primitive; the SDF stays collar-only.

**Diagnosis already done (grounded — do not re-derive):**
- `_paintMask(b, kinds)` (`scene.js:635`) rasterizes polys at `ppm = min(2.2, 4096/maxExt)` (~0.45 m/px) with
  `ctx.filter='blur(1px)'`. **`fwidth` wants a SHARP step** → the edge path needs a RAW (unblurred) mask so the
  derivative is crisp (eng-review #1). Keep the blurred mask only for any legacy soft use.
- Green edge today = 8-tap AVERAGE dilation → `gBlur`→`gEdge`/`fr` over ~1.8 m (`turf.js:199-211`); the collar
  `fr` is **fully faded to 0 by 70 m** (`gDistFade = 1-smoothstep(45,70,·)`, `turf.js:209`). Fairway/rough uses
  a soft `edgeW` (`turf.js:100`). Greens were tuned in v29 (soft edge + calm checker + contour) — protect it.
- The far-photo crossfades the real aerial past ~60-150 m (`turf.js:135`); at overview the PHOTO owns the
  surface, so a shader edge can't fix "sticker-greens at distance" — the exit bar is near/play only.
- The NDVI classmap (`classify-surfaces.js`, feathered ~7-17 m, aerial-UV) is unioned into the mown/sand gates
  (`turf.js:89-92`). Crisp `fwidth` on the OSM mask + a feathered classmap ramp on the SAME boundary = a
  DOUBLE edge; the reconciliation must suppress the classmap feather where the OSM mask is authored.
- `customProgramCacheKey` = `'turf-grain-v32'`; GTAO trap (new `texture2D` inside `#ifdef USE_MAP`); every
  shader-text change bumps the key + updates `hd-turf.test.mjs`.
- **Crispness amplifies bad data** (outside-voice #8): raw OSM polys are often mis-registered; the current blur
  hides it. A crisp edge renders OSM slop as a sharp-but-wrong mow line → verify on a ROUGH-OSM course, not
  just Chambers/Sawgrass.

**Tech stack:** `turf.js` (fwidth edge + collar), maybe a small local-SDF helper + test, `scene.js` (raw mask
+ optional local-green SDF), the 6-frame fixture **plus a new close green cam**, `node --test`.

---

## Task 0: GATE — fwidth edge baseline + does the collar need (and survive) a local SDF? (HARD go/no-go)

**Files:** add a CLOSE green-cam frame to `docs/fixtures/chambers-sweep.json` (~15-25 m — eng-review/outside-
voice #1: the existing dist:70 green cam is in the collar-fade + photo zone and CANNOT show the edge). Probe only.

- [ ] **Step 1 (fwidth edge baseline):** in the live shader (or a scratch quad), build the RAW (unblurred) mask
  and `smoothstep(0.5-fwidth(a), 0.5+fwidth(a), a)`. At the CLOSE green cam, confirm a crisp, stable 1-2 px mow
  line (no shimmer under the orbit cam). This is the cheap baseline — it should just work.
- [ ] **Step 2 (OSM-slop check, #8):** eyeball the crisp edge vs the aerial on Chambers AND a rough-OSM course
  (pick one where OSM polys are known-coarse). If crisp edges render OSM registration error as obviously-wrong
  mow lines, note the mitigation (confidence-gate crispness, or keep a mild softening where the classmap and
  OSM disagree).
- [ ] **Step 3 (the REAL risk — the collar band):** build a LOCAL higher-res SDF for ONE green (rasterize just
  that green's neighbourhood at, say, 4-8 px/m), and render the collar band `smoothstep(0,cw,sdf)*(1-smoothstep
  (cw,2cw,sdf))` at `cw`≈0.5 m. Confirm the band is STABLE (no quantization stripes) at the close green cam.
  Dump the collar, not just the edge line.
- [ ] **Step 4 — GATE:** GO if (a) the fwidth edge is crisp+stable (expected) AND (b) either the local SDF
  collar is stable OR a cheaper approximate collar (a second fwidth band on a dilated mask) reads acceptably.
  If the local SDF is fiddly/unstable, fall back to an approximate fwidth collar or a wider (~0.4 m) ring and
  say so. Do NOT build a whole-course SDF.

---

## Task 1: `fwidth` crisp edges in the shader — incremental green → fairway → bunker

**Files:** `public/render/scene.js` (a RAW, unblurred mask for the edge path), `public/render/turf.js`
(replace the soft edges; cache key v33); each sub-step its own commit + close-green-cam verify (eng-review #2).

- [ ] **Step 0:** Add a raw (no-blur) mask alongside the existing blurred one (or a flag to `_paintMask`), wired
  through `_turfInputs` (base + HD-patch).
- [ ] **Step 1a (GREEN):** replace the `gBlur` 8-tap dilation edge with `gEdge = smoothstep(0.5-fwidth(gRaw),
  0.5+fwidth(gRaw), gRaw)`. **Verify the v29 checker + contour roll SURVIVE** at the close green cam. Bump cache
  key v32→v33 + update `hd-turf.test.mjs`. Commit.
- [ ] **Step 1b (FAIRWAY/ROUGH):** replace the `edgeW` blend with the fwidth edge. Verify + commit.
- [ ] **Step 1c (BUNKER):** replace the bunker edge (kills the sand halo band). Verify + commit.

## Task 2: green fringe/collar ring (local SDF or approximate, per Task 0)

**Files:** `public/render/scene.js` (local per-green SDF build, only if Task 0 chose it), `public/render/turf.js`
(collar band), maybe a small `sdf-local.js` + test.

- [ ] **Step 1:** Per Task 0's decision, either (a) build a LOCAL per-green SDF (higher res, only the green's
  neighbourhood) and render the collar offset band, or (b) render an approximate collar (a second fwidth band on
  a dilated green mask). Gate the band by the green-cam range (the collar is a play/mid feature). Keep inside
  `#ifdef USE_MAP`.
- [ ] **Step 2:** Verify: greens show a distinct fringe/collar ring at the close + green cams; no sticker read
  in the play-to-mid range. Commit.

## Task 3: classmap/fwidth reconciliation (kill the double edge)

**Files:** `public/render/turf.js` (the classmap union).

- [ ] **Step 1:** Where the crisp OSM `fwidth` edge and the feathered NDVI classmap describe the SAME boundary,
  suppress the classmap's ~7-17 m feather so you don't get one crisp + one soft edge. Keep the classmap union
  ONLY for coverage OSM genuinely lacks (NDVI-only fairway). If a per-fragment "is this OSM-authored" signal is
  needed, encode it (e.g. the raw OSM mask presence gates the classmap feather off).
- [ ] **Step 2:** Verify: no double edge on Chambers/Sawgrass; NDVI-only coverage still fills; `npm test` green.

## Task 4 (DECOUPLED — separate commit, optionally its own PR): absorb the P0a-deferred dot-screen + macro seam

> Outside-voice #6: these have a DIFFERENT root cause than the edge work (classmap NoColorSpace stipple /
> macro-tint feathering). Co-location in `turf.js` is not logical coupling — keep them off the edge-rewrite
> revert path. Do them AFTER Tasks 1-3 land, as their own commit(s).

- [ ] **Step 1:** Fix the classmap dot-screen (the NoColorSpace packed-mask stipple → smooth coverage) and
  feather the HD-patch macro-tint edge into the course-wide tint. Do NOT touch `courseFingerprint` inputs.
- [ ] **Step 2:** Verify `ov_high`: no dot-screen, no rectangular tonal seam; unregressed elsewhere.

## Task 5: tune + verify on the sweep (the REAL gate)

- [ ] **Step 1:** Capture the fixture (incl. the new CLOSE green cam) for Chambers + Sawgrass + one rough-OSM
  course, before/after. Targets: crisp mow-line edges at play/mid + a fringe/collar ring; no double edge; P1b
  tan / registration / QL1 relief / sky unregressed; OSM slop not egregiously amplified.
- [ ] **Step 2:** Update `docs/TODO.md` + `docs/HANDOFF.md`; note P2b is next.

---

## P2b — turf light response (OUTLINED, next sub-plan after P2a ships)

Detail-normal octaves + roughness breakup; **stripes as light response** (normal-Y flip / anisotropic sheen,
NOT the albedo band at `turf.js:256`); stripe width 7 m → 3-4 m. Its own Task-0 (does anisotropic sheen read at
the orbit cam?) + review.

## Verify / done (P2a)

- Fixture (incl. close green cam) + green cam, Chambers + Sawgrass + a rough-OSM course, before/after: crisp
  play/mid mow-line edges + fringe/collar ring; no double edge; no distance-sticker CLAIM (near/play scope);
  P1b tan / registration / QL1 relief / sky unregressed.
- Any new pure helper (local SDF) TDD'd; full `npm test` green (cache key v32→v33; `hd-turf.test.mjs` updated).
- Finish with superpowers:finishing-a-development-branch.

---

## Implementation Tasks
Synthesized from this review. Each derives from a specific finding. Checkbox as you ship.

- [ ] **T1 (P1, human: ~3-4h / CC: ~45min)** — Task 0 GATE — fwidth edge baseline (raw mask) + a close green
  cam (~15-25 m) + local-SDF collar spike + OSM-slop check on a rough course
  - Surfaced by: outside-voice #1/#3/#7/#8 — the fixture green cam at dist:70 is in the collar-fade+photo zone; the collar (not the edge) is the real risk
  - Files: `docs/fixtures/chambers-sweep.json`
  - Verify: fwidth edge crisp+stable at the close cam; collar stable via local SDF or an accepted fallback
- [ ] **T2 (P1, human: ~1-2d / CC: ~2h)** — `turf.js` — fwidth crisp edges on the RAW mask, incremental green→fairway→bunker (protect the v29 checker/contour); cache v33
  - Surfaced by: Arch #1 (raw raster) + Code-quality #2 (incremental)
  - Files: `public/render/scene.js`, `public/render/turf.js`
  - Verify: crisp mow lines at close green cam; v29 checker/contour survive; `npm test` green
- [ ] **T3 (P1, human: ~1d / CC: ~1-2h)** — green fringe/collar ring (local per-green SDF or approximate fwidth band, per Task 0)
  - Surfaced by: cross-model A — SDF spent only on the collar, locally
  - Files: `public/render/scene.js`, `public/render/turf.js`
  - Verify: distinct collar ring at the green cam; no sticker read at play/mid
- [ ] **T4 (P1, human: ~3-4h / CC: ~45min)** — `turf.js` — classmap reconciliation (suppress the crisp-OSM vs feathered-NDVI double edge)
  - Surfaced by: outside-voice #4 — different UV spaces; precedence needs a per-fragment OSM-authored signal
  - Files: `public/render/turf.js`
  - Verify: no double edge; NDVI-only coverage still fills
- [ ] **T5 (P2, human: ~3-4h / CC: ~45min)** — DECOUPLED (own commit/PR) — absorb the P0a dot-screen + macro seam
  - Surfaced by: outside-voice #6 — different root cause; keep off the edge-rewrite revert path
  - Files: `public/render/turf.js`, `public/render/scene.js`
  - Verify: no dot-screen/seam at `ov_high`; unregressed elsewhere
- [ ] **T6 (P1, human: ~3-4h / CC: ~1h)** — verify on the fixture (close green cam) + a rough-OSM course, before/after
  - Surfaced by: outside-voice #2/#8 — near/play scope only; crisp amplifies OSM slop
  - Files: `docs/fixtures/chambers-sweep.json`

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean (FULL_REVIEW) | 2 issues + outside-voice re-architecture, 0 critical gaps, 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE VOICE (Claude subagent, Codex not installed):** 8 findings, all verified against code. Proved the whole-course SDF over-engineered — `fwidth` gives the crisp edge free; the SDF only earns its cost for the metre-offset collar, which is sub-texel at whole-course res (build it locally). Also: the fixture green cam (dist:70) sits in the collar-fade+photo zone and can't show the fix; "no sticker-greens at distance" is unachievable (far-photo owns the pixel past ~60 m); the classmap "precedence" rule is unimplementable as written; the encoding was self-contradictory; the dot-screen/seam fix was coupled into the SDF PR; crisp edges amplify OSM slop.
- **CROSS-MODEL:** 1 tension (P2a approach). Review accepted the SDF premise; outside voice argued fwidth-first. Resolved → **fwidth edge + LOCAL SDF collar** (A). Correctness folds absorbed: raw mask, incremental green→fairway→bunker, close green cam, near/play exit-bar scope, decouple dot-screen/seam, rough-OSM verify.
- **VERDICT:** ENG CLEARED (FULL_REVIEW) — P2a ready to implement (Task 0 gate first).

NO UNRESOLVED DECISIONS
