<!-- /autoplan restore point: ~/.gstack/projects/rroojrooj-Open-Birdie/claude-fervent-hermann-266eed-autoplan-restore-20260704-043008.md -->
# Material-First Ground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop rendering the course as "a satellite photo painted on terrain": demote the aerial from *albedo* (today it replaces the lit turf at 90–99% weight) to two supporting roles — a **low-frequency color tint** over the existing PBR turf and a **true-far-field layer** — while per-surface behavior (green fine-mow + sheen + fringe, sand) gates off the client-painted OSM masks the shader already uses. The ground becomes lit materials that respond to the sun/camera, like TrackMan/GSPro, keeping the real course's coloration, the shipped far-field "real place" look, and the product's zero-manual-steps course pipeline.

**Architecture (v2 — restructured by the CEO-review User Challenge, accepted 2026-07-04):** Three moves, each independently shippable, **zero new per-course manual steps**. (1) **Tint, don't replace** — a blurred low-res copy of the course aerial modulates the turf's hue/value (`grass *= aerialLow / courseAvg`), and the *raw* photo only crossfades in at genuinely far range where its 0.3 m/px beats screen texel density. (2) **Gate surfaces from OSM masks the client already paints** — `scene.js` `_paintMask` already rasterizes OSM polys into the shader's `uMask`/`uBunker` canvases at ~0.5 m/px on every course automatically; a third green-only mask (`uGreenMask`) gives per-surface treatment the same way — no tool, no sidecar, no route, no registration risk. (3) **Differentiate surfaces** — greens get finer grain + tight cross-mow + slightly lower roughness + an in-shader fringe collar derived by dilating the green mask; sand keeps the existing bunker mask + crisp sand meshes. **Follow-up (not v1):** NDVI sand for dunes/waste OSM misses — built *runtime-first* on the proven no-dep imagery path (`lib/aerial.js`-style NAIPPlus request with the NIR band + `pngjs`), never as a manual dev tool; guarded against dry-fescue false positives (NDVI sand only *outside* OSM mown polys + a coverage-sanity abort).

**Tech Stack:** Three.js `MeshStandardMaterial` + `onBeforeCompile` GLSL injection (existing pattern in `public/render/turf.js`), canvas 2D for the client-side blur, `sharp` (dev-only, already used by `tools/add-course-aerial.mjs`) for the class-map PNG, `tools/hd-course/{naip,cog-source}.mjs` for 4-band COG windows, `node:test` (Node ≥ 22 — below 21 the glob silently runs zero tests).

---

## Why (evidence from the code — don't re-derive)

- `public/render/scene.js:288-291` builds `_macro` with `closeWeight 0.90 / farWeight 0.99`; `public/render/turf.js:84-92` then does `grass = mix(grass, photo, mw)` — the photo **replaces** the shaded turf. Stripes/palette/grain survive at 1–10%. The photo carries baked capture-day lighting, is 0.3 m/px (magnified ~15–25× at the play camera), and never responds to the live sun or camera. That is the "paint" look.
- The fix inverts the hierarchy: **materials carry the surface, the photo carries only what it's good at** (low-frequency real-world color; far-field detail).
- **The user-visible claim this plan buys:** within aiming range (the ground you look at from address to the green), the course reads as groomed, lit turf — visible blade-scale detail, live mow stripes, a distinct putting surface — instead of magnified JPEG. Validated as a BEFORE/AFTER diff at four fixed cameras on two courses (links + parkland), with the overview explicitly gated on *no visible regression*. The demand signal is the product owner's direct feedback that opened this arc ("like paint on the golf course surface — not real at all").
- Already built and idle, which makes this cheap: the `uMacroSurfaces` uniform is declared (`turf.js:71`) and never sampled; HD bundles already ship an RGBA class texture (`tools/hd-course/masks.mjs:57-63`); the NDVI classifier is committed with tests (`tools/trace/segment.mjs`); the tiled turf/sand PBR + stripes exist and are currently suppressed.

## Non-negotiable invariants (repo conventions that bite)

1. **Fingerprint safety:** `course.aerial` is scenery — it must stay OUT of `canonicalCourse` in `lib/hd-bundle.js`. Do not touch `canonicalCourse`, `CACHE_VERSION`, or the projection origin. (v2 adds no course-JSON fields at all; the constraint stands for the NDVI follow-up.)
2. **`customProgramCacheKey` must change whenever the injected shader text changes** (`turf-grain-v23` → `v24` → `v25`), or three.js reuses a stale program.
3. **GTAO recompile trap** (`public/render/config.js:48`): every texture sample added to an injected chunk must only reference `vMapUv` inside `#ifdef USE_MAP` blocks (the existing injections show the pattern). After any shader change, verify with `gtao: true` — if the turf goes black, this is why.
4. **No hot-reload:** `server.js`/`lib/**` change ⇒ restart server; `public/**` change ⇒ page reload.
5. **`BIRDIE_DATA_DIR` must point at the main repo's data dir** (absolute), not the worktree's:
   `C:/Users/USER/Documents/GitHub/Open-Birdie/data`.
6. **Never claim a visual fix without a captured frame** (render loop below).

## The render/verify loop (used by Tasks 0, 3, 6, 7)

1. Start the verify server (launch.json config `open-birdie-verify`, port 8223) with `BIRDIE_DATA_DIR` set; run `node .shots/sink.cjs` (capture sink on :9100). `.shots/` is uncommitted scratch — **create the sink if missing**:

```js
// .shots/sink.cjs — tiny capture sink: POST {name, dataURL} -> .shots/<name>.jpg
const http = require('http'), fs = require('fs'), path = require('path');
http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    try {
      const { name, dataURL } = JSON.parse(b);
      const safe = path.basename(String(name)).replace(/[^\w.-]/g, '_');
      fs.writeFileSync(path.join(__dirname, safe + '.jpg'), Buffer.from(dataURL.split(',')[1], 'base64'));
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok');
    } catch (e) { res.writeHead(400, { 'Access-Control-Allow-Origin': '*' }); res.end(String(e)); }
  });
}).listen(9100, '127.0.0.1', () => console.log('sink on :9100'));
```
2. `POST http://localhost:8223/api/load-course {"cached":"chambers-bay.json"}`, then `POST /api/next-hole` until the HUD shows hole 9 (the HD hole).
3. In the page (`window.__birdie.scene`), capture the **three canonical shots** (same coordinates every time so before/after diffs are honest):

```js
// ALWAYS first — after a headless reload the canvas is 0x0 and toDataURL returns "data:,"
const S = window.__birdie.scene;
S.renderer.setSize(1600, 900, false);
S.camMode = 'free';
const shot = (name, cx, cy, ch, lx, ly, lh) => {
  S.camera.position.set(cx, ch, -cy);            // sim (x,y,h) -> three (x,h,-y)
  S.camera.lookAt(lx, lh, -ly);
  // Render through the POSTFX COMPOSER, not the raw renderer (eng-review finding 5):
  // GTAO / bloom / the color grade / SMAA only exist in the composer, and this plan's
  // acceptance criteria (value, saturation, sheen, the gtao:true invariant) are all
  // postfx-sensitive. A raw render can never fail the GTAO gate. The composer's last
  // pass hits the default framebuffer and preserveDrawingBuffer keeps it capturable.
  if (S.postfx) S.postfx.render(); else S.renderer.render(S.scene, S.camera);
  return fetch('http://127.0.0.1:9100', { method: 'POST',
    body: JSON.stringify({ name, dataURL: S.renderer.domElement.toDataURL('image/jpeg', 0.92) }) });
};
// Pick a fairway point F=(fx,fy) and the green center G=(gx,gy) on hole 9 via S.geo.holes
// (record the numbers in .shots/NOTES.md on the first run and REUSE them for every capture):
//   playerpov:  camera at F + 1.7 m, looking at G            -> shot('h9-playerpov', fx, fy, S.hAt(fx,fy)+1.7, gx, gy, S.hAt(gx,gy))
//   orbit:      camera 14 m behind F at +4.6 m, looking at F -> the default play framing
//   aimview:    camera 14 m behind F at +4.6 m, looking at G -> the AIMING CORRIDOR (ground 25-150 m out —
//               this is where the material->photo handoff lives; CEO-review finding 7)
//   overview:   camera 450 m above course center, looking at the green
```

4. `Read` each `.shots/<name>.jpg` and compare against the Task 0 baselines.

