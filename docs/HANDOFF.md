# Open-Birdie — Session Handoff: the "make it look like a real place" arc

**Date:** 2026-06-27 · **Branch:** `claude/hd-discovery-plan4` (base `main` @ `eede37a`)
**Read with:** [`docs/TODO.md`](TODO.md) (live backlog), the `~/.claude` memory files (machine-local),
and the plan summarized in §7 below. This file is the single source of truth for resuming.

> **UPDATE 2026-06-30 — multi-patch HD terrain SHIPPED.** The runtime now renders **every built hole's 1 m
> lidar bundle at once** (was one at a time). `resolveHdBundles` scans the `bundles/` dir; `server.js`
> `activeHd` is an array; `/api/course-geometry` `hd` is an array; the client builds one HD mesh per patch.
> Branch `claude/hd-multipatch-terrain` (off `claude/musing-ritchie-ebb288`), 249 tests green. Only holes 8 & 9
> have bundles so far — batch-build the rest (see TODO + plan
> [`2026-06-30-multipatch-hd-terrain.md`](superpowers/plans/2026-06-30-multipatch-hd-terrain.md)). The old
> per-hole "feature reconstruction" / "PBR pilot" plans are superseded (OSM placement was verified correct;
> the smooth look was low-res base terrain, now fixed by 1 m lidar everywhere).

---

## 0. Resume in 2 minutes

```bash
# from the worktree root
BIRDIE_DATA_DIR=C:/Users/USER/Documents/GitHub/Open-Birdie/data   # the REAL data dir (gitignored, on disk)

# A) Open the app to look at it
#    - Desktop app:  double-click Open-Birdie.bat   (runs `npm start` = electron)
#    - Or browser:   node server.js  then open http://localhost:8222
#    - The course auto-loads the most-recently-cached course on startup.

# B) The verify + render loop I used for every screenshot (headless, scriptable):
#    1. start the server on 8223 (the "open-birdie-verify" launch.json config)
#    2. node .shots/sink.cjs            # tiny capture sink on :9100 (writes .shots/<name>.jpg)
#    3. drive window.__birdie.scene in the page (see §6) -> toDataURL -> POST to the sink -> Read the jpg
```

Tests: `npm test` (202 passing). Node ≥ 22 required (the `node --test` glob is Node ≥21; below that you get a **silent zero-test green**).

---

## 1. TL;DR — where we are

Open-Birdie is a **shipping** open-data golf sim (Electron/Three.js, SSE server, real launch-monitor via Open
Connect, v0.8.0). This arc was about the repeated user feedback that the rendered course **"looks like a course
map printed on paper and glued to a smooth surface"** — i.e. it lacked real 3D.

Three root problems were found and fixed this session:

1. **Flat terrain** → was a **DATA** problem (coarse 3 m grid smoothing all relief), *not* a shader problem.
   Fixed by making the HD compiler resolution-adaptive and building a real **1 m QL1** hole (Chambers Bay #9,
   48 m relief). **QL1 gate PASSED** → the planned "AI hero-authoring" track is **not needed for relief**.
2. **No vertical objects** → added **3D buildings** (OSM footprints extruded, incl. a hero clubhouse).
3. **The "square in the middle"** → the one HD hole was a photographic tile on green felt. Fixed by **draping a
   course-wide real aerial** over the whole course, so everything is the real photo and the HD hole is just a
   sharper-relief region within it.

The app is currently demo-ready on **Chambers Bay** (hole 9 HD + buildings + course aerial).

---

## 2. The journey & key findings (the "why", so you don't re-derive it)

- **"Flat / ink on paper" is a data ceiling, not a shader.** Bandon's only lidar is 2008 3DEP (~3.4 m); features
  < ~6 m smooth away. Proven by building Chambers Bay #9 at **1 m** (real USGS 3DEP QL1): dramatic, legible
  relief returned (32 m tee→green drop, ridges, bowls). See `.shots/chambers-h9-{tee,hero,playerpov}.jpg`.
- **The HD↔coarse "square" was COLOR, not geometry.** Measured the boundary seam at **≤ 0.5 m** (continuous —
  the compiler's `coarseBaseHeight` edge-blend works, and the coarse grid already carries the full 71.9 m course
  relief at 5 m). The tile stood out only because it had the real NAIP photo while the rest was flat green
  procedural turf. → fixed by a course-wide aerial (§4).
- **Geometry grass is the wrong lever** (prior finding, still true): sub-pixel at the elevated orbit camera. The
  realism levers that matter are **terrain data + real aerial albedo + vertical objects**, exactly what shipped.
