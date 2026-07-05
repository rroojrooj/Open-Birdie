# Runtime NDVI Surface Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically classify each course's playing surfaces from infrared imagery at **course-load time, with zero manual steps and zero new runtime deps** — so (1) mown fairway that OSM never mapped gets mow stripes + fairway material, and (2) sand/dune/waste areas OSM never mapped get real tiled sand material — on **every** auto-loaded course, closing the gap the material-first arc left open ("stripes only render where OSM marks fairway, and that coverage is thin").

**Architecture:** Extend the shipped runtime aerial fetch (`lib/aerial.js` — one `exportImage` request, no image deps) to also pull the **NIR band**, decode it with `pngjs` (already a runtime dep), run the **existing pure NDVI classifier** (`tools/trace/segment.mjs`), and bake a small course-wide **class map** (RGBA PNG) attached as `course.aerial.classFile` (non-fingerprinted scenery, like the aerial itself). The renderer loads it into the already-bound-but-never-sampled `uMacroSurfaces` uniform; the turf shader **unions** its channels with the existing OSM masks (`uMask.r` mown, `uBunker.r` sand). NDVI only ever *adds* coverage OSM missed — OSM stays authoritative where present, and greens stay 100% OSM-driven (precision-critical). Two mandatory safeguards prevent the known failure mode (dry links fairway fescue reads bright + low-NDVI = "sand"): **NDVI sand is suppressed wherever OSM marks mown**, and a **coverage-sanity abort** refuses an implausible classmap (falls back to OSM-only).

**Tech Stack:** Node runtime (CommonJS in `lib/`), `pngjs ^7` (already a dependency — the ONLY decode path; `sharp`/`geotiff` are dev-only and MUST NOT be imported at runtime), the pure ESM classifier `tools/trace/segment.mjs` (imported into a runtime-safe CommonJS twin or via dynamic import), Three.js `onBeforeCompile` shader injection (existing `turf.js` pattern), `node:test` (Node ≥ 22 — below 21 the glob silently runs zero tests).

---

## Why (grounded in current code — don't re-derive)