**Two-course rule (CEO-review finding 4):** every visual gate runs on **chambers-bay** (links, hand-attached 0.3 m aerial) AND **tpc-sawgrass** (parkland, auto-fetched coarser aerial — cached course exists; run `POST /api/load-course {cached:"tpc-sawgrass.json"}` and reuse one fixed fairway/green camera pair recorded in NOTES.md). A links-only pass is how the last look-flip validated itself; don't repeat that.

**Definition of "stops looking like paint" (the acceptance bar for Task 3+):** at `playerpov` and `aimview`, the ground shows blade-scale detail from the tiled PBR set and live-lit mow stripes (not JPEG blur), with no obvious material→photo seam inside the aiming corridor; surfaces still show the real course's color variation (tan dunes vs green fairway — from the tint); at `overview` the criterion is a **diff vs the BEFORE capture: no visible regression** (the shipped "reads as the real place" look is a celebrated property — protect it explicitly, don't re-judge it).

---

## File structure

| File | Responsibility |
|---|---|
| `public/render/macro-tint.js` *(new)* | Pure, headless-testable: `srgbToLinear`, `averageLinearColor` (mean linear RGB of RGBA pixels). |
| `public/render/turf.js` *(modify)* | Shader: macro blend becomes chromatic-transfer tint + far-photo crossfade (v24, Task 2); green-mask-gated per-surface treatment + in-shader fringe (v25, Task 4). |
| `public/render/scene.js` *(modify)* | Build the blurred tint texture when the aerial decodes, with non-turf pixels excluded (Task 3); per-kind mask colors so the green gate rides `uMask.g` — zero new textures (Task 4); dispose prior `_macro` textures. |
| `public/render/config.js` *(modify)* | New knobs: tint/photo weights, tint resolution/blur. |
| `test/macro-tint.test.mjs` *(new)* | TDD the pure color helpers. |
| `test/hd-turf.test.mjs` *(modify)* | Extend the existing headless shader-injection tests (new uniforms, new cache keys, green-mask gating). |
| `docs/HANDOFF.md`, `docs/TODO.md` *(modify)* | Outcome + how the pieces work (Task 6); the NDVI-sand follow-up spec goes to TODO with its safeguards. |

**Not modified:** `server.js` (no new route — v1 has no classmap), `lib/course.js` / `lib/aerial.js` (the NDVI-sand follow-up will extend the runtime imagery path later, runtime-first), `tools/**` (no new dev tool — the User Challenge removed it), `tools/hd-course/masks.mjs` and everything the HD fingerprint touches.

---

### Task 0: Baseline captures + config knobs

**Files:** Modify `public/render/config.js`; create `.shots/NOTES.md` (camera coordinates memo — `.shots/` is scratch, not committed).

- [ ] **Step 1:** `npm test` → confirm the pre-change suite is green (record the count). Node ≥ 22 (`node --version`).
- [ ] **Step 2:** Add the new knobs to `RENDER_CONFIG` (after the `hdriFile` line, with the other tunables). They are read via `??` at the use sites, so adding them first is inert:

```js
  // Material-first ground (2026-07-04 plan): the aerial TINTS the lit turf instead of
  // replacing it; the raw photo only crossfades in at far range. Weights are the mix
  // factors for each layer (0 = pure procedural turf, 1 = full effect).
  courseAerialTintClose: 0.85, // low-freq photo tint weight near the camera
  courseAerialTintFar: 0.92,   // ... at far range
  courseAerialPhotoFar: 0.88,  // RAW photo weight at TRUE far range — keep the shipped overview
                               // look near-intact (99%->~90%, diff-gated); tint owns the mid-range
  macroTintMPerPx: 4,          // tint copy resolution: fixed metres/px (course-size-independent), px cap 512
  macroTintBlurPx: 2,          // canvas blur applied when downsampling the tint copy
```

- [ ] **Step 3:** Run the render/verify loop; capture **eight BEFORE frames — all four canonical cameras (playerpov / orbit / aimview / overview) on BOTH courses** (`h9-*-BEFORE.jpg` for chambers-bay, `saw-*-BEFORE.jpg` for tpc-sawgrass), through the postfx composer. Record both coordinate sets in `.shots/NOTES.md`. (Eng-review finding 4: the DoD's overview-diff and aimview gates are unperformable without these baselines.)
- [ ] **Step 4:** Commit: `git add public/render/config.js && git commit -m "feat(render): add material-first ground config knobs (inert until the shader lands)"`

### Task 1: Pure tint helpers (TDD)

**Files:** Create `public/render/macro-tint.js`; Test `test/macro-tint.test.mjs`.

- [ ] **Step 1: Write the failing test** (ESM, mirrors `test/hd-turf.test.mjs` style):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { srgbToLinear, averageLinearColor } from '../public/render/macro-tint.js';

test('srgbToLinear: endpoints and midpoint', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(255), 1);
  assert.ok(Math.abs(srgbToLinear(128) - 0.2159) < 1e-3); // sRGB 50% grey ≈ 21.6% linear
});

test('averageLinearColor averages in LINEAR space (not sRGB)', () => {
  // black + white pixels: linear mean is 0.5; a (wrong) sRGB mean would be ~0.5 in sRGB = 0.216 linear
  const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const a = averageLinearColor(px);
  for (const c of [a.r, a.g, a.b]) assert.ok(Math.abs(c - 0.5) < 1e-9);
});
```

- [ ] **Step 2:** `npm test` → FAIL (module not found).
- [ ] **Step 3: Implement** `public/render/macro-tint.js`:

```js
// Pure color helpers for the aerial tint layer. Kept DOM-free so node:test can
// exercise them headless (the canvas glue lives in scene.js).

// sRGB byte [0,255] -> linear [0,1]. The tint texture is sampled as sRGB (decoded
// to linear by the GPU), so the normalizing average MUST be computed in linear
// space too, or the tint skews dark.
export function srgbToLinear(c8) {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// Mean linear RGB of an RGBA pixel buffer (Uint8ClampedArray from getImageData).
export function averageLinearColor(data) {
  let r = 0, g = 0, b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += srgbToLinear(data[i]); g += srgbToLinear(data[i + 1]); b += srgbToLinear(data[i + 2]);
  }
  return { r: r / n, g: g / n, b: b / n };
}
```

- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(render): pure sRGB/linear tint helpers (TDD)"`

### Task 2: Shader — chromatic-transfer macro blend (v24)

**Files:** Modify `public/render/turf.js` (the `macroDecl`/`macroBlend` strings + uniforms + cache key); Test `test/hd-turf.test.mjs`.

- [ ] **Step 1: Write the failing test** — extend `test/hd-turf.test.mjs` (the macro test at line 25 and the legacy test at line 16):

```js
// in the legacy test, change the cache-key assertion to:
assert.equal(mat.customProgramCacheKey(), 'turf-grain-v24');

// in the macro test, extend the macro object and the uniform list:
const macro = { albedo: tex(), surfaces: tex(), coverage: tex(), low: tex(), avg: new THREE.Vector3(0.2, 0.25, 0.2),
  bounds: { minX: 10, minY: 10, maxX: 40, maxY: 40 }, closeWeight: 0.2, farWeight: 0.6, photoFar: 0.65 };
// ...
for (const u of ['uMacro', 'uMacroSurfaces', 'uMacroCoverage', 'uMacroLow', 'uMacroAvg', 'uMacroPhotoFar',
  'uMacroMin', 'uMacroSize', 'uMacroWeights', 'uCourseMin']) assert.ok(s.uniforms[u], `missing ${u}`);
assert.equal(mat.customProgramCacheKey(), 'turf-grain-v24-macro');
assert.match(s.fragmentShader, /texture2D\(\s*uMacroLow/);      // the SAMPLE, not just the declaration
assert.doesNotMatch(s.fragmentShader, /grass = mix\(grass, photo, mw\)/); // the v23 replacement blend is GONE
                                                                 // (a bad merge restoring both blends must fail)

// NEW test — the HD-bundle macro shape (no low/avg) must not crash the uniform upload:
test('macro without low/avg (HD-bundle shape) still wires tint uniforms', () => {
  const macro = { albedo: tex(), surfaces: tex(), coverage: tex(), bounds, closeWeight: 0.2, farWeight: 0.6 };
  const mat = makeTurfMaterial({ baseMap: tex(), mownMask: tex(), bunkerMask: tex(), bounds, anisotropy: 4, macro });
  const s = fakeShader();
  mat.onBeforeCompile(s);
  assert.ok(s.uniforms.uMacroLow.value, 'uMacroLow falls back to the albedo');
  assert.ok(s.uniforms.uMacroAvg.value && typeof s.uniforms.uMacroAvg.value.x === 'number', 'uMacroAvg falls back to a Vector3');
  assert.equal(s.uniforms.uMacroPhotoFar.value, 0.88, 'photoFar default');
});
```