- **Vegetation/buildings sell "place".** Even with relief, the scene read flat until buildings (hard vertical
  edges + shadows) went in.
- **Compiler was Bandon-only** until this session: generalized to any US course (UTM zones on demand) and any
  resolution (adaptive). Now built across 3 courses / 3 UTM zones / latitudes 30–47°N.

**Honest caveats still open:** (a) the course aerial is uniform ~0.9 m/px, so the HD hole is slightly soft
underfoot (its crisp 0.6 m orthophoto is currently overridden — a two-layer macro would restore it); (b)
buildings are flat-roof massing blocks (pitched roofs would read more real); (c) the two data tools
(`add-buildings`, `add-course-aerial`) are **manual**, not yet wired into the OSM fetch.

---

## 3. What shipped this session (commits on `claude/hd-discovery-plan4`)

| Commit | What |
|---|---|
| `cd10fd3` | free-roam "course creator" camera (drag-orbit/fly) |
| `24ff53d` / `9ccd157` | load-time per-course **surface-override sidecar** (`data/courses/<slug>.surfaces.json`) + its doc |
| `4b3fe30` | make the HD **aerial the ground** (photo-dominant turf), not a faint tint |
| `c61b257` | **HUD hole-number fix** — show the real course `h.ref`, not the play-order index |
| `6c033c1` | meso-relief detail normal; reverted the de-light experiment (it washed the aerial to grey) |
| `5e18b13` | **adaptive terrain resolution** (`manifest.terrain.nativeSpacingM`/`maxPx`) — unblocks 1 m builds |
| `e63355e` | **register UTM zones on demand** — build any US course, not just Bandon (zone 10N) |
| `f501868` | **fix imagery edge-bulge gap** — pad the NAIP read window for the equirect↔UTM curve (hit at 47°N) |
| `3780629` | docs: QL1 gate verdict |
| `06cb6c0` | **3D buildings** (OSM extrude + hero clubhouse) + `Open-Birdie.bat` launcher |
| `ca81041` | **course-wide aerial drape** — kills the HD "square" |

Plus the QL1 build itself: `tools/hd-course/manifests/chambers-bay-hole-09.json` (1 m, fingerprint `92067899…`,
published bundle `516339c7…`).

---

## 4. How the new pieces work (architecture)

### 4a. Course-wide aerial (the "square" fix) — commit `ca81041`
- **Data:** `node tools/add-course-aerial.mjs data/courses/<slug>.json` → fetches ONE USGS NAIP image
  (`USGSNAIPImagery/ImageServer/exportImage`, public domain) for the course bbox, saves
  `data/courses/<slug>.aerial.jpg`, and writes `course.aerial = { file, bounds }` (local-metre bounds).
- **Registration is exact by construction:** the export bbox is the course local bounds converted through the
  *same* origin + equirectangular projection as `parseOsm`, so the image maps 1:1 to local metres.
- **Serve:** `server.js` `courseGeometry()` sends `aerial:{bounds}` (no file path); `/api/course-aerial` serves
  the bytes for the active course.
- **Render:** `scene.js setCourse` builds `this._macro = { albedo: <texture>, coverage: white1×1, bounds, weights }`
  and passes it to `makeTurfMaterial({ macro })`, **preferred over `_hdMacro`**. The existing turf macro shader
  (`turf.js`, `macroBlend`) drapes the aerial across the whole course with edge-feathering. A white 1×1 coverage
  texture = "valid everywhere". (`uMacroSurfaces` is declared but unused in the blend.)
- **Non-fingerprinted:** `course.aerial` is NOT in `canonicalCourse` (hd-bundle.js), like `elevation.patches` /
  `buildings` — attaching it never invalidates an HD bundle.

### 4b. 3D buildings — commit `06cb6c0`
- **Data:** `node tools/add-buildings.mjs data/courses/<slug>.json` → Overpass `way/relation["building"]` in the
  course bbox → `course.buildings = [{ poly, heightM, kind, name, clubhouse }]`. Clubhouse detected by tag/name;
  if none tagged, the largest central building is promoted to hero.
- **Render:** `scene.js _addBuildings` extrudes each footprint (`THREE.ExtrudeGeometry`, two material groups:
  0 = roof/caps, 1 = walls), seated at the **lowest ground under the footprint** (sunk 0.6 m so walls meet
  slopes), `castShadow`. Clubhouse gets a terracotta hero material. Flag `RENDER_CONFIG.buildings`.
- Served via `courseGeometry()` `buildings`. Non-fingerprinted.

