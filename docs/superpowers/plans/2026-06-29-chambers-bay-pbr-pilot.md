# Chambers Bay Surface Reconstruction — Phase A (physics-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct correct playing-surface polygons (green / bunker / fairway + per-hole boundary) for 3 Chambers Bay holes (8, 9, 10) from registered imagery, written to the override sidecar so **physics is correct** (the ball reacts to sand/green/rough). No new rendering — surfaces use the existing render path. Authored-PBR rendering is **Phase B** (separate plan).

**Architecture:** Per-hole loop — LOCATE the hole visually (registered aerial + course-website reference, NOT OSM, which mis-places holes here) → WINDOW the native 0.6 m NAIP COG → CLASSIFY (NDVI + texture proposes candidate regions; a vision subagent labels/disambiguates green vs bunker vs fairway) → VECTORIZE to rings → CONVERT px→local (exact, linear) → MERGE into the override sidecar (committed as a curated fixture) → VERIFY (overlay + committed physics tests). The sidecar already feeds both physics (`makeSurfaceLookup`) and the renderer through one seam.

**Tech Stack:** Node ≥22 (`node:test`), CommonJS in `lib/`, ESM in `tools/`. Reuses `lib/course.js` (override sidecar), `tools/hd-course/{coordinates,bounds,naip,cog-source}.mjs` (the COG + transform stack the spikes already use), and `tools/spike-segment.mjs` (NDVI) as the classification base.

**Spec:** `docs/superpowers/specs/2026-06-29-chambers-bay-pbr-pilot-design.md`

---

## Review history (what shaped this plan)

- **Brainstorm + spec review:** approved the override-sidecar mechanism + per-hole loop.
- **/plan-eng-review (D1-D3):** D1 keep one plan (later reversed, see D5); D2 commit the sidecar; D3 test the data-correctness path.
- **Outside voice (independent Claude challenge):** found 3 P0s the eng review missed — (P0-1) the clay gate ran on hole 9 whose green PBR path is disabled by `!this._hdPatch` (`scene.js:307`); (P0-2) D2's "fresh checkout renders" is false because `data/` is gitignored; (P0-3) the locator was undefined (OSM mis-places holes, coursepreview is images not coordinates). Plus P1s: better inputs exist (NDVI + 0.6 m COG in `spike-segment.mjs`/`spike-vision-detect.mjs`); vision ring-tracing at 0.9 m/px can't hit the precision; flat-terrain PBR is the clay problem restated.
- **/plan-eng-review (D5):** **SPLIT.** This plan is now physics-first (Phase A). Rendering A/B (photo-first vs authored PBR) on a non-HD hole is **Phase B**, a separate plan. The split makes P0-1 moot (no PBR gate here), forces the locator fix (P0-3), and adopts the better inputs (P1-4/5).

---

## File structure (created / modified)

| File | Responsibility |
|---|---|
| `tools/trace/aerial-xform.mjs` *(new)* | Pure: px↔local transform **+ inverse** (`fullPxToLocal`, `localToFullPx`, ring helpers). Testable. |
| `tools/trace/trace-schema.mjs` *(new)* | Pure: validate a per-hole trace object (incl. ≤40-pt ring guard). Testable. |
| `tools/trace/vectorize.mjs` *(new)* | Pure: binary mask → simplified polygon rings (contour + Douglas-Peucker). Testable. |
| `tools/trace/merge.mjs` *(new)* | Pure: `mergeTrace(sidecar, traceLocal)` → append surfaces / set pin / set boundary. Testable. |
| `tools/trace-features.mjs` *(new)* | CLI: locate → window COG → NDVI/texture → vision-label → vectorize → merge → overlay-verify. |
| `lib/course.js` *(modify ~457, ~474)* | `applySurfaceOverride` applies `holeBoundaries`; `loadSurfaceOverride` falls back to the committed curated fixture. |
| `data/curated/chambers-bay.surfaces.json` *(new, COMMITTED)* | The reconstructed surfaces/pins/boundaries for 8/9/10 (the work product, in git). |
| `test/course-boundary.test.js`, `test/course-curated-fallback.test.js` *(new)* | TDD boundary + loader fallback. |
| `test/aerial-xform.test.mjs`, `test/trace-schema.test.mjs`, `test/vectorize.test.mjs`, `test/merge.test.mjs` *(new)* | TDD the pure helpers (incl. px→local→px round-trip). |
| `test/chambers-pilot-physics.test.js` *(new)* | Committed physics asserts: `surfaceAt(pin)==='green'`, tee→pin ≈ yardage (corrected tee). |
| `docs/surface-override-sidecar.md`, `docs/HANDOFF.md`, `docs/TODO.md` *(modify)* | Document `holeBoundaries`, the curated-fixture fallback, the pilot outcome. |