- [ ] **Step 2:** `npm test` → FAIL (missing uniforms, v23 key).
- [ ] **Step 3: Implement.** In `makeTurfMaterial`:

(a) `macroDecl` (turf.js:70-72) gains three uniforms:

```js
    const macroDecl = macro ? `
        uniform sampler2D uMacro; uniform sampler2D uMacroSurfaces; uniform sampler2D uMacroCoverage;
        uniform sampler2D uMacroLow; uniform vec3 uMacroAvg; uniform float uMacroPhotoFar;
        uniform vec2 uMacroMin; uniform vec2 uMacroSize; uniform vec2 uMacroWeights; uniform vec2 uCourseMin;` : '';
```

(b) `macroBlend` (turf.js:73-93) — replace the photo-replacement block with tint + far crossfade:

```js
    const macroBlend = macro ? `
          { vec2 wXY = uCourseMin + vMapUv * uExt;
            vec2 mUv = (wXY - uMacroMin) / uMacroSize;
            if (mUv.x >= 0.0 && mUv.x <= 1.0 && mUv.y >= 0.0 && mUv.y <= 1.0) {
              vec2 edgeM = min(mUv, 1.0 - mUv) * uMacroSize;
              float edgeW = smoothstep(0.0, 7.0, min(edgeM.x, edgeM.y) + (tNoise(wXY * 0.15) - 0.5) * 5.0);
              float mvalid = texture2D(uMacroCoverage, mUv).r;
              // Two separate distance curves (CEO-review findings 6+7):
              //  - tint ramps over the mid-range and owns it;
              //  - the RAW photo only crossfades in past the aiming corridor. At the default
              //    framing (camera ~14 m behind the ball) the strip of fairway the player
              //    reads while aiming lives at ~25-150 m — the photo band must start beyond
              //    the corridor's near edge, not at 14 m, or the material->photo seam parks
              //    exactly where the player stares. 0.3 m/px genuinely beats screen texel
              //    density only ~100 m+ out at this FOV.
              float tintFar  = smoothstep(20.0, 60.0, length(vViewPosition));
              float photoFar = smoothstep(60.0, 150.0, length(vViewPosition));
              // CHROMATIC TRANSFER — the photo's low-frequency hue/value modulates the LIT
              // turf instead of replacing it. uMacroLow is a blurred copy (baked capture-day
              // shadows and sub-30cm detail are gone), normalized by the course mean so the
              // tint averages ~1.0; the material keeps its own value structure, stripes, and
              // light response. This is the "paint on the surface" fix.
              vec3 tint = clamp(texture2D(uMacroLow, mUv).rgb / max(uMacroAvg, vec3(0.03)), 0.45, 1.7);
              float tw = mvalid * edgeW * mix(uMacroWeights.x, uMacroWeights.y, tintFar);
              grass *= mix(vec3(1.0), tint, tw);
              // FAR PHOTO CROSSFADE — keeps the shipped "real place" overview (weight ~0.88
              // at true-far; the overview gate is a no-visible-regression diff vs BEFORE).
              vec3 photo = texture2D(uMacro, mUv).rgb * (0.86 + 0.30 * dl);
              grass = mix(grass, photo, mvalid * edgeW * uMacroPhotoFar * photoFar);
            } }` : '';
```

(c) uniform wiring (after turf.js:94) gains — **with fallbacks**, because `makeTurfMaterial` can receive an HD-bundle macro (`macro: this._macro || this._hdMacros[0] || null`, scene.js:392) which has no `low`/`avg`; without the fallbacks, three.js's vec3 uniform upload dereferences `undefined.x` every frame and kills the scene on any HD course whose course-wide aerial failed to fetch (reviewer finding):

```js
      shader.uniforms.uMacroLow = { value: macro.low ?? macro.albedo }; // HD macro: un-blurred ortho as its own tint source
      shader.uniforms.uMacroAvg = { value: macro.avg ?? new THREE.Vector3(0.2159, 0.2159, 0.2159) };
      shader.uniforms.uMacroPhotoFar = { value: macro.photoFar ?? 0.88 };
```

(d) cache key: `'turf-grain-v24-macro'` / `'turf-grain-v24'` (turf.js:224).

**Note:** `macro.low`/`macro.avg` may be undefined in the transitional state (scene.js not yet updated — Task 3). That's fine for the unit test (it passes stub textures), but do Task 3 before any visual run.

- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(render): macro blend v24 — aerial tints the lit turf; raw photo far-field only"`

### Task 3: scene.js — build the tint texture when the aerial decodes

**Files:** Modify `public/render/scene.js` (`loadCourse` aerial branch, ~279-294; new `_buildMacroTint` method; dispose).

- [ ] **Step 1:** Import the helper at the top of scene.js: `import { averageLinearColor } from './macro-tint.js';`
- [ ] **Step 2:** In `loadCourse`, dispose the previous course's macro textures **before the `if (geo.aerial ...)` branch, on BOTH paths** — placing it inside the aerial branch would leak the old full-res aerial (~64 MB + mips GPU) whenever the user switches from a US course to a no-aerial course (eng-review finding 6). Also free any tint textures built for the previous HD macros:

```js
    if (this._macro) { this._macro.albedo?.dispose?.(); this._macro.low?.dispose?.(); }
    for (const hm of this._hdMacros || []) hm.low?.dispose?.(); // ours; the bundle owns the ortho
```

- [ ] **Step 3:** Replace the `_macro` construction (scene.js:279-294) with:

```js
    if (geo.aerial && geo.aerial.bounds) {
      // Capture the macro object in the decode callback (NOT this._macro): if the user
      // switches course before the photo decodes, the stale callback must not redraw
      // the NEW course's tint canvas from the OLD course's image. (CEO review finding.)
      const macroRef = {};
      const tex = new THREE.TextureLoader().load('/api/course-aerial',
        () => this._buildMacroTint(macroRef),
        undefined,
        () => console.warn('[render] course aerial failed to load — procedural turf + neutral tint'));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      if (!this._blackTex) {
        this._blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
        this._blackTex.needsUpdate = true;
      }
      if (!this._whiteTex) {
        this._whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
        this._whiteTex.needsUpdate = true;
      }
      // Tint copy: starts as 1x1 mid-grey (tint == 1.0 everywhere) and is redrawn in
      // place from the decoded photo — the shader uniform holds THIS texture object,
      // so mutating it needs no recompile (same async-update pattern as the photo).
      const tintCv = document.createElement('canvas');
      tintCv.width = tintCv.height = 1;
      const tctx = tintCv.getContext('2d');
      tctx.fillStyle = '#808080'; tctx.fillRect(0, 0, 1, 1);
      const low = new THREE.CanvasTexture(tintCv);
      low.colorSpace = THREE.SRGBColorSpace;
      low.wrapS = low.wrapT = THREE.ClampToEdgeWrapping;
      this._macro = Object.assign(macroRef, {
        albedo: tex, low, avg: new THREE.Vector3(0.2159, 0.2159, 0.2159), // linear of #808080 -> tint 1.0
        coverage: this._whiteTex, surfaces: this._blackTex, bounds: geo.aerial.bounds,
        closeWeight: RENDER_CONFIG.courseAerialTintClose ?? 0.85,
        farWeight: RENDER_CONFIG.courseAerialTintFar ?? 0.92,
        photoFar: RENDER_CONFIG.courseAerialPhotoFar ?? 0.88,
      });
    } else {
      this._macro = null;
    }
```

**`surfaces` default changes white→black.** In v2 the shader still never samples `uMacroSurfaces` (the green gate is the `uGreen` canvas mask), so this is pure future-proofing for the runtime NDVI-sand follow-up: a white placeholder would mean "sand everywhere" the day that follow-up starts sampling; black means "no classes". The HD `_hdMacros` path (scene.js:266-269) needs **no change** — its RGBA surfaces texture stays bound-and-unsampled exactly as today.

- [ ] **Step 4:** Add the method (near `_paintSplat`):

