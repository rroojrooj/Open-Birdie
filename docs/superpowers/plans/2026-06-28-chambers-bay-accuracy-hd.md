# Plan: Chambers Bay — Feature Accuracy + HD Surface

**Branch:** claude/nostalgic-boyd-ef6b59
**Date:** 2026-06-28
**Status:** REVIEWED + APPROVED (direction: HD-first, verify, simplest feature fix)
**Review:** /autoplan, 2 independent Claude voices (CEO + Eng), full code-grounded. Codex unavailable (not installed).

## Problem

Chambers Bay renders with (1) bunker/green/water positions that don't match the real course, and (2) a playing surface that isn't HD.

## What the review changed (important)

The original plan (vision-traced override + "modify lidar for HD") was half-redundant and half-broken. Corrected understanding:

- **HD is config, not code.** `lib/lidar.js fetchPatchStrict` already defaults `targetM=1`; `tools/hd-course/three-dep.mjs` already throws `HD_3DEP_COARSE` if the server returns coarser than native. The lever is the **manifest** `targetSpacingM` (Bandon pins `3`). "Un-mute the aerial" = two config numbers (`RENDER_CONFIG.hdMacroCloseWeight`/`hdMacroFarWeight`, currently 0.25/0.6), not a `turf.js` shader edit. Mowing stripes already ship (`turf.js:146`). **No `lib/lidar.js` change needed.**
- **`maxPx=600` silently caps resolution** on long holes (`lib/lidar.js:39`): a ~700 m hole at `targetM=1` clamps to ~1.17 m. Must pass a higher `maxPx` for 1 m.
- **3DEP `exportImage` resamples** — asking for 1 m pixels does NOT prove the source is QL1 1 m (it will upsample). Verify native resolution out-of-band (the prior QL1 spike: CB h9 = real 1 m is the evidence); record `nativeSpacingM` in provenance.
- **CRITICAL — fingerprint coupling.** `resolveHdBundle` (`lib/hd-bundle.js:303`) only loads a bundle whose `courseFingerprint` matches, and the fingerprint hashes `surfaces` + `holes{tee,pin,line,par,lengthYd}` (`tools/hd-course/course-source.mjs`). So any feature override that rewrites those fields **silently invalidates every HD bundle** → hole drops to coarse. Override + HD coexist ONLY if you: author override → merge into the cached course → re-fingerprint once → recompile bundles against the merged course. Single source of truth for both runtime and compiler.
- **The vision spike does not exist on this branch** (`spike-vision-detect.mjs` absent) and its accuracy was never measured (blocked on API key). So vision-tracing is unproven, not "extend the spike."
- **Premise unverified.** No Chambers Bay course is cached (`data/courses/` empty). We have NOT confirmed OSM is the cause; some mismatch is our own pin-snap heuristic (`lib/course.js:309`) + tee inference (`:305`), not OSM.
- **Bundle size is driven by the 0.3 m imagery, not terrain.** Terrain at 1 m ≈ 2–9 MB/hole; imagery ≈ 5–15 MB. Perf risk is low (one mesh, one draw). Vertex cost is ~25× the 5 m coarse grid (not the "9×" originally stated), still fine for 3 holes.

## Approved approach — 3 phases

### Phase 1 — Ship the HD half (nearly free, higher value, no vision risk)

1. **Cache Chambers Bay once.** Load via the existing name→Nominatim→Overpass path so `data/courses/<cb-slug>.json` exists (holes, origin, OSM surfaces). This also gives us the artifact to inspect in Phase 2.
2. **Author manifests** `tools/hd-course/manifests/chambers-bay-hole-{01,15,18}.json`: `targetSpacingM: 1`, `nativeSpacingM: 1`, NAIP `gsdM: 0.3`, and a `maxPx` high enough that `widthMeters/1` is not clamped (per-hole; CB holes are long). Consider tightening `padding` (Bandon used 150 m) to keep imagery pixel count sane.
3. **Compile** via `tools/hd-course/compiler.mjs` (discover → build). Confirm provenance records true `nativeSpacingM≈1` (out-of-band check, not just output spacing).
4. **Un-mute the surface:** raise `hdMacroCloseWeight` (0.25 → ~0.5–0.6) and/or lower the procedural grain that masks detail. Note: this improves TEXTURE realism only, inside the HD rect; it does NOT fix feature position.
5. **Verify at the real orbit camera:** before/after screenshot on the hilliest signature hole (15 or 18). Check frame rate. Confirm bundle < 150 MB (watch imagery pixels).