### 4c. QL1 / adaptive compiler — commits `5e18b13`, `e63355e`, `f501868`
- `manifest.terrain.nativeSpacingM` + `maxPx` (schema: `build-manifest.schema.json`) let a manifest request 1 m
  lidar + a bigger raster; `cli.mjs liveProviders.acquireElevation` forwards them (defaults 3.4 m / 600 px).
- `coordinates.mjs ensureUtmZone(epsg)` registers any NAD83 (269xx) / WGS84 (326xx) UTM zone on demand.
- `cli.mjs acquireImagery` pads the COG read window ~4 m (the equirect↔UTM edge bulge — the corner-bbox
  under-covers the curved edges; worst at high latitude). The strict `gaps>0` check in `imagery.mjs` is the guard.

---

## 5. Data state on disk (gitignored — lives at `BIRDIE_DATA_DIR`, persists across sessions on this machine)

- `data/courses/chambers-bay.json` — **the demo course**: cached OSM + elevation, **+ 185 buildings + course
  aerial** attached. Fingerprint `92067899…`.
- `data/courses/chambers-bay.aerial.jpg` — the course-wide aerial (1200×2048).
- `data/courses/tpc-sawgrass.json`, `data/courses/bandon-…json` — also cached (no buildings/aerial attached yet).
- `data/hd-courses/chambers-bay/…/516339c7…` — the 1 m HD hole-9 bundle (active.json points at it).
- `data/hd-courses/{bandon,tpc-sawgrass}/…` — earlier HD bundles.

**If the data dir is ever lost,** regenerate (see §6). The repo does not (and should not) commit `data/`.

---

## 6. Operations / how to reproduce

### Cache a course
`BIRDIE_DATA_DIR=… node tools/test-load.js "Chambers Bay"` (fetches OSM + elevation → `data/courses/<slug>.json`).

### Attach buildings + course aerial to a cached course
```bash
node tools/add-buildings.mjs      data/courses/<slug>.json
node tools/add-course-aerial.mjs  data/courses/<slug>.json
```

### Build a 1 m HD hole (the QL1 path)
1. Author/copy a manifest under `tools/hd-course/manifests/<slug>-hole-NN.json` (`targetSpacingM:1`,
   `nativeSpacingM:1`, `maxPx:1200`; pick `1` or `2`, never `1.5` — `snapHdBounds` rounds).
2. `node tools/hd-course/cli.mjs discover --manifest <m> --course data/courses/<slug>.json --write`
3. `node tools/hd-course/cli.mjs build --manifest <m> --course data/courses/<slug>.json`
   (publishes an immutable bundle + writes `data/hd-courses/<slug>/active.json`).

### The render/verify loop (how every `.shots/*.jpg` was made)
1. Server on :8223 (launch.json config `open-birdie-verify`), `node .shots/sink.cjs` on :9100.
2. `POST /api/load-course {cached:"<slug>.json"}`, then `POST /api/next-hole` to reach the HD hole.
3. In the page (`window.__birdie.scene` = `{renderer, scene, camera, hAt(x,y), geo, _macro, free, camMode}`):
   - **`renderer.setSize(W,H,false)` FIRST** — after a headless reload the canvas is 0×0 and `toDataURL` returns
     empty (`data:,`). This bit me; always set the size.
   - set `camMode='free'`, position `camera`, `lookAt`, `renderer.render(scene,camera)`.
   - `domElement.toDataURL('image/jpeg')` → `POST {name,dataURL}` to `http://127.0.0.1:9100` → `Read .shots/<name>.jpg`.
   - sim→three transform: `V(x,y,z) = (x, z, -y)`; ground point local `(x,y,h)` → three `(x, h, -y)`. Heights via
     `scene.hAt(x,y)` (call as a method so `this` binds).

### Gotchas (cost me time — don't repeat)
- **New HD bundle or any `server.js` change ⇒ RESTART the server** (Node, no hot-reload). A same-build course
  swap is fine via `POST /api/load-course`. Client (`scene.js`) changes ⇒ reload the page.
- **Canvas 0×0 after a headless reload** ⇒ `setSize` before `toDataURL` (above).
- **`tools/test-shot.js` is NOT a unit test** — it's a launch-monitor *emulator* that exits 1 with no socket.
  Bare `node --test` sweeps it in and shows a false failure; the real suite is `npm test`
  (`test/*.test.{js,mjs}`).
- `BIRDIE_DATA_DIR` points at the **main repo's** `data/` (absolute), not the worktree's. The launcher run from
  the worktree without it set would use an empty worktree `data/`.

---

## 7. The plan & the gate decision (context for prioritizing next)