```js
  // Redraw the 1x1 placeholder tint canvas from the decoded course aerial: a small
  // blurred copy (low-frequency hue/value only — baked shadows and sub-30cm detail
  // are averaged away) + the mean linear color of the PLAYABLE ground, used to
  // normalize it. Playable = inside the course boundary, outside water/bunker: the
  // aerial is padded ~60 m past the course and can include open sea (not an OSM
  // surface at all — Chambers Bay), and parkland courses are water-heavy (Sawgrass);
  // a mean dragged dark by water would brighten ALL turf and make the knobs
  // course-dependent (eng-review finding 2). Non-playable pixels are then neutralized
  // to that mean so they can't halo into the turf tint (CEO-review finding 10).
  // Resolution is fixed metres-per-pixel, course-size-independent.
  // `m` is the macro object captured at load time; bail if a newer course replaced it.
  // Best-effort: a failure here must never break course load (eng-review finding 7).
  _buildMacroTint(m) {
    if (!m || m !== this._macro) return; // course changed while the photo decoded
    try {
      const img = m.albedo && m.albedo.image;
      if (!img || !img.width) return;
      const b = m.bounds, extX = b.maxX - b.minX, extY = b.maxY - b.minY;
      const mpp = RENDER_CONFIG.macroTintMPerPx ?? 4;
      const w = Math.min(512, Math.max(32, Math.round(extX / mpp)));
      const h = Math.min(512, Math.max(32, Math.round(extY / mpp)));
      const px = (x) => ((x - b.minX) / extX) * w, py = (y) => ((b.maxY - y) / extY) * h;
      const trace = (c, poly) => {
        c.moveTo(px(poly[0][0]), py(poly[0][1]));
        for (let i = 1; i < poly.length; i++) c.lineTo(px(poly[i][0]), py(poly[i][1]));
        c.closePath();
      };
      const cnv = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      // raw downsample
      const raw = cnv(); const rctx = raw.getContext('2d');
      rctx.drawImage(img, 0, 0, w, h);
      // playable-mask: alpha 1 inside boundary, minus water/bunker (alpha keys both
      // the mean loop and the composite below)
      const msk = cnv(); const mctx = msk.getContext('2d');
      const boundary = this.geo && this.geo.boundary;
      mctx.fillStyle = '#fff';
      if (boundary && boundary.length >= 3) { mctx.beginPath(); trace(mctx, boundary); mctx.fill(); }
      else mctx.fillRect(0, 0, w, h);
      mctx.globalCompositeOperation = 'destination-out';
      for (const s of (this.geo && this.geo.surfaces) || []) {
        if ((s.kind !== 'water' && s.kind !== 'bunker') || !s.poly || s.poly.length < 3) continue;
        mctx.beginPath(); trace(mctx, s.poly); mctx.fill();
      }
      // mean over playable pixels only (fall back to the full-frame mean if the mask is empty)
      const rd = rctx.getImageData(0, 0, w, h).data, md = mctx.getImageData(0, 0, w, h).data;
      let r = 0, g = 0, bl = 0, n = 0;
      for (let i = 0; i < rd.length; i += 4) {
        if (md[i + 3] < 128) continue;
        r += srgbToLinear(rd[i]); g += srgbToLinear(rd[i + 1]); bl += srgbToLinear(rd[i + 2]); n++;
      }
      if (n > 0) m.avg.set(r / n, g / n, bl / n);
      else { const a = averageLinearColor(rd); m.avg.set(a.r, a.g, a.b); }
      // composite: mean everywhere, real photo only where playable, then blur into the
      // live tint canvas (the texture object bound at compile — mutate, don't replace)
      const play = cnv(); const pctx = play.getContext('2d');
      pctx.drawImage(msk, 0, 0);
      pctx.globalCompositeOperation = 'source-in';
      pctx.drawImage(raw, 0, 0);
      const comp = cnv(); const cctx = comp.getContext('2d');
      cctx.fillStyle = `rgb(${Math.round(255 * (m.avg.x ** (1 / 2.2)))},${Math.round(255 * (m.avg.y ** (1 / 2.2)))},${Math.round(255 * (m.avg.z ** (1 / 2.2)))})`;
      cctx.fillRect(0, 0, w, h);
      cctx.drawImage(play, 0, 0);
      const cv = m.low.image;
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.filter = `blur(${RENDER_CONFIG.macroTintBlurPx ?? 2}px)`;
      ctx.drawImage(comp, 0, 0);
      m.low.needsUpdate = true;
    } catch (e) { console.warn('[render] tint build failed — neutral tint kept:', e && e.message); }
  }
```

(Import `srgbToLinear` alongside `averageLinearColor`. The 2.2 gamma round-trip for the
neutral fill only paints exclusion zones, so exactness doesn't matter there; `m.avg`
stays exact.)

- [ ] **Step 5 (eng-review finding 3): give the HD-macro fallback a REAL tint too.** The `?? albedo` fallback from Task 2 prevents the crash, but an un-blurred 0.6 m ortho divided by a fabricated grey mean is a mis-normalized full-frequency multiply — a mutated version of the very "paint" look this plan kills. The bundle's ortho ImageBitmap is already decoded (`hd-bundle.js`), so build the blurred copy + real mean synchronously at attach. Add a small helper and use it in the `_hdMacros` map (scene.js:266-269), which also gets tint-era default weights:

```js
  // Blurred low-res copy + linear mean from an already-decoded image (HD ortho path).
  _tintFromImage(img) {
    const w = Math.max(8, Math.min(128, Math.round((img.width || 64) / 8)));
    const h = Math.max(8, Math.min(128, Math.round((img.height || 64) / 8)));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.filter = `blur(${RENDER_CONFIG.macroTintBlurPx ?? 2}px)`;
    ctx.drawImage(img, 0, 0, w, h);
    const a = averageLinearColor(ctx.getImageData(0, 0, w, h).data);
    const low = new THREE.CanvasTexture(cv);
    low.colorSpace = THREE.SRGBColorSpace;
    low.wrapS = low.wrapT = THREE.ClampToEdgeWrapping;
    return { low, avg: new THREE.Vector3(a.r, a.g, a.b) };
  }
```

```js
      this._hdMacros = hdList.map((a) => {
        const t = this._tintFromImage(a.orthophoto.image);
        return {
          albedo: a.orthophoto, surfaces: a.surfaces, coverage: a.coverage, bounds: a.terrain.bounds,
          low: t.low, avg: t.avg,
          closeWeight: RENDER_CONFIG.hdMacroCloseWeight ?? 0.85, farWeight: RENDER_CONFIG.hdMacroFarWeight ?? 0.92,
        };
      });
```

(The old `?? 0.78 / ?? 0.96` defaults were tuned when the weights meant *photo replacement*;
under v24 they mean *tint* — re-default to the tint-era values. The Task 2 `??` fallbacks in
turf.js stay as a second line of defense.)

- [ ] **Step 6:** `npm test` → still green (scene.js isn't under headless test; this guards turf/helpers).
- [ ] **Step 7: Visual gate.** Reload the page (client-only change — no server restart needed unless you also restarted for other reasons), re-run the render loop, capture `h9-playerpov-T3.jpg`, `h9-orbit-T3.jpg`, `h9-overview-T3.jpg`. Compare with the BEFORE set. **Accept when:** playerpov/orbit show lit turf detail + stripes with the photo's color variation (no JPEG blur underfoot); overview still reads as the real place. Tune `courseAerialTintClose/Far`, `courseAerialPhotoFar`, the far crossfade band (`14.0, 45.0`), and the tint clamp if needed — one knob at a time, re-capture each change.
- [ ] **Step 8:** Commit: `git commit -m "feat(render): build blurred aerial tint + linear course mean on decode"` (include the capture names in the commit body).

### Task 4: Green mask + per-surface materials (v25)

> **Restructured by the accepted User Challenge (2026-07-04):** no tool, no sidecar, no route.
> The green gate rides the **G channel of the existing mown-mask canvas** — `_paintMask`
> gains per-kind fill colors (fairway/tee = `#ff0000`, green = `#ffff00`), so `.r` keeps
> today's mown semantics untouched and `.g` becomes "green". Zero new textures (an extra
> full-size mask canvas would cost up to ~67 MB GPU memory on cap-sized courses — eng
> review, Section 4), zero new uniforms, no `makeTurfMaterial` signature change. Works on
> every course automatically at ~0.5 m/px. Sand keeps the existing `uBunker` mask + crisp
> sand meshes. `uMacroSurfaces` stays declared-but-unsampled, reserved for the NDVI follow-up.

**Files:** Modify `public/render/scene.js` (`_paintMask` + `_terrainMesh`, ~line 383/489) and `public/render/turf.js`; Test `test/hd-turf.test.mjs`.