**Phase-1 exit:** HD relief + crisp aerial visibly improve CB. This may close most of the *perceived* gap on its own.

### Phase 2 — Verify what's actually wrong (cheap, before any feature work)

1. With CB cached + the 0.3 m aerial in hand, render an **overlay** (OSM surfaces vs aerial) for a few holes.
2. **Classify each wrong feature by cause:** OSM polygon offset vs our pin-snap heuristic (`lib/course.js:309`) vs tee inference (`:305`). Decide whether OSM is actually the dominant error.

**Phase-2 exit:** a one-page verdict on what's wrong and which fix is cheapest.

### Phase 3 — Cheapest feature fix that works (chosen after Phase 2)

Likely one of:
- **Fix the systemic pin/tee heuristic** in `parseOsm` — fixes EVERY course at once, no per-course content. Preferred if pin/tee inference is the dominant error.
- **Hand-digitize the few visibly-wrong CB features** directly into an override (click points on the geo-registered aerial → local meters via `wgs84ToLocal`). 100% reliable for one course, no model/key/accuracy-gate.

**If an override is built, these constraints are mandatory** (from the review):
- Merge into the cached course → re-fingerprint → recompile (fingerprint coupling).
- Author/merge in the **course's** origin (the OSM centroid), not the override's; reproject if they differ.
- `mergeOverride` must re-derive: re-snap pin to the (new) green, recompute `line`/`lengthYd`/`par`, assert `pointInPoly(pin, green)` and `tee===line[0]`.
- Surfaces have **no hole-key** in the base schema (`{kind,poly}` only) — match by spatial overlap, not `(hole,kind)`.
- Validation: compare scorecard yardage to `polylineLen(line)` (NOT straight-line tee→pin — doglegs would false-positive).
- Canonicalize override polygons (fixed winding + start vertex) so re-edits are deterministic and don't churn the fingerprint.
- Validity check on traced polys (≥3 pts, no self-intersection) before `buildWater` triangulation.

## Deferred (TODOS)

- **Vision-tracing pipeline** — revisit only when (a) going many-courses AND (b) a spike yields a measured sub-~8 m boundary accuracy on representative (non-links) courses. Until then it's the most complex path on an unproven core.
- Remaining 15 holes HD; auto-fetch-on-load; other courses; interactive trace-correction UI.

## Out of scope
- Editing OSM upstream.

## Success criteria
- **Phase 1:** before/after orbit-cam screenshot shows visibly sharper relief + surface on CB; acceptable frame rate; bundle < 150 MB; provenance confirms native ~1 m.
- **Phase 3:** features visibly align with the aerial; pin sits on the green; yardage (along `line`) within ~5% of scorecard.

## Files (Phase 1)
- new `tools/hd-course/manifests/chambers-bay-hole-{01,15,18}.json`
- `data/courses/<cb-slug>.json` (cached, generated)
- `public/render/config.js` (aerial blend defaults) — verify exact symbol
- (Phase 3, if override) `lib/course.js` `mergeOverride` + `data/courses/<cb>.override.json`

## Decision audit (autoplan)
- Method (D1): user chose vision-traced override → **revised at gate** to HD-first/verify/simplest-fix (User Challenge: both voices recommended against vision-first; user accepted the change).
- HD scope: signature holes 1/15/18 first (cost/perf de-risk). Confirmed.
- Review status: 3 critical + several high findings, all resolved by the reshaped direction (deferred vision; documented fingerprint/origin/derivation constraints for any future override).
