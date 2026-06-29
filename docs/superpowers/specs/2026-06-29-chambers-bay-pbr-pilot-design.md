# Design: Chambers Bay per-hole feature reconstruction — PBR pilot (3 holes)

**Date:** 2026-06-29
**Status:** DESIGN — approved in brainstorming, pending spec review + plan.
**Base branch (target):** `claude/hd-discovery-plan4` (the realism trunk). This design is authored
in a `claude/musing-ritchie-ebb288` worktree that is *behind* plan4; **implementation step 0 is to
converge onto plan4** (see §10).
**Supersedes / extends:** `docs/superpowers/plans/2026-06-29-chambers-bay-feature-reconstruction.md`
(on plan4) — same override-sidecar mechanism and per-hole loop; this design **adds** the rendering
fidelity decision (authored PBR), the 3-hole pilot scope, and the per-hole vision-trace fan-out.

---

## 1. Problem (verified)

The course-wide NAIP aerial now drapes the whole course and "looks better." But it is a **flat
photo**: a hole's bunkers / greens / fairways are *pixels*, not objects — no 3D material response
and **no physics** (the ball doesn't know it's in a bunker). Worse, the OSM vector layer that would
locate those features **mis-places whole holes** at Chambers Bay (verified: hole 9's mapped tee/pin
crop lands on the clubhouse parking lot). So there are no trustworthy polygons to turn into
gameplay surfaces, and everything reads as "paint glued to a smooth surface."

The mechanism to *render + physics* surfaces already exists (the override sidecar, §4). **The real
gap is producing correct per-area classification polygons, and rendering them so they look real.**

## 2. Goal & success criteria

For **3 pilot holes (8, 9, 10)**, every played surface (green, bunker, fairway; water if present)
is:

1. **Correctly located & shaped** — traced from the registered aerial + the course-website
   reference, converted to local metres.
2. **Rendered PGA-real, not clay** — authored PBR materials at the orbit/play camera.
3. **Physically live** — `surfaceAt()` returns the right kind; ball plugs in sand, rolls true on green.

**Done =** for all 3 holes: screenshots that read as real turf + sand next to a PGA-game reference;
`surfaceAt(pin) === 'green'`; tee→pin along the hole line ≈ scorecard yardage; traced rings overlay
correctly on the aerial and match the course-website layout.

## 3. Decisions locked (and the alternatives we rejected)

| Decision | Chosen | Rejected (why) |
|---|---|---|
| Depth of "3D" | **Level 1**: correct surfaces + physics on the existing terrain | Terrain sculpting (level 2) and 3D props/trees (level 3) — deferred; revisit if the pilot shows flat holes need it. |
| Classification method | **Per-hole vision trace** (1 subagent/hole, trace rings by shape+reference) | Grid + many tile-agents (stitching + tile-context-loss, highest cost); pure-algorithmic (sand≈fescue, unreliable). Hybrid algorithm→vision is the **scale** path *after* the pilot, not now. |
| Surface rendering | **Authored PBR** on played surfaces; photo aerial kept for rough/background | Photo-first (my recommendation; memory says it tested better at our orbit camera) and photo+PBR-detail — both **kept as fallbacks** behind the clay gate (§7). |
| Pilot size & holes | **8, 9, 10** (contiguous → one aerial region) | All 18 (premature); 9 + best-2-by-feature (user chose contiguity for simpler cropping). |
| Branch | **Converge onto plan4** before building | Merge plan4 into this branch / defer (user chose converge-first). |

**Honest tension to keep visible:** the "clay" look *is* cheap authored PBR (flat color +
honeycomb). Authored PBR only beats the real photo if it hits the bar in §4. The design therefore
gates scaling on an explicit "does it actually beat clay?" screenshot check (§7).

## 4. Architecture

### 4a. Per-hole pipeline

```
LOCATE  → CROP → CLASSIFY → VECTORIZE → CONVERT → WRITE → RENDER+PHYSICS → VERIFY → (iterate)
```