- [ ] **Step 1: Failing test:** in `test/hd-turf.test.mjs`, bump both cache-key assertions to `v25` / `v25-macro`; assert the fragment reads the green channel and modulates roughness (both variants — this is a base-material feature, not a macro feature):

```js
// legacy + macro tests: keys 'turf-grain-v25' / 'turf-grain-v25-macro'
// new assertions (both variants):
assert.match(s.fragmentShader, /texture2D\(uMask, vMapUv\)\.g/);
assert.match(s.fragmentShader, /roughnessFactor = mix\(roughnessFactor/);
```

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement scene.js** — per-kind mask colors. `_paintMask(b, kinds)` gains an optional color map (`_paintMask(b, kinds, colors = null)`; `fillStyle = colors ? (colors[s.kind] || colors.default || '#fff') : '#fff'`), painting in the given kind order so greens land last:

```js
    const maskTex = new THREE.CanvasTexture(this._paintMask(
      b, ['fairway', 'tee', 'green'],                       // green LAST so its G channel isn't overpainted
      { default: '#ff0000', green: '#ffff00' }));           // .r = mown (unchanged semantics), .g = green
```

(The bunker-mask call keeps its no-colors default = white, byte-identical behavior. The existing `blur(1px)` feathers the G channel across the collar edge — exactly the soft boundary the fringe wants.)

- [ ] **Step 4: Implement turf.js** — three shader edits (all inside the existing `#ifdef USE_MAP` map_fragment block except (c), which gets its own guard). No new uniforms, no disposal changes:

(a) **Green + fringe sample** — REPLACE the existing `float m = texture2D(uMask, vMapUv).r;` line (one fetch now serves both channels):

```glsl
          vec4 mk = texture2D(uMask, vMapUv);
          float m = mk.r;                 // mown gate — semantics unchanged
          float g = mk.g;                 // green gate — the new packed channel
          // Fringe collar: dilate the green channel ~1.5 m and take the ring (dilated minus
          // green). Derived in-shader from a coverage mask — no encoded magic values, so
          // nothing breaks under bilinear/mip filtering (the G=0.5 trick was rejected in
          // review for exactly that). Distance-faded: a 1.5 m collar is sub-pixel past ~60 m.
          vec2 fo = vec2(1.5) / uExt;
          float gN = max(max(texture2D(uMask, vMapUv + vec2(fo.x, 0.0)).g,
                             texture2D(uMask, vMapUv - vec2(fo.x, 0.0)).g),
                         max(texture2D(uMask, vMapUv + vec2(0.0, fo.y)).g,
                             texture2D(uMask, vMapUv - vec2(0.0, fo.y)).g));
          float fr = clamp(gN - g, 0.0, 1.0) * (1.0 - smoothstep(35.0, 60.0, length(vViewPosition)));
```

(b) **Per-surface treatment** — modify the existing stripe line and insert the green block after it:

```glsl
          grass *= 1.0 + (0.2 * stripe + 0.09 * stripe2) * m * (1.0 - 0.85 * g - 0.6 * fr);
          // GREEN: tighter, calmer grain + a fine checkerboard mow — the putting surface
          // must read manicured at close range, not share the fairway's 7 m bands.
          vec3 gdF = texture2D(uDetail, vMapUv * uDetailRepeat * 3.0).rgb;
          float dlF = dot(gdF, vec3(0.299, 0.587, 0.114));
          grass = mix(grass, grass * (0.90 + 0.20 * dlF), g);
          float gb1 = sin((wx * 0.94 + wy * 0.34) * (3.14159265 / (uStripeM * 0.35)));
          float gb2 = sin((wx * -0.34 + wy * 0.94) * (3.14159265 / (uStripeM * 0.35)));
          grass *= 1.0 + 0.10 * ((smoothstep(-0.6, 0.6, gb1) - 0.5) + (smoothstep(-0.6, 0.6, gb2) - 0.5)) * g;
          grass *= 1.0 - 0.05 * fr; // collar: slightly darker tight-mown ring
```

(c) **Roughness sheen** — extend the `roughnessmap_fragment` replacement (BOTH variants — `uMask` is a base uniform). The chunk has no implicit `USE_MAP` guard, so wrap it explicitly (GTAO-safe, invariant 3):

```glsl
        roughnessFactor = clamp(roughnessFactor, 0.9, 1.0);
        #ifdef USE_MAP
        roughnessFactor = mix(roughnessFactor, 0.84, texture2D(uMask, vMapUv).g);
        #endif
```

(d) cache key → `'turf-grain-v25-macro'` / `'turf-grain-v25'`.

- [ ] **Step 5:** `npm test` → PASS.
- [ ] **Step 6: Visual gate (two-course rule).** Page reload; capture green close-ups + `aimview` + `overview` on chambers-bay AND tpc-sawgrass. **Accept when:** the green reads as a distinct fine-mown surface with a subtle sheen change and a visible collar; no fairway-band stripes crossing greens; no black terrain with `gtao: true` (invariant 3); overview = no visible regression vs BEFORE.
- [ ] **Step 7:** Commit: `git commit -m "feat(render): green mask + per-surface materials (v25) — fine mow, sheen, fringe"`

### Task 5 (stretch, do only if Tasks 3+4 captures approve): fringe + band tuning

**Files:** Modify `public/render/turf.js` constants only.

- [ ] The fringe collar already renders from Task 4. Tune the dilation radius (`1.5`), its darkening (`0.05`), and the tint/photo bands (`20/60`, `60/150`) against green-side and `aimview` captures on both courses. **Expect the collar to read ~30% thinner on diagonal green edges** — the 4-tap dilation is axis-aligned (~1.06 m effective on diagonals); if it bothers, go to 8 taps rather than inflating the radius (eng-review finding 10). One constant per capture iteration. Commit as `tune(render): fringe + distance-band constants`.

### Task 6: Docs + final verification

**Files:** Modify `docs/HANDOFF.md`, `docs/TODO.md`.