---

## Task 0: Converge onto plan4

- [ ] **Step 1:** `git merge --no-edit claude/hd-discovery-plan4` (resolve any `docs/` conflicts, prefer plan4 code for any code conflict).
- [ ] **Step 2:** Confirm realism code present: `ls public/render/scene.js tools/spike-segment.mjs && grep -c applySurfaceOverride lib/course.js`.
- [ ] **Step 3:** `npm test` → green (plan4 baseline 202/202). Fix the merge before continuing if red.

## Task 1: LOCATE holes 8, 9, 10 (the P0-3 fix — OSM is NOT the locator)

**Files:** `docs/superpowers/plans/notes/chambers-pilot-frames.json` *(new)*

The registered aerial is georeferenced exactly (local-metre bounds), so a hole can be located by *finding* its green in the aerial, not by trusting OSM vectors. Procedure per hole:

- [ ] **Step 1:** Start server (`BIRDIE_DATA_DIR=<main-repo>/data node server.js`), `POST /api/load-course {cached:"chambers-bay.json"}`, `GET /api/course-geometry` → save `geo` (holes[], aerial.bounds, image WxH from `/api/course-aerial`).
- [ ] **Step 2 (locate, vision-proposes + human-confirms):** For each of 8/9/10: render/crop the **registered course aerial** for a wide region around the OSM line (OSM is a weak hint only), pass it + the **coursepreview.golf** reference for that hole to a vision subagent; it returns the green's center + the tee location in aerial pixels. Convert → local metres. **Human-confirm** each against the coursepreview layout before accepting (3 holes — cheap, reliable). If the agent can't place a hole confidently, fall back to a manual pick off the aerial.
- [ ] **Step 3 (contiguity + correctness gate):** Confirm 8/9/10 are physically adjacent AND each located green sits in fescue/green imagery (not a parking lot). If a hole is wrong or non-adjacent, substitute the true neighbor. Record corrected `tee`/`greenCenter`/`line` per hole. These corrected coords (not OSM) drive cropping and the yardage check.
- [ ] **Step 4:** Commit the frame notes.

## Task 2: Per-hole boundary field (TDD)

**Files:** Modify `lib/course.js` (`applySurfaceOverride`); Test `test/course-boundary.test.js`; Doc `docs/surface-override-sidecar.md`

- [ ] **Step 1: Failing test** (CommonJS, match `test/course-override.test.js`):

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applySurfaceOverride } = require('../lib/course');
const course = () => ({ name: 'T', holes: [{ ref: 9, tee: [0,0], pin: [10,10] }], surfaces: [], boundary: null });

