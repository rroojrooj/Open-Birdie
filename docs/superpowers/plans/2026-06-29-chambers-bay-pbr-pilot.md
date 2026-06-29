# Chambers Bay PBR Feature-Reconstruction Pilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For 3 contiguous Chambers Bay holes (8, 9, 10), reconstruct the played surfaces (green/bunker/fairway, + per-hole boundary) from the draped aerial into the override sidecar so they get real physics, and render them with authored PBR materials that read PGA-real (not "clay") — gated on a hole-9 screenshot check before scaling.

**Architecture:** A per-hole loop — crop the registered course aerial → a vision subagent traces surface rings (shape + course-website reference, not color) → convert pixels→local metres (linear, the aerial bounds are already local metres) → write the override sidecar (existing seam: feeds both `makeSurfaceLookup` physics and the renderer) → swap the procedural sand/green decals for authored-PBR materials → verify by overlay + physics asserts + a play-camera screenshot. No terrain sculpting (level 1); the photo aerial stays as albedo for rough/background.

**Tech Stack:** Node ≥22 (`node:test`), Three.js (`MeshStandardMaterial`, custom turf shader), CommonJS in `lib/`, ESM in `public/render/` + `tools/`. Reuses the override sidecar (`lib/course.js`), the surface-patch draping (`public/render/drape.js`, `scene.js _addSurfacePatches`), and the course aerial (`/api/course-aerial`).

**Spec:** `docs/superpowers/specs/2026-06-29-chambers-bay-pbr-pilot-design.md`

---

## Review revisions (from /plan-eng-review, 2026-06-29) — these supersede the tasks below where they conflict

- **D1 — PBR stays in one plan.** No phasing; build PBR (Tasks 8-10) then the Task 11 clay gate, which still blocks scaling to 8/10 and allows the per-surface photo-first fallback.
- **D2 — Commit the reconstructed sidecar to git as a curated fixture.** Add `data/curated/chambers-bay.surfaces.json` (committed, NOT gitignored). Extend `loadSurfaceOverride` (lib/course.js): if the data-dir `<slug>.surfaces.json` is absent, fall back to `data/curated/<slug>.surfaces.json`. The data-dir file (if present) still wins, so local edits override the committed baseline. Add a test for the fallback. Tasks 7 & 12 write the reconstruction here (not just provenance notes), so a fresh checkout renders the holes.
- **D3 — Test the full data-correctness path** (not just the forward transform):
  - `aerial-xform.mjs` also exports the **inverse** `localToFullPx` / `localToCropPx`; add a **round-trip** test `px → local → px` (catches the y-axis flip the overlay currently catches only by eye).
  - Extract the sidecar **merge** out of the CLI into a pure `mergeTrace(sidecar, traceLocal)` (new `tools/trace/merge.mjs`); unit-test append-surfaces / set-pin / set-boundary / idempotent re-merge.
  - The **physics asserts** (`surfaceAt(pin)==='green'`, tee→pin ≈ yardage) become **committed tests** (`test/chambers-pilot-physics.test.js`) run against the committed curated fixture, reusing the `test/course-override.test.js` pattern. Not a REPL step.
- **Step-0 YAGNI — `simplify.mjs` is now OPTIONAL.** The trace prompt caps rings at ≤40 points, so Task 5 (Douglas-Peucker) is conditional: build it only if the Task 7 overlay-verify shows jagged rings. Otherwise replace with a point-count guard in the schema validator (Task 4).

---

## §12 decisions (resolved here, per the spec handoff)