Originally a 3-phase plan (full text was in `~/.claude/plans/plan-if-not-have-polished-parasol.md`; captured here):
- **Phase 0 — cheap course-agnostic fidelity levers.** Shipped the ones that helped (hole-number fix, meso-normal);
  the **vertical-exaggeration knob is parked** in `docs/TODO.md` (gameplay-affecting: render-vs-physics slope
  tradeoff). De-light was tried and reverted (washed the aerial grey).
- **Phase 0.5 — adaptive data + a QL1 showcase = THE GATE.** Done. **Verdict: QL1 PASSES** — real 1 m lidar
  fixes the flatness; it was a data problem.
- **Phase 1 — AI hero-course authoring. GATED, and the gate says NOT needed for relief.** Do not build the
  hero-authoring DSL/baker for relief reasons. (The seam already accepts a hand-written elevation patch with zero
  new infra if one bespoke hole is ever wanted.)

**Two `/autoplan` review passes** (CEO/Eng/DX voices; Codex absent) shaped this — they caught the two QL1 build
blockers (schema `additionalProperties:false`; `cli.mjs` not forwarding `maxPx`), both fixed.

### Prioritized backlog (what to do next session)
1. **Pitched/hipped roofs** on buildings (esp. the clubhouse) — highest visual ROI for "looks real" now that
   massing + aerial are in. (`scene.js _addBuildings`.)
2. **Two-layer aerial** — keep the course aerial as the base AND overlay the HD hole's crisp 0.6 m orthophoto as
   an inset (restores underfoot crispness lost in the single-macro approach). Needs a 2nd macro layer in
   `turf.js`.
3. **Auto-fetch buildings + aerial on first course load** — wire `way/relation["building"]` into `lib/course.js`
   `FEATURES` + an aerial fetch in `loadCourse`. **CARE:** compute the proj origin from golf coords only and do
   NOT bump `CACHE_VERSION` — both change `courseFingerprint` and would break existing HD bundles.
4. **Click-to-act interactivity** (the user asked): click a hole/green to jump, click to aim — needs click-on-3D
   raycasting (none today; the app has buttons + the free-cam drag only).
5. **More QL1 holes / courses** to widen the showcase (the build path is proven + cheap now).

---

## 8. File map (the things you'll touch)

- **Render:** `public/render/scene.js` (`setCourse`, `_terrainMesh`, `_addBuildings`, `_macro`/`_hdMacro`, `hAt`) ·
  `public/render/turf.js` (`makeTurfMaterial`, `macroBlend`) · `public/render/config.js` (`RENDER_CONFIG`) ·
  `public/render/hd-terrain.js` · `public/render/drape.js`
- **Server:** `server.js` (`activateCourse`, `courseGeometry`, `/api/course-aerial`, `/api/hd-assets/*`) ·
  `lib/course.js` (OSM fetch/parse, `loadSurfaceOverride`) · `lib/hd-bundle.js` (`resolveHdBundle`,
  `canonicalCourse`/`courseFingerprint`) · `lib/game.js` (`state()`, hole refs)
- **Compiler:** `tools/hd-course/cli.mjs` · `imagery.mjs` · `coordinates.mjs` · `naip.mjs` · `discover.mjs` ·
  `schemas/build-manifest.schema.json` · `manifests/*.json`
- **Tools:** `tools/add-buildings.mjs` · `tools/add-course-aerial.mjs` · `tools/test-load.js` (cache) ·
  `.shots/sink.cjs` (capture sink) · `Open-Birdie.bat` (launcher)
- **Docs/state:** `docs/TODO.md` (live backlog) · `docs/HANDOFF.md` (this) ·
  `docs/surface-override-sidecar.md`
- **Exploratory (uncommitted scratch, kept for reference):** `tools/spike-vision*.mjs`, `tools/spike-segment.mjs`,
  `tools/audit-overlay.mjs` (the "Claude-as-vision-detector" green-localization spike; blocked on no
  `ANTHROPIC_API_KEY` — see the memory note).

---

## 9. Status snapshot

- ✅ QL1 build pipeline (any US course, any resolution), Chambers Bay #9 @ 1 m.
- ✅ 3D buildings + clubhouse. ✅ Course-wide aerial (no more square). ✅ Launcher.
- ✅ 202/202 tests green; all work committed on `claude/hd-discovery-plan4`.
- ⏳ Not merged to `main`. Not yet: pitched roofs, two-layer aerial, auto-fetch pipeline, click-to-act.
- The branch is the unit of work; merge it (or keep iterating) next session.