- **LOCATE** — `coursepreview.golf/chambersbay/?hole=N` as the answer key (layout, green shape, pin,
  bunkers, tee, yardage). Live frame from `/api/course-geometry` (`geo.holes[]`, `geo.aerial.bounds`).
  **Not OSM** (mis-places holes here).
- **CROP** — slice the registered course aerial to the hole region (+ padding from the boundary, §5).
- **CLASSIFY** — §4c.
- **VECTORIZE** — raster mask → simplified polygon rings per class (Douglas–Peucker or similar).
- **CONVERT** — pixels → local metres via the exact crop transform (`tools/hd-course/coordinates.mjs`;
  the aerial is requested in EPSG:4326 over the course bbox → maps 1:1 to equirectangular local metres).
- **WRITE** — append surfaces + relocate pin + store boundary in the override sidecar (§4b).
- **RENDER+PHYSICS** — existing seam, with the new PBR materials (§4d).
- **VERIFY** — §7.

### 4b. Reused (do NOT rebuild) — all on plan4

- **Override sidecar** `data/courses/<slug>.surfaces.json` (`lib/course.js`
  `applySurfaceOverride`/`loadSurfaceOverride`; contract in `docs/surface-override-sidecar.md`).
  Applied in `server.js activateCourse` **after** `resolveHdBundle` (never invalidates the HD bundle
  fingerprint). Surfaces append to `course.surfaces`; pins replace. Feeds **both** physics
  (`makeSurfaceLookup`) and the renderer. **Single seam.**
- **Exact px→local transform** — `coordinates.mjs`.
- **Course-wide aerial** — `course.aerial { file, bounds }`, served at `/api/course-aerial`
  (`tools/add-course-aerial.mjs`). Non-fingerprinted.
- **Animated water** — `public/render/water.js buildWater` (+ `water-depth.js` foam).

### 4c. Classification — per-hole vision trace

One subagent per pilot hole, **in parallel** (3 agents). Each receives:
- a tight, high-resolution crop of the registered aerial for its hole, and
- the course-website reference image(s) for that hole.

It traces labeled rings for `green` / `bunker` / `fairway` / (`water`) using **shape + reference,
never color alone** (dry fescue ≈ sand). Output = rings in pixel coords + a per-surface `confidence`.
We convert → metres → sidecar. (This is the existing plan's manual TRACE step, fanned out. The
algorithmic blob-proposer that turns this into the hybrid pipeline is the **scale** step, built only
if the pilot succeeds.)

### 4d. Rendering — authored PBR where it counts (the heart of "look real")

Replace the clay-causing decals — `makeSandMaterial` (honeycomb) and the flat green patches — with a
real PBR material set, **applied only to played surfaces; the aerial photo stays as albedo for
rough / native / background.** This limits authored surface-area to where clay was worst and keeps
the photoreal look the user already liked.

- **Sand (bunkers / waste):** tiling albedo + normal (ripple) + matte roughness (~0.9) + AO; rake-line
  normal detail along the bunker's long axis; brightness modulated by a low-frequency variation map
  so it is never a flat tan sheet; softened, slightly darker (wet/shadowed) rim.
- **Green:** turf albedo + anisotropic sheen (grass direction) + **mow-stripe bands** (alternating
  roughness/normal across the mow axis) + subtle macro color variation. The mow stripes + variation
  are what make a green read as real grass, not a disc.
- **Fairway:** turf albedo + broader, lighter mow stripes.
- **Water:** keep the existing animated mesh.
- **Grounding:** contact AO where surfaces meet terrain; physically-sane roughness/metalness (avoid
  the previously-seen turf specular blowout); existing HDRI sun/sky.
- **Assets:** source CC0 / public-domain PBR turf + sand maps (e.g. Poly Haven) — no licensing risk —
  tuned per surface; committed under the renderer's asset dir.