test('holeBoundaries sets per-hole boundary', () => {
  const c = course();
  applySurfaceOverride(c, { holeBoundaries: { 9: [[0,0],[50,0],[50,50],[0,50]] } });
  assert.deepEqual(c.holes[0].boundary, [[0,0],[50,0],[50,50],[0,50]]);
});
test('boundary < 3 pts ignored, course-wide boundary untouched', () => {
  const c = course(); c.boundary = [[0,0],[9,0],[9,9]];
  applySurfaceOverride(c, { holeBoundaries: { 9: [[0,0],[1,1]] } });
  assert.equal(c.holes[0].boundary, undefined);
  assert.deepEqual(c.boundary, [[0,0],[9,0],[9,9]]);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** implement (in `applySurfaceOverride`, before `return course`):

```js
  if (override.holeBoundaries && typeof override.holeBoundaries === 'object') {
    for (const h of course.holes || []) {
      const b = override.holeBoundaries[h.ref];
      if (Array.isArray(b) && b.length >= 3 && b.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) h.boundary = b;
    }
  }
```

- [ ] **Step 4:** Run → PASS. **Step 5:** document `holeBoundaries` in the sidecar doc. **Step 6:** commit.

## Task 3: px↔local transform + inverse + round-trip test (TDD) — D3

**Files:** Create `tools/trace/aerial-xform.mjs`; Test `test/aerial-xform.test.mjs`

- [ ] **Step 1: Failing test** (ESM) — forward, inverse, and **round-trip**:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { fullPxToLocal, localToFullPx } from '../tools/trace/aerial-xform.mjs';
const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 200 }, W = 100, H = 200;
test('corners', () => {
  assert.deepEqual(fullPxToLocal({ px:0, py:0 }, bounds, W, H), { x:0, y:200 });
  assert.deepEqual(fullPxToLocal({ px:100, py:200 }, bounds, W, H), { x:100, y:0 });
});
test('round-trip px→local→px (catches axis flips)', () => {
  for (const [px,py] of [[10,20],[55,140],[99,199]]) {
    const l = fullPxToLocal({ px, py }, bounds, W, H);
    const r = localToFullPx(l, bounds, W, H);
    assert.ok(Math.abs(r.px-px) < 1e-6 && Math.abs(r.py-py) < 1e-6, `${px},${py} -> ${r.px},${r.py}`);
  }
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** implement forward + inverse (image top-left origin; +px=east, +py=south; verified by overlay, flip y here if mirrored):

```js
export function fullPxToLocal({ px, py }, b, W, H) {
  return { x: b.minX + (px/W)*(b.maxX-b.minX), y: b.maxY - (py/H)*(b.maxY-b.minY) };
}
export function localToFullPx({ x, y }, b, W, H) {
  return { px: (x-b.minX)/(b.maxX-b.minX)*W, py: (b.maxY-y)/(b.maxY-b.minY)*H };
}
export const ringPxToLocal = (ring, b, W, H) => ring.map(([px,py]) => { const p = fullPxToLocal({px,py}, b, W, H); return [p.x,p.y]; });
export const ringLocalToPx = (ring, b, W, H) => ring.map(([x,y]) => { const p = localToFullPx({x,y}, b, W, H); return [p.px,p.py]; });
```

- [ ] **Step 4:** Run → PASS. **Step 5:** commit.

## Task 4: Trace schema validator (TDD)

**Files:** Create `tools/trace/trace-schema.mjs`; Test `test/trace-schema.test.mjs`

Per-hole object: `{ hole, crop:{x0,y0,w,h}, pin_px:[x,y], surfaces:[{kind,poly_px,confidence}], boundary_px }`. `kind` ∈ green|bunker|fairway|tee|water. Validator rejects: missing hole/crop, bad kind, rings <3 pts **or >40 pts** (the precision guard from P1-5). Single ring per entry; multi-part = multiple entries; nested handled by `makeSurfaceLookup` priority (no hole-punching). Tests: accept valid, reject unknown kind, reject <3-pt and >40-pt rings, reject missing crop. (Implementation as in the prior draft + the >40 guard.)

## Task 5: NDVI + texture segmentation from the native 0.6 m COG (the P1-4 fix)

**Files:** `tools/trace/segment.mjs` *(new, extracted from `tools/spike-segment.mjs`)*; Test `test/segment.test.mjs`

`spike-segment.mjs` already windows the NAIP COG **with the NIR band** and computes NDVI + a 7px texture std-dev. Promote its pure core into `tools/trace/segment.mjs`: given a 4-band window (R,G,B,NIR), return per-pixel candidate classes — `sand` (low NDVI + bright), `water` (low NDVI + dark), `green` (high NDVI + low texture), `fairway` (mid NDVI + mid texture), `rough` (else). NDVI separates sand from fescue — the exact disambiguation the drape (RGB-only) could not do.

- [ ] **Step 1: Failing test** — feed synthetic 4-band pixels, assert class per the thresholds (sand: NDVI<0.05 & bright; green: NDVI>0.30 & texture<9; etc.).
- [ ] **Step 2-4:** extract the classifier as a pure function `classifyPixel({R,G,B,N}, texture)` + `segmentWindow(bands, w, h)`; run → PASS.
- [ ] **Step 5:** commit. (The COG windowing itself reuses `naip.mjs`/`cog-source.mjs` as in the spike — glue, exercised in Task 9.)

## Task 6: Vectorize mask → rings (TDD)

**Files:** Create `tools/trace/vectorize.mjs`; Test `test/vectorize.test.mjs`

Pure: a binary mask (one class) → outer-contour rings → Douglas-Peucker simplify (≤40 pts) → drop rings below a min area (noise). Tests: a filled rectangle mask → a 4-ish-pt ring; a tiny speck → dropped; a ring respects the ≤40-pt cap. (DP from the prior draft; this REPLACES the standalone `simplify.mjs` — it lives here now.)

## Task 7: Sidecar merge (pure, TDD) — D3

**Files:** Create `tools/trace/merge.mjs`; Test `test/merge.test.mjs`

- [ ] **Step 1: Failing test:** `mergeTrace(sidecar, { hole, surfacesLocal, pinLocal, boundaryLocal })` appends surfaces with `{kind,poly,hole,confidence,source}`, sets `pins[hole]`, sets `holeBoundaries[hole]`; re-merging the same hole **replaces** that hole's entries (idempotent), doesn't duplicate.
- [ ] **Step 2-4:** implement pure merge (no fs); run → PASS. **Step 5:** commit.

## Task 8: Curated-fixture fallback (the corrected D2 — TDD)

**Files:** Modify `lib/course.js` (`loadSurfaceOverride`); Test `test/course-curated-fallback.test.js`

**Honest framing (P0-2):** committing the sidecar preserves the *trace work product* in git and makes it the default when no machine-local override exists. It does NOT make a bare clone render — that also needs the course JSON + aerial + HD bundle, which stay machine-local (documented as a Phase-A prerequisite; a frozen course fixture is a Phase B/follow-up concern).

- [ ] **Step 1: Failing test:** with no `<dataDir>/<slug>.surfaces.json`, `loadSurfaceOverride` returns the parsed `data/curated/<slug>.surfaces.json`; with both present, the data-dir file wins.
- [ ] **Step 2-4:** implement the fallback (try data dir, then repo `data/curated/`); run → PASS. **Step 5:** commit.

## Task 9: `trace-features.mjs` CLI (glue)

**Files:** Create `tools/trace-features.mjs`

Subcommands composing Tasks 3-7: `locate` (Task 1 helper), `segment --hole N` (window COG → `segment.mjs` → write candidate-class PNG + crop transform), `vectorize --hole N` (masks → rings), `label --hole N` (dispatch a vision subagent on the candidate PNG + coursepreview ref to assign kinds + fix edges), `merge --hole N` (px→local via Task 3 → `mergeTrace` → write `data/curated/chambers-bay.surfaces.json`), `overlay --hole N` (rings local→px back onto the COG crop → `.shots/overlay-hN.png`).

- [ ] Implement; smoke-test `segment --hole 9` produces a plausible candidate-class PNG. Commit.

## Task 10: Reconstruct holes 9, 8, 10

**Files:** `data/curated/chambers-bay.surfaces.json`

- [ ] **Hole 9 first, then 8 & 10 (parallel):** `locate` → `segment` → `vectorize` → `label` (vision agent assigns green/bunker/fairway to candidates, using the coursepreview reference; NDVI already did sand-vs-veg) → `merge` → `overlay`. Open `.shots/overlay-hN.png`: rings must sit on the right features and match coursepreview. If mirrored → flip y in `aerial-xform` (Task 3) and re-merge. Iterate per hole until registration is right. **Restart the server after each merge** (the sidecar loads in `activateCourse`) — bake this into the loop.
- [ ] Commit `data/curated/chambers-bay.surfaces.json`.

## Task 11: Committed physics tests (TDD) — D3

**Files:** Create `test/chambers-pilot-physics.test.js`

- [ ] Against the committed curated fixture (load it, build a course stub with 8/9/10 + the fixture applied), assert per hole: `makeSurfaceLookup(course)(pin) === 'green'`; tee→pin distance (using the **corrected** tee from Task 1, not OSM) ≈ scorecard yardage within ~10%. Run → PASS. Commit.

## Task 12: Docs + final verification

- [ ] `npm test` green (Node ≥22). Update `docs/HANDOFF.md` (Phase A outcome + the locator procedure), `docs/TODO.md` (close Phase A; add Phase B), `docs/surface-override-sidecar.md` (curated fallback + holeBoundaries). Commit.

---

## Phase B — rendering A/B (DEFERRED, separate plan)

Not built here. When Phase A's physics surfaces are correct, Phase B does an honest **photo-first vs authored-PBR** A/B **on a non-HD hole (8 or 10)** where the green/fairway patch path actually runs (avoids the P0-1 gate-hole trap). It owns: PBR asset sourcing, `pbr-materials.js`, the `scene.js` wiring (resolving the `_hdPatch`/`crispBunkers` gates + extending `turf.js` mow stripes rather than duplicating them), the clay-avoidance screenshot gate, and the bunker micro-depression question for flat terrain. A `/plan-design-review` belongs here, not in Phase A.

---

## Verification (Phase A definition of done)

- `npm test` green incl. the new pure-helper suites + boundary + curated-fallback + physics tests.
- Holes 8/9/10: overlay rings match the aerial + coursepreview; `surfaceAt(pin)==='green'`; tee→pin ≈ yardage (corrected tee).
- The reconstructed sidecar is committed under `data/curated/`.

## NOT in scope (deferred, with rationale)

- **All PBR / authored materials, the clay gate, asset sourcing** → Phase B (D5 split).
- **All 18 holes** → scale after the 3-hole pilot proves the locator + segmentation.
- **Terrain sculpting / bunker micro-depressions** → Phase B (only matters once rendering is in).
- **Frozen course+aerial+bundle fixture for clean-clone rendering** → follow-up (P0-2); Phase A is machine-local for the underlying course data.
- **Auto-fetch of aerial/buildings, two-layer aerial, 3D props** → separate tracks.

## What already exists (reused, not rebuilt)

- Override sidecar + `applySurfaceOverride`/`loadSurfaceOverride` (`lib/course.js`), `makeSurfaceLookup` (priority + course-wide OB boundary).
- The COG stack: `tools/hd-course/{coordinates,bounds,naip,cog-source}.mjs`; **`tools/spike-segment.mjs` (NDVI + texture)** — Task 5's base; `tools/spike-vision-detect.mjs` (native-0.6m per-hole window) — Task 1/9 reference.
- Registered course aerial (`/api/course-aerial`, local-metre bounds → linear px↔local).

## Failure modes (per new codepath)

| Codepath | Failure | Test? | Handling? | Visible? |
|---|---|---|---|---|
| px↔local | axis flip → mirrored features | YES (round-trip) | n/a | overlay + test |
| segment (NDVI) | threshold mislabels shadow as water | partial (unit thresholds) | vision-label corrects | overlay |
| vectorize | speck → phantom surface | YES (min-area drop) | min-area | overlay |
| merge | dup/!idempotent re-merge | YES | replace-per-hole | test |
| locate | wrong green chosen | NO (human-confirm) | manual fallback | coursepreview check |
| curated fallback | fixture missing/corrupt | YES | try/catch → null | log |

No critical gaps (no silent + untested + unhandled path).

## Parallelization

- **Lane A:** pure helpers (`tools/trace/*`) → CLI → reconstruction (sequential, shared `tools/trace/`).
- **Lane B:** `lib/course.js` boundary + curated fallback + their tests (independent).
- Launch A + B in parallel worktrees; merge; run reconstruction (holes 8/10 trace in parallel after 9).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | D1-D5 resolved; split to physics-first |
| Outside Voice | independent challenge | Blind spots | 1 | issues_found→resolved | 3 P0 + 3 P1 found, all folded into the split |
| Design Review | `/plan-design-review` | UI/UX | 0 | deferred | belongs to Phase B (rendering) |
| DX Review | `/plan-devex-review` | Dev experience | 0 | — | — |

- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED for Phase A. Design review deferred to Phase B (no new visuals in Phase A).