1. **Trace-agent output schema** — one JSON object per hole (Task 4). Each surface is a **single closed ring**; multi-part features (e.g. two bunkers) are **separate entries** of the same `kind`; **nested** features (a bunker inside the fairway) are just both emitted — `makeSurfaceLookup`'s priority (`water>bunker>green>tee>fairway`) resolves overlap, so **no hole-punching**. Pixel origin = **crop top-left, +x right, +y down**.
2. **Boundary storage** — sidecar gains `holeBoundaries: { "<ref>": [[x,y],…] }`; `applySurfaceOverride` writes it to `course.holes[i].boundary` (Task 2). (Distinct from the existing course-wide `course.boundary` used for OB.) Served to the client automatically via `holes[]` in `courseGeometry()`.
3. **Contiguity gate** — Task 1 confirms 8-9-10 adjacency from the live `/api/course-geometry`; if a neighbor isn't adjacent, substitute the true neighbor before proceeding.
4. **Convergence mechanic** — **merge `claude/hd-discovery-plan4` into the working branch** in this worktree (Task 0). plan4 is checked out in another worktree (can't `checkout` here); merging it in is isolated from the user's running plan4 app and brings all realism code. We never touch `canonicalCourse`, so the HD fingerprint is unaffected.

---

## File structure (created / modified)

| File | Responsibility |
|---|---|
| `tools/trace/aerial-xform.mjs` *(new)* | Pure: crop-pixel → local-metre transform. Testable. |
| `tools/trace/trace-schema.mjs` *(new)* | Pure: validate a per-hole trace JSON object. Testable. |
| `tools/trace/simplify.mjs` *(new)* | Pure: Douglas–Peucker ring simplification. Testable. |
| `tools/trace-features.mjs` *(new)* | CLI: crop a hole region from the aerial, print the transform, merge traced rings → sidecar, render an overlay-verify PNG. |
| `lib/course.js` *(modify ~457)* | Extend `applySurfaceOverride` to apply `holeBoundaries`. |
| `public/render/pbr-materials.js` *(new)* | Authored PBR factories: `makeSandMaterialPBR`, `makeGreenMaterialPBR`, `makeFairwayMaterialPBR` — signature `(bounds, aniso)` to drop into `_addSurfacePatches`. |
| `public/render/scene.js` *(modify ~300-322)* | Wire PBR factories in; retire the honeycomb `makeSandMaterial` decal; add green/fairway PBR patches. |
| `public/render/assets/pbr/*` *(new)* | CC0 albedo/normal/roughness maps (sand, green turf, fairway turf). |
| `data/courses/chambers-bay.surfaces.json` *(new, gitignored data)* | The reconstructed surfaces + pins + boundaries for 8/9/10. |
| `test/course-boundary.test.js` *(new)* | TDD the boundary application. |
| `test/aerial-xform.test.mjs`, `test/trace-schema.test.mjs`, `test/simplify.test.mjs` *(new)* | TDD the pure helpers. |
| `docs/surface-override-sidecar.md` *(modify)* | Document `holeBoundaries`. |
| `docs/HANDOFF.md`, `docs/TODO.md` *(modify)* | Record the pilot outcome. |

---

## Task 0: Converge onto plan4

**Files:** none (git only).

- [ ] **Step 1: Merge plan4 into the working branch**
Run: `git merge --no-edit claude/hd-discovery-plan4`
Expected: a merge commit, or conflicts (most likely only in `docs/`). If conflicts, keep both doc sets; for any code conflict, prefer plan4's realism code.

- [ ] **Step 2: Confirm the realism code is present**
Run: `ls public/render/scene.js && grep -c "applySurfaceOverride" lib/course.js && ls tools/add-course-aerial.mjs`
Expected: all present, grep ≥ 1.

- [ ] **Step 3: Tests green on the merged base**
Run: `npm test`
Expected: PASS (the plan4 baseline is 202/202). If red, fix the merge before continuing.

- [ ] **Step 4: Commit** (merge commit already created; nothing extra unless conflicts were resolved)

---

## Task 1: Contiguity gate + capture live hole frames

**Files:** `docs/superpowers/plans/notes/chambers-pilot-frames.json` *(new, scratch)*

> Needs the real data dir. Set `BIRDIE_DATA_DIR` to the main repo's `data/` (per HANDOFF §0). The chambers-bay course + aerial must already be cached there (it is, per HANDOFF §5).

- [ ] **Step 1: Start the server**
Run: `BIRDIE_DATA_DIR=C:/Users/USER/Documents/GitHub/Open-Birdie/data node server.js` (background, port 8222).

- [ ] **Step 2: Load Chambers Bay + pull geometry**
Run: `curl -s -X POST localhost:8222/api/load-course -H 'content-type: application/json' -d '{"cached":"chambers-bay.json"}' && curl -s localhost:8222/api/course-geometry > docs/superpowers/plans/notes/chambers-pilot-frames.json`

- [ ] **Step 3: Confirm 8-9-10 are contiguous; capture per-hole frames**
Inspect `geo.holes[]` for refs 8, 9, 10: record each hole's `tee`, `pin`, `line`, and the green centroid (if any). Compute pairwise tee/green distances. **Gate:** if 8 and 10 aren't both adjacent to 9 (greens/tees within a normal hole's reach, not across the course), substitute the actual physical neighbors of 9 and note the change. Also capture `geo.aerial.bounds` and the aerial image dimensions (`curl -s localhost:8222/api/course-aerial -o /tmp/cb-aerial.jpg` then read its WxH).
Expected: a confirmed 3-hole set + their frame coords saved.

- [ ] **Step 4: Commit the frame notes**
`git add docs/superpowers/plans/notes/chambers-pilot-frames.json && git commit -m "chore(pilot): capture live frames for the 3 contiguous pilot holes"`

---

## Task 2: Per-hole boundary field in the override sidecar (TDD)

**Files:**
- Modify: `lib/course.js:457` (`applySurfaceOverride`)
- Test: `test/course-boundary.test.js` *(new)*
- Modify: `docs/surface-override-sidecar.md`

- [ ] **Step 1: Write the failing test** (`test/course-boundary.test.js`, CommonJS — match `test/course-override.test.js`)

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applySurfaceOverride } = require('../lib/course');

const course = () => ({ name: 'T', holes: [{ ref: 9, tee: [0, 0], pin: [10, 10] }], surfaces: [], boundary: null });

test('holeBoundaries set per-hole boundary on the matching hole', () => {
  const c = course();
  applySurfaceOverride(c, { holeBoundaries: { 9: [[0, 0], [50, 0], [50, 50], [0, 50]] } });
  assert.deepEqual(c.holes[0].boundary, [[0, 0], [50, 0], [50, 50], [0, 50]]);
});

test('a boundary with < 3 points is ignored (no throw)', () => {
  const c = course();
  applySurfaceOverride(c, { holeBoundaries: { 9: [[0, 0], [1, 1]] } });
  assert.equal(c.holes[0].boundary, undefined);
});

test('holeBoundaries does not disturb the course-wide boundary', () => {
  const c = course(); c.boundary = [[0, 0], [9, 0], [9, 9]];
  applySurfaceOverride(c, { holeBoundaries: { 9: [[0, 0], [5, 0], [5, 5]] } });
  assert.deepEqual(c.boundary, [[0, 0], [9, 0], [9, 9]]);
});
```

- [ ] **Step 2: Run it; verify it fails**
Run: `node --test test/course-boundary.test.js`
Expected: FAIL (holeBoundaries not handled — `boundary` stays undefined).

- [ ] **Step 3: Implement** — in `applySurfaceOverride`, after the `surfaces` block, before `return course;`:

```js
  if (override.holeBoundaries && typeof override.holeBoundaries === 'object') {
    for (const h of course.holes || []) {
      const b = override.holeBoundaries[h.ref];
      if (Array.isArray(b) && b.length >= 3 && b.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) {
        h.boundary = b;
      }
    }
  }
```

- [ ] **Step 4: Run it; verify it passes**
Run: `node --test test/course-boundary.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Document** — add a `holeBoundaries` subsection to `docs/surface-override-sidecar.md` (map of `ref`→ring in local metres; sets `holes[].boundary`; distinct from the course-wide OB `boundary`; malformed ignored).

- [ ] **Step 6: Commit**
`git add lib/course.js test/course-boundary.test.js docs/surface-override-sidecar.md && git commit -m "feat(override): per-hole boundary via holeBoundaries sidecar field"`

---

## Task 3: Crop-pixel → local-metre transform (TDD)

**Files:** Create `tools/trace/aerial-xform.mjs`; Test `test/aerial-xform.test.mjs`

- [ ] **Step 1: Write the failing test** (`test/aerial-xform.test.mjs`, ESM — match `test/drape.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { fullPxToLocal, ringPxToLocal } from '../tools/trace/aerial-xform.mjs';

// Aerial bounds: x 0..100 (east), y 0..200 (north). Image 100x200 px.
const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 200 };
const W = 100, H = 200;

test('top-left pixel = (minX, maxY); bottom-right = (maxX, minY)', () => {
  assert.deepEqual(fullPxToLocal({ px: 0, py: 0 }, bounds, W, H), { x: 0, y: 200 });
  assert.deepEqual(fullPxToLocal({ px: 100, py: 200 }, bounds, W, H), { x: 100, y: 0 });
});

test('center pixel maps to bounds center', () => {
  const c = fullPxToLocal({ px: 50, py: 100 }, bounds, W, H);
  assert.ok(Math.abs(c.x - 50) < 1e-9 && Math.abs(c.y - 100) < 1e-9);
});

test('ringPxToLocal applies the crop offset', () => {
  // crop starts at full-pixel (10,20); a crop point (0,0) = full (10,20)
  const ring = ringPxToLocal([[0, 0]], { x0: 10, y0: 20 }, bounds, W, H);
  assert.deepEqual(ring[0], fullPxToLocal({ px: 10, py: 20 }, bounds, W, H));
});
```

- [ ] **Step 2: Run it; verify it fails**
Run: `node --test test/aerial-xform.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (`tools/trace/aerial-xform.mjs`)

```js
// Pixel<->local transform for the course aerial.
// The aerial covers `bounds` (LOCAL METRES) over an image imgW×imgH.
// Convention: image origin top-left; +px = east (+localX); +py = south (-localY).
// (Confirmed by the overlay-verify step; if the overlay is mirrored, the aerial
// was exported with the opposite y, so flip the y term here and re-verify.)
export function fullPxToLocal({ px, py }, bounds, imgW, imgH) {
  const x = bounds.minX + (px / imgW) * (bounds.maxX - bounds.minX);
  const y = bounds.maxY - (py / imgH) * (bounds.maxY - bounds.minY);
  return { x, y };
}
export function cropPxToLocal({ cx, cy }, crop, bounds, imgW, imgH) {
  return fullPxToLocal({ px: crop.x0 + cx, py: crop.y0 + cy }, bounds, imgW, imgH);
}
export function ringPxToLocal(ringPx, crop, bounds, imgW, imgH) {
  return ringPx.map(([cx, cy]) => { const p = cropPxToLocal({ cx, cy }, crop, bounds, imgW, imgH); return [p.x, p.y]; });
}
```

- [ ] **Step 4: Run it; verify it passes** — `node --test test/aerial-xform.test.mjs` → PASS.

- [ ] **Step 5: Commit**
`git add tools/trace/aerial-xform.mjs test/aerial-xform.test.mjs && git commit -m "feat(trace): pure crop-pixel to local-metre transform"`

---

## Task 4: Trace-agent output schema + validator (TDD)

**Files:** Create `tools/trace/trace-schema.mjs`; Test `test/trace-schema.test.mjs`

**Schema (per hole):**
```jsonc
{ "hole": 9,
  "crop": { "x0": 800, "y0": 1100, "w": 420, "h": 520 },   // full-image pixel rect of the crop
  "pin_px": [210, 260],                                      // pin in CROP pixels (optional)
  "surfaces": [
    { "kind": "green",  "poly_px": [[..],[..],[..]], "confidence": 0.8 },
    { "kind": "bunker", "poly_px": [[..],[..],[..]], "confidence": 0.7 }
  ],
  "boundary_px": [[..],[..],[..]] }                          // optional per-hole corridor
```

- [ ] **Step 1: Write the failing test** (`test/trace-schema.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { validateTrace } from '../tools/trace/trace-schema.mjs';

const ok = { hole: 9, crop: { x0: 0, y0: 0, w: 10, h: 10 },
  surfaces: [{ kind: 'green', poly_px: [[0, 0], [1, 0], [1, 1]], confidence: 0.9 }] };

test('accepts a well-formed trace', () => { assert.deepEqual(validateTrace(ok).errors, []); });
test('rejects an unknown kind', () => {
  const bad = { ...ok, surfaces: [{ kind: 'lava', poly_px: [[0, 0], [1, 0], [1, 1]] }] };
  assert.ok(validateTrace(bad).errors.length > 0);
});
test('rejects a ring with < 3 points', () => {
  const bad = { ...ok, surfaces: [{ kind: 'green', poly_px: [[0, 0], [1, 1]] }] };
  assert.ok(validateTrace(bad).errors.length > 0);
});
test('rejects a missing crop', () => { assert.ok(validateTrace({ hole: 9, surfaces: [] }).errors.length > 0); });
```

- [ ] **Step 2: Run; fail** — `node --test test/trace-schema.test.mjs` → FAIL (no module).

- [ ] **Step 3: Implement** (`tools/trace/trace-schema.mjs`)

```js
const KINDS = new Set(['green', 'bunker', 'fairway', 'tee', 'water']);
const isRing = (r) => Array.isArray(r) && r.length >= 3 &&
  r.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
export function validateTrace(t) {
  const errors = [];
  if (!t || typeof t !== 'object') return { errors: ['not an object'] };
  if (!Number.isFinite(t.hole)) errors.push('hole missing');
  const c = t.crop;
  if (!c || !['x0', 'y0', 'w', 'h'].every((k) => Number.isFinite(c[k]))) errors.push('crop missing/invalid');
  if (!Array.isArray(t.surfaces)) errors.push('surfaces missing');
  else t.surfaces.forEach((s, i) => {
    if (!s || !KINDS.has(s.kind)) errors.push(`surface[${i}] bad kind`);
    if (!s || !isRing(s.poly_px)) errors.push(`surface[${i}] bad poly_px`);
  });
  if (t.boundary_px != null && !isRing(t.boundary_px)) errors.push('boundary_px invalid');
  return { errors };
}
```

- [ ] **Step 4: Run; pass** — PASS (4/4).

- [ ] **Step 5: Commit**
`git add tools/trace/trace-schema.mjs test/trace-schema.test.mjs && git commit -m "feat(trace): per-hole trace-output schema validator"`

---

## Task 5: Ring simplification (TDD)

**Files:** Create `tools/trace/simplify.mjs`; Test `test/simplify.test.mjs`

- [ ] **Step 1: Failing test** (`test/simplify.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { simplifyRing } from '../tools/trace/simplify.mjs';

test('collinear midpoints are dropped', () => {
  const r = [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]]; // [5,0] is redundant
  const s = simplifyRing(r, 0.5);
  assert.ok(!s.some((p) => p[0] === 5 && p[1] === 0));
  assert.ok(s.length >= 4);
});
test('a near-circle keeps its shape but loses points', () => {
  const r = Array.from({ length: 64 }, (_, i) => [Math.cos(i / 64 * 2 * Math.PI), Math.sin(i / 64 * 2 * Math.PI)]);
  const s = simplifyRing(r, 0.05);
  assert.ok(s.length < r.length && s.length >= 8);
});
```

- [ ] **Step 2: Run; fail.**

- [ ] **Step 3: Implement** (`tools/trace/simplify.mjs`) — standard Douglas–Peucker:

```js
function perp(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
}
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = perp(pts[i], pts[0], pts[pts.length - 1]); if (d > max) { max = d; idx = i; } }
  if (max > eps) return [...dp(pts.slice(0, idx + 1), eps).slice(0, -1), ...dp(pts.slice(idx), eps)];
  return [pts[0], pts[pts.length - 1]];
}
export function simplifyRing(ring, eps = 0.5) {
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring.slice();
  if (open.length <= 3) return open;
  return dp([...open, open[0]], eps).slice(0, -1);
}
```

- [ ] **Step 4: Run; pass.**

- [ ] **Step 5: Commit**
`git add tools/trace/simplify.mjs test/simplify.test.mjs && git commit -m "feat(trace): Douglas-Peucker ring simplification"`

---

## Task 6: `trace-features.mjs` CLI — crop, merge, overlay-verify

**Files:** Create `tools/trace-features.mjs`

This is glue (not unit-tested); it composes Tasks 3–5 + the sidecar. Three subcommands:

- `crop --hole N --course <file> --aerial <jpg>` → writes `.shots/trace-hN.png` (the hole crop) + prints `crop {x0,y0,w,h}` and the live `aerial.bounds` + image WxH. Crop rect = the hole's bbox (tee+line+green+OSM surfaces near the hole) padded ~30 m, converted local→full-pixel (inverse of Task 3).
- `merge --hole N --trace <json> --course <file>` → validate (Task 4) → `simplifyRing` (Task 5) → `ringPxToLocal` (Task 3) → upsert into `data/courses/<slug>.surfaces.json`: append `surfaces` (with `hole`/`confidence`/`source:"claude-vision"` provenance), set `pins[N]`, set `holeBoundaries[N]`.
- `overlay --hole N --course <file> --aerial <jpg>` → re-draw the sidecar's local-metre rings back onto the hole crop (local→full-pixel→crop-pixel) as colored outlines → `.shots/overlay-hN.png` for eyeballing registration.

- [ ] **Step 1: Implement the three subcommands** using `pngjs`/`sharp` for raster IO (already used by the spikes) and the Task 3–5 modules.
- [ ] **Step 2: Smoke-test `crop` on hole 9** — `node tools/trace-features.mjs crop --hole 9 --course data/courses/chambers-bay.json --aerial data/courses/chambers-bay.aerial.jpg` → `.shots/trace-h9.png` exists and visibly shows hole 9's green area. (Use the live frames from Task 1; if the OSM hole is mislocated, crop around the coursepreview-located green instead.)
- [ ] **Step 3: Commit**
`git add tools/trace-features.mjs && git commit -m "feat(trace): crop/merge/overlay CLI for per-hole reconstruction"`

---

## Task 7: Trace hole 9 end-to-end (the anchor)

**Files:** `data/courses/chambers-bay.surfaces.json` (data).

- [ ] **Step 1: Produce the crop + reference** — `crop --hole 9` (Task 6) → `.shots/trace-h9.png`. Fetch the coursepreview.golf hole-9 reference image (the answer key for layout/green/bunkers/pin).
- [ ] **Step 2: Dispatch the vision-trace subagent.** Give it BOTH images and this instruction:

> You are tracing golf surfaces from an aerial crop. Image A = a top-down aerial photo crop of one hole (pixels, origin top-left). Image B = the course-website layout reference for the same hole. Output ONLY JSON matching this schema: `{hole, crop:{x0,y0,w,h}, pin_px:[x,y], surfaces:[{kind,poly_px:[[x,y]…],confidence}], boundary_px:[[x,y]…]}`. `kind` ∈ green|bunker|fairway|tee|water. Trace by SHAPE and the reference, NOT color — dry fescue and sand look alike; use B to disambiguate. One ring per feature; separate entries for separate bunkers. Green = the smooth mown putting surface; pin_px = its visual center unless B shows the flag. Keep rings to ≤40 points. Use the crop {x0,y0,w,h} I provide verbatim.

Pass `crop` from Step 1 verbatim. Capture the JSON.

- [ ] **Step 3: Merge + overlay-verify** — `merge --hole 9 --trace <json>` then `overlay --hole 9`. Open `.shots/overlay-h9.png`: the rings must sit on the right features and match the reference. If mirrored/offset → fix the y-convention in Task 3 (`fullPxToLocal`) and re-merge. Iterate until registration is correct.
- [ ] **Step 4: Physics asserts** (restart server so the sidecar loads via `activateCourse`):
  - `surfaceAt(pin)` for hole 9 returns `'green'` (query via a tiny endpoint or a node REPL using `makeSurfaceLookup`).
  - tee→pin distance along the hole line ≈ scorecard yardage (hole 9 ≈ 221y per the HUD) within ~10%.
- [ ] **Step 5: Commit the sidecar** (data is gitignored, so this commit is the *tooling state* + a copy of the trace JSON under `docs/superpowers/plans/notes/` for provenance)
`git add docs/superpowers/plans/notes/trace-h9.json && git commit -m "data(pilot): reconstructed hole 9 surfaces (provenance copy)"`

---

## Task 8: Source CC0 PBR assets

**Files:** `public/render/assets/pbr/{sand,green,fairway}/{albedo,normal,rough}.jpg` *(new)*

- [ ] **Step 1: Download CC0/public-domain tiling maps** (e.g. Poly Haven) for: bunker sand, fine mown green turf, fairway turf. Each: albedo + normal + roughness, ~1–2k, seamless. Record sources + licenses in `public/render/assets/pbr/CREDITS.md`.
- [ ] **Step 2: Verify license is CC0/public-domain** for every file before committing.
- [ ] **Step 3: Commit** — `git add public/render/assets/pbr && git commit -m "assets(render): CC0 PBR maps for sand/green/fairway"`

---

## Task 9: Authored-PBR material factories

**Files:** Create `public/render/pbr-materials.js`

Each factory matches the `_addSurfacePatches` contract `makeMat(bounds, aniso) → THREE.Material`. **Anti-clay rules baked in:** real normal maps, per-instance low-freq color variation (so no flat sheet), physically-sane roughness, no emissive, soft edges via the existing `drapeRing` lift + `polygonOffset`.

- [ ] **Step 1: `makeSandMaterialPBR(bounds, aniso)`** — `MeshStandardMaterial` with sand albedo/normal/roughness (≈0.9, non-metal), `normalScale ≈ (1,1)`, world-space UV via `bounds` (reuse the repeat math from `makeSandMaterial`), albedo multiplied by a subtle large-scale noise (onBeforeCompile) so the sand isn't uniform. Rake lines come from the existing `buildRakes` props — keep those.
- [ ] **Step 2: `makeGreenMaterialPBR(bounds, aniso)`** — turf albedo/normal, low roughness band variation for **mow stripes** (alternating roughness/normal across a mow axis via onBeforeCompile), faint anisotropic sheen, subtle macro color variation.
- [ ] **Step 3: `makeFairwayMaterialPBR(bounds, aniso)`** — as green, broader/softer stripes, slightly higher roughness.
- [ ] **Step 4: Light unit test where possible** (`test/pbr-materials.test.mjs` is hard without a GL context) — at minimum assert each factory returns a `MeshStandardMaterial` with a `map`, `normalMap`, `roughness` in (0,1], `metalness===0` (mock `THREE` or guard the import). If a GL context isn't available in `node:test`, skip and rely on the screenshot gate (Task 11) — note this explicitly.
- [ ] **Step 5: Commit** — `git add public/render/pbr-materials.js test/pbr-materials.test.mjs && git commit -m "feat(render): authored PBR material factories (sand/green/fairway)"`

---

## Task 10: Wire PBR into the renderer; retire the honeycomb

**Files:** Modify `public/render/scene.js` (~line 15 import, ~300-322 wiring)

- [ ] **Step 1: Import** the PBR factories alongside the existing turf import.
- [ ] **Step 2: Replace** the bunker decal `this._addSurfacePatches(group, ['bunker'], makeSandMaterial)` with `makeSandMaterialPBR`. **Add** `this._addSurfacePatches(group, ['green'], makeGreenMaterialPBR)` and `['fairway']` (guarded with the same `try/catch` + the `_hdPatch`/`RENDER_CONFIG` guards already there). Keep `buildRakes`. Leave the aerial macro untouched (rough/background stays photo).
- [ ] **Step 3: Remove** the now-unused honeycomb `makeSandMaterial` import/usage *only if nothing else references it* (grep first; it may still back a fallback — if so, leave it).
- [ ] **Step 4: Reload the page** (client change) and confirm no console errors; surfaces render on hole 9.
- [ ] **Step 5: Commit** — `git add public/render/scene.js && git commit -m "feat(render): use authored PBR for played surfaces; retire honeycomb sand decal"`

---

## Task 11: CLAY-AVOIDANCE GATE (hole 9) — blocks scaling

**Files:** none (verification).

- [ ] **Step 1: Screenshot hole 9 at the play camera** via the headless render loop (HANDOFF §6: server :8223, `.shots/sink.cjs`, `setSize` before `toDataURL`). Capture the tee view and a greenside view.
- [ ] **Step 2: Side-by-side** the screenshot vs (a) the raw aerial for the same area and (b) a real PGA-game reference shot.
- [ ] **Step 3: Judge against acceptance criteria** — the green reads as mown turf (stripes/variation, not a flat disc); bunkers read as real sand (texture + the lidar hollow, not a tan blob); nothing is plastic/blown-out; surfaces sit grounded (no floating decal edges).
- [ ] **Step 4: If it fails** → iterate Task 9 material params (variation strength, normalScale, roughness, stripe contrast). **If authored PBR still can't beat the raw photo for a given surface** → per the spec's pre-approved fallback, render that surface photo-first (skip its PBR patch, let the aerial show through) and record the decision. **Do not proceed to Task 12 until hole 9 passes or the fallback is taken.**
- [ ] **Step 5: Save the approved shots** to `.shots/` and copy into `docs/superpowers/plans/notes/` for the record. Commit the notes.

---

## Task 12: Scale to holes 8 & 10

**Files:** `data/courses/chambers-bay.surfaces.json`; notes.

- [ ] **Step 1: For hole 8, then hole 10** — repeat Task 7 (crop → vision-trace → merge → overlay-verify → physics asserts). Run the two trace agents **in parallel** (independent holes).
- [ ] **Step 2: Screenshot 8 & 10** at the play camera. **Watch for the expected flat-bunker finding:** 8 & 10 have no 1 m lidar, so bunkers have no local hollow. If PBR sand on flat ground reads wrong, record it and propose the cheap micro-depression carve (a smooth downward displacement inside each bunker ring) as a **follow-up** (out of pilot scope unless trivial).
- [ ] **Step 3: Physics asserts** for 8 & 10 (surfaceAt(pin)==='green'; yardage). 
- [ ] **Step 4: Commit** provenance notes for 8 & 10.

---

## Task 13: Docs + final verification

- [ ] **Step 1: Full test run** — `npm test` → green (Node ≥22; remember the `node --test` glob silently zero-passes below 21).
- [ ] **Step 2: Update `docs/HANDOFF.md`** — new section: the PBR feature-reconstruction pilot, what shipped (the trace pipeline, the boundary field, PBR materials), the hole-9 gate verdict, and the flat-bunker finding.
- [ ] **Step 3: Update `docs/TODO.md`** — close the pilot item; add discovered follow-ups (scale to 18 via the hybrid proposer; bunker micro-depressions if needed; two-layer aerial; auto-fetch).
- [ ] **Step 4: Commit** — `git add docs && git commit -m "docs(pilot): record PBR reconstruction pilot outcome + follow-ups"`

---

## Verification summary (definition of done)

- `npm test` green, including the 3 new pure-helper suites + the boundary suite.
- Holes 8, 9, 10: traced rings overlay correctly on the aerial and match the course-website layout; `surfaceAt(pin)==='green'`; tee→pin ≈ scorecard yardage.
- Hole 9 passes the clay-avoidance gate (or a per-surface photo-first fallback is recorded).
- Docs (HANDOFF, TODO, sidecar contract) updated in the same branch.

## Risks carried from the spec

- **PBR may still read claymier than the photo** at the orbit camera (memory: photo-first tested better). The Task 11 gate + pre-approved fallback is the control.
- **Flat-hole bunkers** (8 & 10, no lidar hollow) — expected finding, micro-depression is the likely follow-up.
- **Aerial y-orientation** — the overlay-verify (Task 7.3) is the catch; flip in one place if mirrored.
- **Trace edge precision** — eyeballed; overlay + reference cross-check + `confidence` provenance are the controls.

## NOT in scope (deferred, with rationale)

- **Phasing PBR into a separate PR** — considered (D1); user kept one plan. Task 11 gate is the guard.
- **All 18 holes** — pilot proves 3 first; scale via the hybrid algorithmic proposer afterward.
- **Terrain sculpting (level 2)** — bunker micro-depressions on coarse holes 8/10 are an expected *finding*, deferred to a follow-up unless trivial.
- **Hybrid algorithmic proposer** — only built if the pilot succeeds and we scale.
- **Auto-fetch of aerial/buildings, two-layer aerial, 3D props (trees/flagstick/rakes)** — separate tracks.
- **`simplify.mjs`** — optional (D3/Step-0); build only if overlay-verify shows jagged rings.

## What already exists (reused, not rebuilt)

- Override sidecar + `applySurfaceOverride`/`loadSurfaceOverride` (`lib/course.js`) — physics + render seam.
- `makeSurfaceLookup` (priority water>bunker>green>tee>fairway, course-wide OB `boundary`).
- Surface-patch draping (`drape.js` `densifyRing`/`drapeRing`, `scene.js _addSurfacePatches`), `buildRakes`.
- Course-wide aerial (`/api/course-aerial`, `course.aerial{file,bounds}`) — local-metre bounds (px↔local is linear).
- Animated water (`water.js buildWater`). The vision/segmentation spikes (`tools/spike-*.mjs`) as references.

## Failure modes (per new codepath)

| Codepath | Realistic failure | Test? | Error handling? | Visible? |
|---|---|---|---|---|
| px↔local transform | y-axis flip → all features mirrored | YES (D3 round-trip) | n/a | overlay + test |
| sidecar merge | off-by-one / dup append → wrong/overlapping surfaces | YES (D3 merge test) | malformed entries already ignored | test + overlay |
| vision trace | mislabel waste-area as fairway | NO (human control) | schema-validate drops bad shapes | overlay + coursepreview |
| loader fallback (D2) | curated fixture missing/corrupt | YES (D2 test) | `loadSurfaceOverride` try/catch returns null | log line |
| PBR materials | clay / specular blowout | NO (screenshot gate) | try/catch keeps load working | Task 11 gate |

No critical gaps (no failure that is silent AND untested AND unhandled — D3 closed the transform/merge silent-corruption risk).

## Parallelization strategy

| Workstream | Modules | Depends on |
|---|---|---|
| Pure helpers (xform, schema, merge, simplify?) | `tools/trace/` | Task 0 |
| Boundary + loader fallback | `lib/course.js`, `test/` | Task 0 |
| PBR materials + assets | `public/render/`, assets | Task 0 |
| Trace execution (holes 8/9/10) | data + `tools/trace-features.mjs` | helpers done |

- **Lane A:** pure helpers → trace CLI → trace execution (sequential, shared `tools/trace/`).
- **Lane B:** boundary + loader fallback (independent, `lib/course.js`).
- **Lane C:** PBR materials + assets (independent, `public/render/`).
- Launch A, B, C in parallel worktrees; merge; then run trace execution + the Task 11 gate. The 3 per-hole traces (Task 12) run in parallel.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 3 decisions resolved, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED — ready to implement (decisions D1-D3 folded into the plan above).