**Terrain-hollow interaction (important):** on **hole 9** (1 m lidar) a bunker sits in a *real*
depression, so PBR sand reads perfectly. On **holes 8 & 10** (coarse 3DEP, no local hollow) the sand
is flat on a slope — the pilot will reveal whether that's acceptable or whether bunkers need a cheap
**micro-depression carve** (a small, targeted level-2 just under each bunker ring). Not committed
now; it is an expected pilot finding.

## 5. Per-hole boundary (user-requested)

Derive each pilot hole's **playing-corridor boundary** from the located routing + the traced
fairway/surface extent; store it per hole (in the sidecar or alongside). Uses: scoping the trace,
camera framing, and future out-of-bounds. Not gameplay-blocking in the pilot.

## 6. Pilot scope

- **In:** holes **8, 9, 10** (confirm physical contiguity from the live `/api/course-geometry`
  routing; if 8 or 10 isn't actually adjacent to 9, substitute the true neighbor). Build the
  crop/transform + per-hole trace + vectorize + the PBR material set + the verify overlay.
- **Out:** all 18 (scale step), full terrain sculpting (level 2), the algorithmic proposer / hybrid
  pipeline, auto-fetch of aerial/buildings, and 3D props (trees, flagstick, rakes).

## 7. Verification

1. **Clay-avoidance gate (blocks scaling):** render **hole 9** at the play camera; greens + bunkers
   must read as real turf + sand beside a PGA reference and the raw aerial. If any played surface
   looks flat/plastic → fix variation/normals/roughness (or add a bunker micro-depression) **before**
   touching holes 8 & 10. If authored-PBR still can't beat the photo here, fall back to photo-first
   for that surface (the fallback is pre-approved by this gate).
2. **Correctness, per hole:** traced rings overlay correctly on the aerial crop; layout matches the
   course-website reference; `surfaceAt(pin) === 'green'`; tee→pin along the hole line ≈ scorecard
   yardage.
3. **No regressions:** `npm test` stays green (Node ≥ 22); HD bundle still resolves (fingerprint
   unchanged — the override applies after `resolveHdBundle`).

## 8. Risks & open questions

- **PBR-vs-photo (primary risk).** Authored PBR may still read claymier than the photo at our camera
  (memory: photo-first tested better). Mitigated by the §7.1 gate + the pre-approved photo-first
  fallback per surface.
- **Flat-hole bunkers.** No local hollow on 8 & 10 → flat sand. Likely needs the micro-depression
  carve; treat as an expected finding, not a surprise.
- **Chambers Bay feature mix.** Links course: heavy bunkering + sandy waste + fescue, **~no water**,
  one tree. The pilot exercises green/bunker/fairway/rough; water rendering is carried but untested
  here.
- **Trace edge precision.** Vision-traced rings are eyeballed; the overlay verify + reference
  cross-check is the control. Confidence is recorded for a future review pass.
- **Asset sourcing/licensing.** Confirm CC0/public-domain for all PBR maps before committing.

## 9. Tooling to build (light)

- `tools/trace-features.mjs` — given a hole + the live course + aerial: crop the hole region, print
  the exact crop→local transform, accept traced rings, write/merge override entries, and render an
  **overlay-verify** (traced polys drawn back on the aerial crop).
- A PBR material module under `public/render/` (sand / green / fairway), replacing the honeycomb
  sand + flat green patch paths in `scene.js`.
- CC0 PBR texture assets (albedo/normal/roughness/AO) committed to the renderer asset dir.

## 10. Implementation step 0 — converge onto plan4

Before any build work: make plan4's realism commits the base (the override sidecar, aerial drape,
buildings, free-roam camera must be present in the working tree). Mechanic decided at implementation
time depending on whether plan4's worktree is free (merge plan4 → working branch, or re-anchor a
fresh worktree on plan4). This spec + the resulting plan travel with that convergence.

## 11. Start

Hole **9** first (HD anchor): locate via coursepreview, trace green + greenside bunkers + fairway +
pin, override, build the PBR materials, pass the clay gate. If it reads PGA-real, do 8 & 10, then
decide on scaling to 18 via the hybrid pipeline.