- The material-first arc (PR #29, shipped 2026-07-05) demoted the aerial to a tint + far-field layer and made per-surface materials gate off **client-painted OSM masks** (`scene.js` `_paintMask` → `uMask.r` mown, `uMask.g` green, `uBunker.r` sand). Two adversarial QA rounds (6→7/10) found the remaining "groomed" gap is **DATA, not shader**: mow stripes only render where OSM marks fairway, and OSM coverage is thin (Chambers h9 fairway mask ≈ 0.22 at the centroid). Verified live.
- `tools/trace/segment.mjs` already computes NDVI + texture and classifies each pixel `sand | water | green | fairway | rough` — pure, dependency-free, tested. `classifyPixel` returns `fairway` for mid-NDVI + mid-texture (mown) and `sand` for low-NDVI + bright. This is exactly the mown-and-sand detection the gap needs.
- `pngjs ^7.0.0` is a **runtime** dependency (`package.json`); `sharp`/`geotiff` are dev-only. So a runtime classifier can decode a band-selected NAIP PNG with pngjs and reuse `segment.mjs` — no new deps, honoring the zero-runtime-dep rule that killed the earlier dev-tool approach.
- `lib/aerial.js` already fetches a course-wide NAIP image at load time via one `exportImage` request (`format=jpgpng&f=image`), best-effort, attaching `course.aerial = { file, bounds }`. This is the exact seam + failure posture to extend.
- `uMacroSurfaces` is declared and bound (`turf.js:73,122`) to a black 1×1 texture (`scene.js:328`) but **never sampled** — reserved for exactly this. Feeding it needs a shader consumer.

## Non-negotiable invariants (repo conventions that bite)

1. **Zero new runtime deps.** `pngjs` only. Any `require('sharp')` / `require('geotiff')` in a `lib/` path is a hard reject — those are dev-only and break the packaged Electron app. (This is why the CEO review killed the dev-tool classmap; do not resurrect it.)
2. **Auto on load, best-effort, graceful.** The classmap is fetched/built inside `loadCourse` alongside the aerial. ANY failure (NIR unavailable, decode error, sanity abort) → no classmap → today's OSM-mask-only behavior. It must NEVER break course load or block on the network.
3. **Fingerprint safety.** `course.aerial.classFile` is non-fingerprinted scenery (inside `course.aerial`, already excluded from `canonicalCourse` in `lib/hd-bundle.js`). Do NOT touch `canonicalCourse`, `CACHE_VERSION`, or the projection origin.
4. **OSM stays authoritative; NDVI only adds.** The shader UNIONs (max) NDVI channels with OSM masks — never replaces. Greens are NOT NDVI-driven (they need OSM precision; a mislabeled green is very visible).
5. **`customProgramCacheKey` must bump** (`turf-grain-v26` → `v27`) whenever the injected shader text changes, or three.js reuses a stale program.
6. **GTAO recompile trap** (`config.js` `gtao:true`): every new texture sample must sit inside the `#ifdef USE_MAP` block (the existing injections show the pattern). Verify no black turf with `gtao:true` after any shader change.
7. **Registration is exact by construction:** the classmap shares the aerial's bounds + projection (same `exportImage` bbox), so it maps 1:1 to local metres like the aerial. Never introduce a separate transform.

## The two mandatory safeguards (from the CEO review — do not skip)

- **S1 — NDVI sand only OUTSIDE OSM mown polys.** Bright + low-NDVI is *exactly* dry links fairway fescue (Chambers Bay's tan-gold fairways); without this, they classify as sand and get tiled sand material on the fairway. Implement at **classmap-build time**: rasterize the OSM mown polygons and zero the sand channel wherever mown. (In-shader `surfaces.b * (1 - uMask.r)` is a second line of defense but the build-time removal is primary — it also keeps the sanity metric honest.)
- **S2 — coverage-sanity abort.** After classification, if sand exceeds a plausible fraction of the classified course (default > 35%) OR mown exceeds (> 80%), the capture/threshold is suspect → **refuse the classmap**, log the percentages, fall back to OSM-only. A broken NIR band or a snow/cloud capture must degrade loudly, not paint the whole course.

## The verify loop (Tasks 6–7) — reuse the material-first harness

`.shots/NOTES.md` documents it. Server = launch.json `open-birdie-verify` (:8223) with `BIRDIE_DATA_DIR` = main repo data; `node .shots/sink.cjs` (:9100). In the page: `S.renderer.setSize(1600,900,false)` **and** `S.postfx.setSize(1600,900)` (composer targets, or frames are black), render via **`S.postfx.render()`** (GTAO/grade/SMAA are composer-only), wait ~2.5–3 s for texture decode. Two-course rule: chambers-bay (links) + tpc-sawgrass (parkland). Never claim a visual result without a captured frame.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/ndvi-fetch.js` *(new)* | Runtime-safe: fetch a band-selected NAIP PNG (NIR+R+G) over the course bbox via one `exportImage` request; decode with `pngjs`; return `{ nir, r, g, width, height }` typed arrays. No image deps beyond pngjs. Best-effort → null on any failure. |
| `lib/classify-surfaces.js` *(new)* | Runtime-safe pure-ish core: given the band arrays + OSM surfaces + bounds, run `segment.mjs` math, apply S1 (mask out mown from sand), compute S2 coverage stats, and emit an RGBA classmap buffer (R=NDVI-mown, B=NDVI-sand) + a stats object. Encodes to PNG via `pngjs`. Returns null on sanity abort. |
| `lib/course.js` *(modify)* | In `loadCourse`, after the aerial attaches, best-effort build the classmap and set `course.aerial.classFile` + `course.aerial.classStats`. Guarded; never throws. |
| `server.js` *(modify)* | `/api/course-classmap` route (mirror `/api/course-aerial`); `courseGeometry()` aerial payload gains `classes: !!classFile`. |
| `public/render/scene.js` *(modify)* | When `geo.aerial.classes`, load `/api/course-classmap` into `_macro.surfaces` (replacing the black default); dispose on reload. |
| `public/render/turf.js` *(modify)* | Sample `uMacroSurfaces` in the map_fragment block: union R into the mown gate (`m`), union B into the sand gate (`bm`) with the in-shader S1 backstop; cache key v27. |
| `tools/trace/segment.mjs` *(reuse, maybe extract)* | The NDVI classifier. If a runtime CommonJS import is awkward (it's ESM), extract the 4 pure functions into `lib/segment-core.js` (CommonJS) and have the ESM file re-export them, so both dev tools and runtime share one source. |
| `test/ndvi-fetch.test.js`, `test/classify-surfaces.test.js` *(new)* | TDD the band-URL construction, the S1 mask-out, the S2 abort thresholds, the classmap encoding. |
| `test/hd-turf.test.mjs` *(modify)* | Extend: v27 cache key, `uMacroSurfaces` now sampled, union assertions. |
| `docs/HANDOFF.md`, `docs/TODO.md` *(modify)* | Outcome + how it works; close the "sparse stripes" gap. |

**Not modified:** `canonicalCourse`/fingerprint anything; the dev-only COG tools (`tools/hd-course/*`, `tools/add-course-aerial.mjs`); greens' OSM path.

---

### Task 0: DE-RISK — prove NIR retrieval from the runtime endpoint (spike first, it's the one external unknown)

**Files:** scratch only (`.shots/` or scratchpad); no committed code yet.

The whole plan rests on getting an NIR band from the same public endpoint `lib/aerial.js` uses, with only `pngjs` to decode. This is the single unproven external dependency — prove it before building.

- [ ] **Step 1:** Against the live USGS NAIPPlus ImageServer, request a small window of a known course with band selection. Try, in order, until one returns usable NIR:
  - (a) `exportImage` with `&bandIds=3,0,1` (NIR,R,G) `&format=png&f=image` → a 3-channel PNG whose R=NIR, G=R, B=G. Decode with pngjs; sanity-check that NDVI = (ch0−ch1)/(ch0+ch1) separates known vegetation (fairway) from known sand (a bunker) on Chambers Bay.
  - (b) if bandIds is ignored, `&renderingRule={"rasterFunction":"NDVI"}` (server-side NDVI) → single-band NDVI image.
  - (c) if neither, the `USGSNAIPImagery` (not Plus) ImageServer `exportImage` with `bandIds`.
- [ ] **Step 2:** Record which variant works, the exact URL, and 2–3 probe NDVI values (fairway vs sand vs green) proving separation. Write the finding into this plan's Task 1 (replace the placeholder URL) before writing any `lib/` code.
- [ ] **Step 2b (S2 CALIBRATION — eng-review finding 3, user-approved):** while the NIR is in hand, run `segmentWindow` over BOTH test courses (chambers-bay + tpc-sawgrass) at the pinned classify size (Task 1) and print the actual `sandPct` / `mownPct` **measured INSIDE the course boundary** (not the padded aerial window — that includes Puget Sound + parking lots and would inflate sand). Chambers Bay is a former sand-and-gravel mine with vast waste/dune expanses and bright dry-fescue that `classifyPixel` (`segment.mjs:17`, `nd<0.05 && brightness>145`) tags as sand — the naive 35% threshold would very plausibly **false-abort on the flagship course** and silently no-op the whole feature. Set the S2 thresholds (Task 2) from these real numbers with headroom (e.g. `max(measured_chambers_sand, measured_saw_sand) × 1.4`), so a genuinely-broken capture still trips but a legitimately-sandy links course does not. Record the numbers here.
- [ ] **Step 3:** **GATE — this is a standalone spike; run it to a go/no-go BEFORE any `lib/` scaffolding** (eng-review finding 6: Tasks 1–5 have zero value if Task 0 fails, so it's spike-to-throwaway, not an increment). If NO variant yields usable NIR from a no-dep endpoint, STOP and surface to the user. **Pre-approved plan-B (decide with the user at the gate, not after):** a server-side dev precompute (the CEO review disfavored it, but it beats a dead end) — so a Task-0 failure routes to a known fallback, not a rethink from scratch. Do not proceed to Task 1 on hope.

### Task 1: `lib/ndvi-fetch.js` — band-selected NAIP fetch + pngjs decode (TDD)

**Files:** Create `lib/ndvi-fetch.js`; Test `test/ndvi-fetch.test.js`.

Mirror `lib/aerial.js` shape (same bbox math, `fetchImpl` injectable for headless test, best-effort → null). The URL uses the Task-0-proven band variant. Decode the PNG with `pngjs` into per-band `Uint8ClampedArray`s.

> **PIN THE RASTER SIZE — P1 (eng-review findings 1+2).** `lib/aerial.js` defaults `maxPx=4000`; feeding a 2462×4000 window to `segmentWindow` is **~1265 ms of synchronous single-threaded CPU + a ~9.8M-string allocation** (benchmarked) on the cache-miss load path. The classmap only gates surface *material* at the orbit camera — sub-metre precision is wasted. Use a **dedicated `NDVI_MAXPX = 768`** (benchmarks: 1000² ≈ 133 ms, 600² ≈ 48 ms), **independent of the aerial's 4000**. Do NOT reuse the aerial's size. At 768² the whole classify (segment + S1 raster + S2 + encode) is well under ~100 ms — a one-time cost on first-ever load of a course (cache-miss only, Task 3), consistent with the aerial fetch that already blocks there, so it runs **inline** (no fire-and-forget complexity — P5 explicit-over-clever). Document the added one-time miss-path cost in Task 3.

- [ ] **Step 1: Failing test** (CommonJS, mirror `test/aerial.test.js`): assert the request URL carries the proven band selection + the course bbox + `imageSR=4326` + `size` capped at `NDVI_MAXPX`; assert null on non-ok / tiny-body / throw (the three `aerial.test.js` cases). **Real-PNG decode test (eng-review finding 10):** a `fakeJpeg()` buffer will NOT exercise the pngjs decode — commit a tiny real 3-band PNG fixture (generate 8×8 once with `PNG.sync.write` in the test setup) and assert it decodes to `{ nir, r, g, width, height }` with the right channel order + length. The channel split (order, `colorType`, alpha strip) is the part most likely to be wrong and must be asserted on real bytes.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `fetchNdviBands({ origin, bounds, fetchImpl = fetch, gsdM, maxPx = NDVI_MAXPX })` → decode via `PNG.sync.read` (sync is fine at this size). Guard body like `lib/aerial.js` (magic bytes, 2 KB floor). **Step 4:** Run → PASS. **Step 5:** commit.

### Task 2: `lib/classify-surfaces.js` — classify + S1 + S2 + encode (TDD)

**Files:** Create `lib/classify-surfaces.js`; possibly extract `lib/segment-core.js`; Test `test/classify-surfaces.test.js`.

Pure core: `classifyToClassmap({ bands, width, height, bounds, boundary, surfaces, thresholds })` →
1. run `segmentWindow` (from segment core) → per-pixel class;
2. rasterize OSM mown polys (fairway/tee/green) to a mown mask at the classmap resolution — **Node-side, NOT `scene.js _paintMask` (eng-review finding 9): that uses browser canvas `fill()`, unavailable in `lib/`.** Write a fresh scanline / per-pixel `pointInPoly` loop (the `pointInPoly` in `course.js:403` is Node-safe; the projected polys live on `course.surfaces` in local metres — use `bounds`→px, not lat/lon). At `NDVI_MAXPX=768` a per-pixel point-in-poly over the mown polys is cheap;
3. **S1:** zero the sand class wherever mown;
4. **S2:** compute `sandPct`/`mownPct` **over pixels INSIDE `boundary` only** (eng-review finding 3 — the padded window includes sea/parking and inflates sand); abort if they exceed the **Task-0-calibrated** `thresholds` (NOT the guessed 0.35/0.80 — those false-abort on Chambers; see Task 0 Step 2b) → return `{ classmap: null, stats, aborted: true }`;
5. encode RGBA (R = 255·mown-detected, B = 255·sand-detected, G/A = 0) to a PNG buffer via pngjs;
6. return `{ pngBuffer, stats }`.

- [ ] **Step 1: Failing tests:** (a) a synthetic sand pixel INSIDE an OSM mown poly → sand channel 0 (S1); (b) a field of sand pixels above the threshold → `aborted:true`, null classmap (S2); (c) a mown-NDVI pixel outside OSM polys → mown channel 255 (the coverage-add that fixes sparse stripes); (d) encoded PNG round-trips to the expected channels; (e) sand OUTSIDE the boundary is excluded from the S2 percentage.
- [ ] **Steps 2–4:** **Extract the segment core to `lib/segment-core.js` (CommonJS)** — commit to this option (eng-review finding 8; the async `import()`-of-ESM alternative would force `classifyToClassmap` async and ripple into `loadCourse`). **`tools/trace/segment.mjs` becomes a one-line ESM shim that re-exports ALL FIVE names** so `test/segment.test.mjs` (which imports `ndvi, classifyPixel, maskOf, segmentWindow` — eng-review finding 7 corrected the plan's "imported by nothing") stays green: `export { ndvi, classifyPixel, textureStd, segmentWindow, maskOf } from '../../lib/segment-core.js';` (verify Node-22 CJS→ESM named interop resolves before relying on it). Implement, run `npm test` → segment.test.mjs still green + new suite PASS. **Step 5:** commit.

### Task 3: wire into `loadCourse` (auto, best-effort)

**Files:** Modify `lib/course.js` (immediately after the `fetchCourseAerial` block ~184-192).

- [ ] **Step 1:** **Placement is load-bearing (eng-review finding, cache-once pattern):** put this immediately after the aerial `try/catch`, which lives in the **cache-MISS path** (the cache-HIT path returns early with the persisted `course.aerial`, so this never re-runs — the classmap is computed ONCE per course, ever, and persisted in the course JSON, exactly like the aerial). Do NOT put it in `scene.js` or any per-load path. Best-effort, only if `course.aerial` exists: `fetchNdviBands` → `classifyToClassmap` (passing `course.boundary` for the S2 inside-boundary stat + the Task-0 thresholds) → if a classmap returned, write `<slug>.classmap.png` and set `course.aerial.classFile` + `course.aerial.classBounds` (= the aerial bounds it was built against — the **staleness key**, eng-review finding 5) + `course.aerial.classStats`. Wrap in try/catch; log `[classify] slug: mown X% sand Y%` or `[classify] skipped: <reason>`. Never throw. It adds one NIR fetch + ~<100 ms CPU (Task 1 pinned size) to the **first-ever** load of a course only — the aerial fetch already blocks there, so this is consistent, inline, and documented.
- [ ] **Step 2:** Test (extend `test/aerial.test.js`-style with a stubbed fetch): course gets `classFile` + `classBounds` on success; no `classFile` and course still loads on fetch-null / abort. **Step 3:** commit.

### Task 4: serve + load (server + scene)

**Files:** Modify `server.js`, `public/render/scene.js`.

- [ ] **Step 1:** `/api/course-classmap` route (mirror `/api/course-aerial`, `path.basename` guard). **Content-Type must be `image/png`** — the file is `<slug>.classmap.png`; the aerial route branches `.png`-vs-`.jpg`, so key the classmap route's content-type on `.png` explicitly (no `.endsWith('.jpg')` fallthrough). **Staleness guard (eng-review finding 5):** `courseGeometry()` advertises `classes` only when the classmap is fresh — `classes: !!(course.aerial && course.aerial.classFile && sameBounds(course.aerial.classBounds, course.aerial.bounds))`. A manual aerial swap (the tiled 0.3 m dev aerial can replace the runtime one) changes `aerial.bounds` without regenerating the classmap; without this guard the classmap would sample at `mUv` derived from the NEW bounds while its pixels correspond to the OLD → silently mis-registered surfaces. Mismatch → don't advertise `classes` → OSM-only (safe). Also note in HANDOFF: a manual aerial swap requires deleting `<slug>.classmap.png`.
- [ ] **Step 2:** In `scene.js` aerial branch, when `geo.aerial.classes`, `TextureLoader.load('/api/course-classmap')` into `this._macro.surfaces` (replacing `_blackTex`), `NoColorSpace`, clamp wrap, with an `onError` console warn (a 404/decode-fail leaves it black = OSM-only, graceful by construction — the incomplete texture samples black). Dispose with the other macro textures on reload.
- [ ] **Step 3:** Verify with `curl` (200 + png where a classmap exists, 404 else) + `courseGeometry` `classes` flag. **Step 4:** commit.

### Task 5: shader consumer — union NDVI into the gates (v27)

**Files:** Modify `public/render/turf.js`; Test `test/hd-turf.test.mjs`.

- [ ] **Step 1: Failing test:** bump keys to `v27`/`v27-macro`; assert `uMacroSurfaces` is now SAMPLED (`texture2D(uMacroSurfaces`), and the mown/sand gates union it.
- [ ] **Step 2:** FAIL. **Step 3:** UNION (never replace), with placement that is load-bearing:
  - **CRITICAL — sample at `mUv` (aerial-bounds space), NOT `vMapUv` (terrain-bounds space).** The classmap shares the AERIAL bounds (`uMacroMin`/`uMacroSize`); aerial bounds = `courseBounds ± 60 m`, terrain bounds = elevation/surface extent `± 80 m` — they DIFFER, so reusing `vMapUv` mis-registers. Compute `vec2 clsUv = (uCourseMin + vMapUv*uExt - uMacroMin) / uMacroSize;` and sample there.
  - **CRITICAL — widen the mown gate `m` EARLY, right after `float g = mk.g;` (turf.js:156), BEFORE the stripe block (turf.js:197) and the fairway/green treatment.** The whole point of this arc is stripes on NDVI-detected fairway; the stripe multiply keys off `m`, so if the union happens in the LATE `macroBlend` tint block (turf.js:~223) the stripes never see it and **the feature silently no-ops** (eng-review finding 4). So: at line ~156 inject `vec4 cls = (clsUv in [0,1]²) ? texture2D(uMacroSurfaces, clsUv) : vec4(0.0); m = max(m, cls.r);` — now the widened `m` flows into stripes + fairway grain.
  - sand: `bm = max(bm, cls.b * (1.0 - m))` at the sand line (turf.js:~230, where `bm` is defined). `m` here is POST-union → "no sand where OSM-mown OR NDVI-mown" (deliberately stronger than build-time S1; a pixel both mown and sand resolves to mown — safe). Routes to the existing tiled sand path.
  - The black 1×1 default (`scene.js` `_blackTex`) makes `cls.r=cls.b=0` → the union is a clean no-op on courses with no classmap. Keep all samples inside `#ifdef USE_MAP`. Bump cache key. **Step 4:** PASS.
- [ ] **Step 5: Visual gate (two-course rule) — the acceptance test IS the feature's goal (eng-review finding 4):** on Chambers h9, capture a fairway stretch OSM never mapped and **confirm mow stripes now appear there** (not just that sand is suppressed — the stripe-on-NDVI-fairway is the primary deliverable; if it's absent, the union landed after the stripe block). Also: dunes show sand material; no fairway-as-sand (S1 holds); no black turf with `gtao:true`; greens unchanged. Repeat on tpc-sawgrass. **Step 6:** commit.

### Task 6: docs + final verification

- [ ] `npm test` green (Node ≥ 22; new ndvi-fetch + classify + v27 turf suites). Final BEFORE/AFTER captures (4 cams × 2 courses). HANDOFF + TODO: close the "sparse stripes" gap, document the auto-classify pipeline + the two safeguards + the Task-0 NIR variant. Commit.

---

## Verification (definition of done)

- `npm test` green; new suites cover the band URL, S1 mask-out, S2 abort, PNG round-trip, v27 shader union.
- On Chambers Bay: fairway areas OSM never mapped now show mow stripes/fairway material; dune/waste shows tiled sand — **with dry fairway fescue NOT classified as sand** (S1 verified in a capture).
- On tpc-sawgrass: same, and a snow/cloud/bad-NIR simulation triggers S2 abort → graceful OSM-only.
- A course with no aerial (non-US) and a course whose NIR fetch fails both render exactly as today (OSM-only). `gtao:true` clean. Greens visually unchanged.

## Failure modes (per new codepath)

| Codepath | Failure | Test? | Handling | Visible? |
|---|---|---|---|---|
| ndvi-fetch | NIR band unavailable / endpoint change | Task 0 gate + unit | best-effort → null → OSM-only | none |
| ndvi-fetch | non-image / truncated body | YES | magic-byte + floor guard → null | none |
| classify (S1) | dry fescue fairway → sand | YES | mown-mask subtract (build) + shader backstop | capture |
| classify (S2) | bad capture paints whole course | YES | coverage abort → null + log | none (OSM-only) |
| loadCourse | classify throws | YES | try/catch → no classFile | log only |
| **classify perf** | full-res raster → ~1.3 s load stall | benchmarked | pinned `NDVI_MAXPX=768` (<100 ms), cache-miss-only | none |
| **S2 miscalibration** | flat 35% aborts on links waste (Chambers) | Task 0 measures both courses | thresholds set from real data, inside-boundary stat | none (feature would silently no-op) |
| **classmap staleness** | manual aerial swap → mis-registered classmap | n/a | `classBounds` vs `aerial.bounds` guard drops it | capture (shifted surfaces) |
| **shader union placement** | mown union after stripe block → no stripes | visual gate asserts stripes-on-NDVI-fairway | union `m` early (before stripes) | capture (the goal itself) |
| classmap route | missing / traversal | manual | `path.basename`, 404 | none |
| shader | uMacroSurfaces black default | n/a | union with 0 = no-op = OSM-only | none |
| GTAO recompile | vMapUv unguarded → black turf | manual gate | samples inside `#ifdef USE_MAP` | capture |
| stale program | cache key not bumped | YES | v27 bump | — |

## What already exists (reused, not rebuilt)

- Runtime no-dep image fetch + best-effort posture: `lib/aerial.js`. Pure NDVI classifier math: `tools/trace/segment.mjs` (→ extracted to `lib/segment-core.js`, CJS). `pngjs` runtime decode. The bound-but-unused `uMacroSurfaces` uniform + the tint `mUv` mapping (registration for free). OSM point-in-poly: `course.js:403` `pointInPoly` (Node-safe — NOT `scene.js _paintMask`, which is browser canvas). Serving/attachment: `/api/course-aerial` + non-fingerprinted `course.aerial`.

## NOT in scope (deferred, with rationale)

- **NDVI-driven greens** — greens need OSM precision; a mislabeled green is glaring. Stays OSM-only.
- **Water classification** — water renders as its own meshes; NDVI water isn't a ground class.
- **Per-hole / sub-course resolution, temporal (multi-date) compositing, cloud masking** — v1 is one course-wide capture with the S2 sanity gate; refine only if captures demand it.
- **Bunker-lip geometry, cart paths, mid-frequency detail** — separate "ground furniture" track.

## Parallelization

- **Lane A (data/runtime):** Task 1 → 2 → 3 (sequential, shared `lib/`), gated on Task 0.
- **Lane B (render):** Task 5 shader can be drafted against a hand-made fixture classmap in parallel, but its visual gate needs Lane A + Task 4. Task 4 bridges. Practically near-sequential; Task 0 is the hard gate for everything.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Plan-document review | writing-plans reviewer | Completeness vs. the real code | 1 | CLEAR | 3 advisories folded (mUv-not-vMapUv; `.png` content-type; post-union `m`). ⚠️ Its bonus claim "`segment.mjs` imported by nothing" was **wrong** — corrected by the eng review (finding 7). |
| Eng Review | `/plan-eng-review` | Architecture, tests, performance (required) | 1 | **CLEAR — 10 findings, all folded** | 3 P1 (all one root cause: classmap raster never pinned → ~1.3 s synchronous stall on first load → **pinned `NDVI_MAXPX=768`, inline cache-miss-only**; S2 abort uncalibrated → **would false-abort on Chambers' waste → calibrate from Task-0 data, inside-boundary stat**). P2: shader union must widen `m` **before** the stripe block or stripes-on-NDVI-fairway silently no-ops (the feature's own goal); classmap↔aerial staleness guard; Task-0 as standalone spike with pre-approved plan-B. P3: corrected the "imported by nothing" error (`test/segment.test.mjs` depends on it — extraction must preserve all 5 exports); commit to CJS-core extraction w/ exact shim; Node-side rasterizer (no browser canvas); real PNG fixture for the decode test. |
| Eng outside voice | independent subagent (Codex absent) | Adversarial 2nd opinion | 1 | issues_found → all folded | Benchmarked the raster stall (1265 ms @ 4000px, 48 ms @ 600px); confirmed the S2/Chambers landmine against `classifyPixel`; caught the stripe-union placement + the plan's factual error. |

- **VERDICT:** ENG CLEARED (via `/plan-eng-review`) — 10 findings folded, 1 user decision resolved (S2 = calibrate from Task-0 data). Ready to implement; **Task 0 (NIR-retrieval spike + S2 calibration) is the hard go/no-go gate before any `lib/` code.** `/autoplan` CEO pass optional (this is architecture-heavy, not strategy-heavy; the eng gauntlet is the load-bearing one and it ran).

NO UNRESOLVED DECISIONS