- [ ] **Step 1:** `npm test` → full suite green (count ≥ Task 0's + new tests).
- [ ] **Step 2:** Final capture set (all four canonical shots × both courses) → keep in `.shots/` with a `-AFTER` suffix.
- [ ] **Step 3:** HANDOFF.md: add a "Material-first ground (2026-07-04)" section — the tint architecture + the green-mask gate (mirror §4a's style), the distance bands, the surfaces-default white→black future-proofing note, knob list. TODO.md: close this arc; add the follow-ups with full context: **runtime NDVI sand** (NAIPPlus NIR request + `pngjs` on the `lib/aerial.js` pattern — runtime-first, never a manual dev tool; safeguards from the CEO review: NDVI sand only *outside* OSM mown polys, plus a coverage-sanity abort, because bright low-NDVI is exactly Chambers Bay's dry fescue), plus bunker lip geometry / cart paths.
- [ ] **Step 4:** Commit: `git commit -m "docs: material-first ground — handoff + todo"`

---

## Verification (definition of done)

- `npm test` green on Node ≥ 22 (macro-tint + hd-turf v25 suites included).
- Captured BEFORE/AFTER pairs for the **four** canonical cameras on **both courses** (chambers-bay links + tpc-sawgrass parkland with its auto-fetched coarser aerial); playerpov/aimview AFTER show lit material detail (no photo blur underfoot), live mow stripes, a distinct green surface with collar, and no material→photo seam inside the aiming corridor; the overview AFTER passes a **diff vs BEFORE with no visible regression**.
- `gtao: true` renders correctly (no black turf).
- A course **without** an aerial (non-US) still loads — `_macro = null` path unchanged; the green mask + per-surface treatment still work there (they're OSM-driven, aerial-independent).
- An HD-bundle course whose aerial fetch failed renders via the `_hdMacros[0]` fallback with a **real blurred ortho tint** (low + mean built from the bundle's own bitmap — not a mis-normalized full-frequency multiply); uniform-wiring regression test green.

## Failure modes (per new codepath)

| Codepath | Failure | Test? | Handling? | Visible? |
|---|---|---|---|---|
| tint normalize | sRGB/linear mismatch → dark tint | YES (linear-mean test) | computed in linear | capture |
| tint texture | sampled before decode | n/a | 1×1 grey placeholder = tint 1.0 | none (by design) |
| tint build | course switched mid-decode → wrong course's tint | n/a | closure-captured macro + staleness bail | none (by design) |
| tint clamp | outlier photo colors (roofs, roads) blow up hue | no | clamp 0.45–1.7 + non-playable pixels neutralized pre-blur | capture |
| tint mean | open sea / heavy water drags the mean dark → all turf brightens | no | mean over boundary-masked playable pixels only (empty mask → full-frame fallback) | capture (two-course rule) |
| HD fallback tint | aerial-less HD course → mis-normalized full-freq multiply | no | real blurred low + mean built from the bundle's own ortho bitmap at attach | DoD line |
| aerial/tint leak | US → no-aerial course switch leaks ~64 MB | no | dispose hoisted above the branch (both paths) + HD lows freed | heap snapshot (manual) |
| green mask | course has no OSM greens → mask all black | n/a | g=0 everywhere → fairway treatment (today's look) | capture |
| fringe dilation | mask edge blur reads as thin permanent fringe | no | ring derived from coverage delta; distance-faded past 60 m | capture (tune radius) |
| HD macro fallback | course aerial missing on HD course → undefined uniforms | YES (fallback test) | `?? albedo` / `?? Vector3` in wiring | none |
| GTAO recompile | vMapUv missing in normal pass → black turf | manual (flag on during gates) | all samples inside `#ifdef USE_MAP` | capture |
| stale program | cache key not bumped | YES (key asserts) | v24/v25 bumps | — |
| far-field regression | photo weight drop changes the shipped overview | capture diff | photoFar 0.88 + band 60–150 m; overview gate = no-visible-diff | capture |

## What already exists (reused, not rebuilt)

- **Client OSM mask rasterizer: `scene.js` `_paintMask` (383-388)** — the v2 green gate is its third invocation; automatic on every course, ~0.5 m/px, registration identical to the shipped `uMask`/`uBunker`.
- The whole PBR layer being un-suppressed: tiled grass/sand albedo+normal+roughness (`ASSETS.turf`), mow stripes, procedural grain, meso-normals (`turf.js`), sand meshes (`makeSandMaterial`), headless shader test rig (`test/hd-turf.test.mjs`).
- Runtime no-dep imagery fetch: `lib/aerial.js` (the pattern the NDVI-sand follow-up will extend with a NIR band request + `pngjs`).
- NDVI classifier: `tools/trace/segment.mjs` (committed, tested — the follow-up's pure core).
- Serving/attachment pattern: `/api/course-aerial` route, `course.aerial` non-fingerprinted sidecar field.

## NOT in scope (deferred, with rationale)

- **NDVI sand classification (dunes/waste beyond OSM)** — descoped from v1 by the accepted User Challenge. When built, it is **runtime-first** (NAIPPlus `exportImage` with the NIR band + `pngjs` decode + the pure `segment.mjs` math — the same no-dep mechanism as the aerial), never a manual per-course dev tool. Mandatory safeguards recorded from the CEO review: NDVI sand applies only *outside* OSM mown polys (bright + low-NDVI is exactly dry links fescue — the flagship course's fairways), and a coverage-sanity abort (implausible sand % → refuse loudly). Trigger: captures showing OSM bunker/waste coverage is visibly insufficient.
- **HD-bundle-native class channels** — only relevant for HD courses *without* a course aerial (the degraded path); the OSM masks already cover HD meshes (course-relative UVs). Revisit with the NDVI follow-up.
- **De-lighting the raw photo** — moot: the photo only shows far-field (where its baked light reads fine) and as a blurred tint (where baked shadows average away). The previous global de-light experiment stays reverted.
- **Bunker lip geometry, cart-path meshes, geometry grass beyond the existing foreground layer** — separate polish tracks; geometry grass specifically was reality-tested as the wrong lever at this camera.
- **Lighting/post changes** (CSM, TAA, tone curve) — the HDRI/ACES/GTAO stack is not the bottleneck; don't tune light on top of a changing albedo.

## Parallelization

Sequential implementation, no real parallelization opportunity in v2: Tasks 1 → 2 → 3 → 4 all touch `turf.js`/`scene.js` (one lane), and Tasks 5–6 depend on 4's captures. The User Challenge removed the only independent lane (the data tool).

<!-- AUTONOMOUS DECISION LOG -->
## Autoplan Review Record (2026-07-04)

Run via `/autoplan` (Codex CLI absent → all dual voices `[subagent-only]`). Mode: **SELECTIVE EXPANSION**. Premise gate: **user confirmed both premises** (photo-as-albedo is the root cause; automated NDVI+OSM classification over hand-authoring).

### CEO phase — Step 0 record

**Premises (0A):** (1) "Paint" = photo replacing lit materials at 90–99 % weight — code-verified (`turf.js:91`, `scene.js:290`). (2) Doing nothing leaves the user's #1 stated realism complaint standing. (3) Automated classification preserves the product differentiator (auto-generated courses) vs. TrackMan/GSPro artist-authoring. All three confirmed at the gate.

**Landscape (3-layer):** L1 tried-and-true = splat-map terrain + tiled detail materials (industry standard since mid-2000s; what GSPro/Unity and EA/Frostbite course pipelines do). L2 = the commissioned 2026-06-27 golf-rendering research memo (reference stacks verified native + authored; geometry grass reality-tested as the wrong lever at this camera). L3 first-principles = a photo is a record of one lighting moment and cannot respond to the live sun/camera; the crossover where photo detail beats material detail is ~45 m at this camera — hence tint-near/photo-far. Fresh WebSearch skipped (8-day-old commissioned research on this exact question; logged).

**Dream-state delta (0C):** CURRENT (photo painted on 1 m terrain, one BRDF everywhere) → THIS PLAN (lit per-surface materials, photo as tint + far-field) → 12-MONTH IDEAL (every course auto-compiles to per-surface materials + HD lidar; one classmap feeds rendering AND physics surfaces). On-trajectory; the classmap is deliberate platform infrastructure — its next consumer is physics classification (Phase A sidecar), then any future native-engine port (materials + classes transfer; a photo drape would not).

**Alternatives (0C-bis):** A = the plan (tint + classmap on the existing turf material; M effort; completeness 8/10). B = tint-only, no classes (S; 4/10 — bunker misregistration and undifferentiated greens survive). C = full splat-map terrain rewrite (L–XL; 9/10; med-high risk — discards the tuned shipping shader; A's classmap remains C's input if ever wanted). **Auto-decided A** (P1 completeness + P5 explicit-over-clever; C's +1 is elegance, not coverage). A-vs-C surfaced as a taste decision at the final gate.

**Scope decisions (0D cherry-pick, auto-decided):**

| # | Proposal | Effort | Decision | Why |
|---|----------|--------|----------|-----|
| 1 | Stale-closure guard in `_buildMacroTint` (course switch mid-decode) | S | **ACCEPTED → folded into Task 3** | Correctness; in blast radius (P1/P2) |
| 2 | Class-coverage % log line in the classmap tool | S | ~~ACCEPTED~~ **SUPERSEDED by D2** (tool descoped) | Carried into the NDVI follow-up spec in TODO |
| 3 | Client console line: classmap loaded / absent / failed | S | ~~ACCEPTED~~ **SUPERSEDED by D2** (no classmap load in v2) | — |
| 4 | Default classmap gsd 1.0 m/px | S | ~~ACCEPTED~~ **SUPERSEDED by D2** (tool descoped) | Carried into the NDVI follow-up spec |
| 5 | Document incomplete-texture-samples-black | S | ~~ACCEPTED~~ **SUPERSEDED by D2** (kept as the black-default future-proofing note in Task 3) | — |
| 6 | Two-layer aerial (HD 0.6 m ortho inset at far-field) | M | DEFERRED → TODO | Value halved by material-first (near-field is materials now) |
| 7 | HD-native class channels | S | DEFERRED (kept) | Course-wide classmap already covers HD rects; only matters for aerial-less HD courses (degraded path) |
| 8 | In-app classmap debug overlay toggle | S | DEFERRED → TODO (taste, at gate) | Offline overlay PNG + capture loop already covers it (P4) |
| 9 | Legacy-look kill-switch flag | S | SKIPPED | Git revert is the rollback; dual shader paths violate P5 |
| 10 | Classmap format version byte | S | SKIPPED | YAGNI; tool+shader ship together in one repo |

**Error & Rescue registry (CEO Section 2, new codepaths — updated for v2 after the accepted User Challenge):**

| Codepath | Failure | Rescued? | User sees |
|---|---|---|---|
| `_buildMacroTint` | image not decoded / stale course | Y (guards) | placeholder tint (=1.0), correct course only |
| `_buildMacroTint` exclusion | course has no water/bunker polys | Y (loop no-ops) | plain blurred tint |
| green mask paint | course has no OSM greens | Y (all-black mask → g=0) | fairway treatment (today's look) |
| fringe dilation | blur/AA edge reads as permanent thin ring | tuned (Task 5) + distance fade | subtle collar (intended) or tuned away |
| shader | avg≈0 / degenerate bounds | Y (`max(avg, .03)`; bounds valid by construction) | clamped tint |
| HD macro fallback | aerial missing on HD course | Y (`??` fallbacks + regression test) | ortho-tinted ground, no crash |

**CEO sections 1–11 (findings auto-decided; full depth, summarized):** S1 Architecture — dependency graph below; no kill-switch (decision 9); coupling = classmap channel semantics shared tool↔shader (documented contract, shader-side asserted by tests). S2 Errors — registry above; 1 gap found → decision 1. S3 Security — new GET route mirrors the audited aerial route (no params, basename guard); dev tool hits hardcoded public-domain USGS endpoints; no new deps (sharp/geotiff already devDeps); nothing flagged. S4 Data/edge — shadow paths traced (no aerial / no classmap / failed load / mid-decode course switch → decisions 1, 3, 5); no new interactive UI. S5 Quality — patterns match repo idioms; "classmap" naming avoids the `surfaces` collision; no over-abstraction. S6 Tests — unit coverage planned for every pure path; route verified by curl (matches repo convention — the aerial route has no automated test either); visual acceptance capture-gated; no flaky deps. S7 Perf — added fragment cost ≈ 3 texture samples vs. an existing 4-octave fbm stack (negligible); texture budget capped by decision 4. S8 Observability — decisions 2, 3; tool already logs its artifact line. S9 Deploy — additive JSON field, no migrations, old data valid, rollback = git revert; restart/reload rules in plan. S10 Trajectory — reversibility 4/5; v24→v25 staged rework is deliberate shippability debt; classmap = platform asset. S11 Design/UX — SKIPPED (no DOM-UI scope; visual acceptance is capture-gated in Tasks 3/6).

```
  v2 architecture (post-D2 — no tool, no route, no sidecar):

  server.js ── /api/course-aerial ──▶ scene.js _macro.albedo (photo, far-field)
                                          │
                                          ├─▶ _buildMacroTint: blur + linear mean
                                          │   (water/bunker painted out) ─▶ _macro.{low,avg}
  OSM course.surfaces (already in geo) ───┤
                                          └─▶ _paintMask (per-kind colors):
                                              uMask.r = mown · uMask.g = green · uBunker
                                          ▼
              turf.js v25: lit PBR materials × tint(mid) × green/fringe gates + photo(far)
```

### Decision Audit Trail

| # | Phase | Decision | Class | Principle | Rationale | Rejected |
|---|-------|----------|-------|-----------|-----------|----------|
| 1 | 0 | Skip /office-hours offer | Mechanical | P6 | User explicitly commissioned this review pipeline on an already-shaped plan | office-hours detour |
| 2 | 0 | UI scope = NO | Mechanical | — | Only matches are "screen texel density" (rendering math); no DOM UI | Phase 2 run |
| 3 | 0 | DX scope = YES | Mechanical | — | New CLI dev tool + HTTP endpoint + npm workflows | skipping 3.5 |
| 4 | CEO | Mode = SELECTIVE EXPANSION | Mechanical | autoplan override | Feature enhancement on an existing system | — |
| 5 | CEO | Approach A over B/C | Taste (at gate) | P1+P5 | 8/10 coverage at low risk; C's +1 is elegance with rewrite risk | B, C |
| 6 | CEO | Reuse 2026-06-27 research memo as landscape check | Mechanical | P3/P4 | Commissioned deep-research on this exact question, 8 days old | fresh WebSearch |
| 7 | CEO | Accept scope items 1–5 (table above) | Mechanical | P1/P2 | In blast radius, < 1 h each, correctness/observability | — |
| 8 | CEO | Defer items 6–8, skip 9–10 | Taste (8) / Mechanical | P3/P4/P5 | See table | — |
| 9 | CEO | Spec-review loop on CEO artifact satisfied by this session's plan-document reviewer pass (1 issue + 4 advisories, fixed) | Mechanical | P3/P4 | Same content adversarially reviewed minutes earlier | duplicate reviewer dispatch |
| 10 | CEO | Surface the outside voice's data-layer restructure as a USER CHALLENGE mid-pipeline (not at the final gate) | Mechanical (process) | sequential-phases rule | Eng phase must review the real plan; re-running phases post-gate is the expensive path | gate-time challenge |
| 11 | CEO | **D2 (user decision): descope classmap tool/route/sidecar; green gate = third client OSM mask; NDVI sand = runtime-first follow-up** | USER CHALLENGE — accepted | — | Automation moat + the greens never needed the pipeline (verified: `classChannels` green was OSM-only; `_paintMask` already rasterizes OSM client-side at better resolution) | keep classmap; hybrid |
| 12 | CEO | Photo band moved out of the aiming corridor (60–150 m); photoFar 0.65→0.88; overview gate = diff-vs-BEFORE | Mechanical | P1 | Outside-voice findings 6+7 verified against camera geometry | 14–45 m band |
| 13 | CEO | Fringe = in-shader dilation of the green mask (no encoded magic values); tint = fixed m/px + water/bunker excluded pre-blur | Mechanical | P1/P5 | Outside-voice findings 8+10 verified (mipmap trap; parkland halos) | G=0.5 encoding; fixed 256 px |
| 14 | CEO | Two-course validation rule (links + parkland) + aimview camera added to every gate | Mechanical | P1 | Outside-voice finding 4: the last look-flip validated links-only | single-course gates |
| 15 | CEO | HD-native class channels stay deferred — rebuttal recorded | Mechanical | P3 | Only matters on aerial-less HD courses; OSM masks already cover HD meshes via course-relative UVs; "few lines" understates a second per-patch sampler | remap now |
| 16 | Eng | Green gate rides `uMask.g` (per-kind mask colors) instead of a third mask texture | Mechanical (overridable at gate) | P3+P5 | A third cap-sized mask canvas costs up to ~67 MB GPU memory; packing = zero new textures/uniforms/params, `.r` semantics untouched | separate `uGreen` texture |
| 17 | 3.5 | Phase 3.5 (DX) SKIPPED post-D2 — evidence-based re-check | Mechanical | autoplan skip rule | Phase-0 DX detection fired on the v1 CLI tool + HTTP endpoint; both were removed by the accepted User Challenge (re-grep: 0 mentions remain); v2 introduces no developer-facing artifacts | running 8 DX passes on removed artifacts |

### Eng phase (Phase 3) — primary reviewer record

**Step 0 scope challenge:** v2 touches 4 source + 2 test files (< 8 threshold), zero new classes/services — no complexity STOP. Leverage is maximal by construction (the User Challenge was the leverage fix: `_paintMask` third use, existing PBR/mask/serving mechanisms). Minimum-set check: Task 5 (tuning) already marked stretch; nothing else deferrable without losing the goal. TODOS cross-reference: closes the "two-layer aerial" polish question (deferred, value-halved), creates the NDVI follow-up TODO (Task 6 writes it). Distribution check: no new artifact type — n/a. Search check: detail-texture/splat terrain is Layer-1 standard practice; no new infra, no innovation token spent.

**Section 1 (Architecture):** boundaries clean — pure helpers (`macro-tint.js`) / shader (`turf.js`) / orchestration (`scene.js`); the only new coupling is the documented `uMask` channel contract (`.r` mown, `.g` green) between `_paintMask` and the shader — asserted by the v25 tests. Both shader variants share the green path (base feature, not macro feature) — fewer variants than v1. Production failure scenario per new codepath: covered in the failure-modes table (aerial fetch fail, mid-decode switch, GTAO recompile). Rollback = git revert, no data/migrations. Zero new attack surface (v2 adds no endpoints, no params, no file reads).

**Section 2 (Code quality):** GLSL identifier collision check against the real `map_fragment` block — existing locals `gd/dl/grass/m/wx/wy/fine/broad/zone/band/stripe/band2/stripe2/sp/gx/gy/rake/gLum`; new locals `g/fo/gN/fr/gdF/dlF/gb1/gb2/tintFar/photoFar` — no collisions (`gx/gy` exist but are untouched; `photoFar` local vs `uMacroPhotoFar` uniform are distinct). `dl`/`grass`/`vViewPosition` confirmed in scope at the macroBlend injection point (inside the map_fragment template). HD meshes get the masks for free (`buildHdTerrain({uvBounds: b})` → course-relative `vMapUv`). Debt note: the map_fragment template literal is growing long — acceptable now, flagged for a future extraction, no action in this plan.

**Section 3 (Tests) — coverage diagram:**

```
CODE PATHS                                             USER FLOWS (capture-gated by design)
[+] macro-tint.js                                      [+] 4 cameras x 2 courses BEFORE/AFTER
  ├── srgbToLinear      [★★★ planned] endpoints+mid      ├── playerpov/aimview: material detail
  └── averageLinearColor[★★★ planned] linear-mean trap   ├── overview: diff = no regression
[+] turf.js (headless shader rig, test/hd-turf.test.mjs) └── green close-up: fine mow + collar
  ├── v24 macro uniforms [★★  planned] presence+key    [+] course switch mid-decode
  ├── v24 HD-shape fallback [★★★ planned] REGRESSION     └── [GAP accepted] no headless DOM rig;
  │     (the would-be per-frame TypeError class)              guarded by code + review
  ├── v25 green-channel sample [★★ planned] regex       [+] gtao:true after shader edits
  └── v25 roughness mix [★★ planned] regex                └── manual flag check at every gate
[+] scene.js (DOM/canvas — not headless-testable in this repo)
  ├── _buildMacroTint / mask colors / dispose [GAP accepted — capture-gated; matches repo
  │     convention: no jsdom infra, canvases verified visually]
COVERAGE: 6/6 unit-testable paths planned (100%); DOM paths capture-gated (repo convention).
REGRESSION RULE: v24/v25 change existing macro behavior → the key-bump asserts + the
HD-fallback test are the regression tests; no uncovered regression identified.
```

Test-plan artifact written: `~/.gstack/projects/rroojrooj-Open-Birdie/USER-claude-fervent-hermann-266eed-eng-review-test-plan-20260704-045800.md` (consumed by /qa). No LLM/prompt surface → no evals.

**Section 4 (Performance):** ~7 new texture fetches/fragment worst case (uMacroLow + 4 dilation taps + fine-detail + roughness re-sample; the base uMask fetch is shared via the `mk` swizzle) vs. an existing 4-octave-fbm-dominated shader (~24 noise evaluations) — negligible; fringe taps always execute (branching on distance costs more than it saves). One-time canvas work per course load (tint ≤512² ×4 passes, mask repaint = same cost as today). **Finding (folded):** a third cap-sized mask canvas would have added up to ~67 MB GPU memory → green gate packed into `uMask.g` instead (decision 16; independently recommended by the eng outside voice — convergent). No N+1/db/network-per-frame concerns.

### Eng outside voice (Claude subagent — Codex unavailable)

10 findings, all code-verified by the voice (it also re-verified every GLSL snippet's scoping, the stripe-factor positivity, the CanvasTexture mutation pattern, and invariant 1 — "verified sound" list retained in the session log). Disposition:
**#1 (P1, uGreen undeclared → GLSL compile error invisible to the headless rig)** and **#9 (pack the green gate into uMask.g)** — both *already resolved by decision 16*, made independently while the voice was reading: convergent recommendation, and the packing eliminates the P1's root cause (no new uniform exists to forget). **#2** (mean computed pre-exclusion + blind to unmapped sea → course-dependent tint normalization) — folded: boundary-masked playable-pixel mean + neutral composite. **#3** (HD fallback = mis-normalized full-frequency multiply) — folded: `_tintFromImage` builds a real blurred low + mean from the bundle's decoded ortho; hd weights re-defaulted to tint-era. **#4** (baselines can't satisfy the DoD) — folded: 8 BEFORE frames (4 cams × 2 courses). **#5** (captures bypass postfx → GTAO gate was theater, tuning on ungraded frames) — folded: shot helper renders through the composer. **#6** (aerial/tint leak on US→no-aerial switch) — folded: dispose hoisted + HD lows freed. **#7** (silent failures: no onError, no try/catch) — folded. **#8** (assertion gaps: declaration-vs-sample regex, missing negative assert on the v23 blend, photoFar numeric) — folded; the greenMask-param TypeError sub-item is moot under packing. **#10** (sample-count arithmetic ×3 off; diagonal dilation ~1.06 m vs 1.5 m) — folded: record corrected, Task 5 expectation noted.

```
ENG DUAL VOICES — CONSENSUS TABLE                    [subagent-only — Codex CLI absent]
═══════════════════════════════════════════════════════════════════════════
  Dimension                          Claude (primary)   Subagent        Consensus
  ────────────────────────────────── ────────────────── ─────────────── ─────────
  1. Architecture sound?             yes (post-D2)      yes, w/ fixes   CONFIRMED
  2. Test coverage sufficient?       gaps accepted      3 assert gaps   DISAGREE → folded
  3. Performance risks addressed?    packing (dec 16)   packing (#9)    CONFIRMED (convergent)
  4. Security threats covered?       zero new surface   nothing to flag CONFIRMED
  5. Error paths handled?            registry done      3 real gaps     DISAGREE → folded
  6. Deployment risk manageable?     revert-only        yes             CONFIRMED
═══════════════════════════════════════════════════════════════════════════
```

| # | Phase | Decision | Class | Principle | Rationale | Rejected |
|---|-------|----------|-------|-----------|-----------|----------|
| 18 | Eng | Fold eng-voice #2–#8, #10 (mean masking, HD real tint, 8 baselines, postfx captures, dispose hoist, onError/try-catch, assert tightening, arithmetic/dilation corrections) | Mechanical | P1/P5 | All verified against code; each is a correctness/verifiability fix inside scope | defer to implementation |
| 19 | Eng | Eng-voice #1/#9 recorded as convergent with decision 16 (packing) — no further action | Mechanical | — | The packing design has no new uniform to forget and no new texture memory | separate uGreen texture |

### CEO outside voice (Claude subagent — Codex unavailable)

10 findings; 2 critical + 3 high verified and acted on. The critical pair (manual classmap contradicts the automation moat + greens never needed the new pipeline) became **D2**, presented as a User Challenge and **accepted by the user** → plan restructured to v2 (OSM-mask architecture, tool/route/sidecar removed, NDVI sand deferred runtime-first with dry-fescue safeguards). Findings 4, 6, 7, 8, 10 folded as plan edits (decisions 12–14). Finding 5 (no demand signal) answered by context the subagent lacked: the product owner's direct complaint opened this arc — the user-visible claim is now stated in the plan. Finding 9 deferred with rebuttal (decision 15). Finding 3 (NDVI dry-fescue false positive) recorded as a mandatory safeguard in the follow-up spec.

**Cross-model tension:** none applicable (single-model run); primary-vs-subagent tensions were resolved by user decision (D2) or verification (15).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Plan-document review | writing-plans reviewer | Completeness vs. the real code | 1 | APPROVED | 1 issue + 4 advisories, all fixed (HD-macro fallback crash; sink source; USE_MAP guard; PRIORITY deviation; sharp under CLI guard) |
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR (via /autoplan) | 10 proposals: 5 accepted (then superseded-or-carried by D2), 3 deferred, 2 skipped; premise gate passed; **User Challenge D2 accepted → v2 restructure (OSM-mask architecture, zero manual steps)** |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | unavailable | Codex CLI absent — all outside voices ran as independent Claude subagents (`[subagent-only]`) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (via /autoplan) | 10 outside-voice findings: 1 P1 pre-empted by the convergent uMask.g packing, 9 folded (postfx captures, boundary-masked tint mean, real HD-fallback tint, 8 baselines, dispose hoist, onError/try-catch, assert tightening, arithmetic/dilation corrections); 0 critical gaps open |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | skipped | no DOM-UI scope; visual acceptance capture-gated in Tasks 3/4 (4 cameras × 2 courses, diff-based overview) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | skipped (post-D2) | the CLI tool + endpoint that triggered DX detection were removed by the accepted User Challenge (re-grep: 0 remain) |

- **CROSS-MODEL:** not applicable (Codex absent). Cross-*agent* convergence was strong: the primary reviewer's uMask.g packing (decision 16) and the eng outside voice's finding #9 were reached independently; the "validation breadth" theme was raised by both phase voices independently and fully folded.
- **VERDICT:** CEO + ENG CLEARED (via /autoplan) — ready to implement. Final gate: **approved as-is** (2026-07-04), taste decisions locked: Approach A (evolve the shipped shader), green gate packed into `uMask.g`, no legacy kill-switch flag (BEFORE captures + git revert are the A/B and rollback).

NO UNRESOLVED DECISIONS
