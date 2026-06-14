# Tier 0 — Light & Atmosphere Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the procedural Preetham sky + band-aid exposure with a real CC0 HDRI environment (background + image-based lighting + ground-projected horizon) and aerial-perspective fog, so the scene's light, color, and horizon read as a believable real-world golf course before any further detail is added.

**Architecture:** Extract sky/light/atmosphere out of `scene.js` into three focused modules — `env.js` (HDRI load → PMREM env + background + sun direction), `atmosphere.js` (horizon-matched fog), and supporting `config.js` (feature flags) + `hdri-analyze.js` (pure, node-testable HDRI sun/horizon math) + `assets.js` (offline asset paths). `scene.js` becomes the orchestrator: it kicks off the async env load in the constructor, exposes `envReady`, and places the `GroundedSkybox` in `loadCourse` once course bounds exist. A single `this.sunDir` remains the source of truth for the directional light + shadow camera.

**Tech Stack:** three.js r0.184 (`RGBELoader`, `PMREMGenerator`, `GroundedSkybox`, `FogExp2`), vanilla ES modules served via the existing `/vendor/three/` importmap, Node's built-in `node --test` + `node:assert` for pure-helper unit tests, and the project's headless WebGL capture harness (preview_eval → canvas → local sink → image) for visual verification.

---

## Testing approach (read first)

This is WebGL/visual code with **no existing test framework** and browser-only render paths. We adapt TDD honestly:

- **Pure logic** (HDRI sun-direction + horizon-color math, config defaults) → real failing-first unit tests with `node --test` (zero new deps).
- **Visual integration** (env, skybox, fog, exposure) → **goal-driven empirical verification**: render the two fixed Augusta frames through the capture harness and assert a **measurable acceptance** — a luminance histogram computed in-browser over the turf region with **no large near-white clip spike** and turf mean luminance landing in a target mid-range. This is the §6 verification + §4 Tier-0 acceptance from the spec, made concrete.

> **Execution environment:** the host shell is Windows PowerShell, but a POSIX **Bash tool is available** — run all `curl`/`mkdir -p`/`grep`/`head`/`node tmp-sink.js` style steps below **via the Bash tool**, not PowerShell (they use `/dev/null`, `-p`, etc.).

Reference: [design spec](../specs/2026-06-14-photoreal-renderer-design.md).

---

## Pre-flight: acquire the CC0 HDRI asset

- [ ] **Step P1: Create the asset directory**

```bash
mkdir -p public/assets/hdri
```

- [ ] **Step P2: Download a CC0 HDRI (Poly Haven, 4K) and commit it offline**

Primary choice: `meadow` (partly cloudy parkland, soft midday sun — good general golf light). Run:

```bash
curl -L -o public/assets/hdri/meadow_4k.hdr \
  "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/meadow_4k.hdr"
```

Expected: a ~10–25 MB `.hdr` file. Verify it's a real HDR, not an HTML error page:

```bash
ls -lh public/assets/hdri/meadow_4k.hdr && head -c 11 public/assets/hdri/meadow_4k.hdr
```

Expected: file is multi-MB and the first bytes are `#?RADIANCE`. If the download 404s or is tiny, fall back to another CC0 Poly Haven HDRI (e.g. `kloofendal_48d_partly_cloudy_puresky_4k.hdr`, `syferfontein_18d_clear_4k.hdr`, `qwantani_puresky_4k.hdr`) by swapping the filename in the URL, and update `ASSETS.md` + `assets.js` accordingly.

- [ ] **Step P3: Record attribution**

Create `ASSETS.md` at repo root (or append if it exists):

```markdown
# Bundled CC0 Assets

All assets below are CC0 (public domain) unless noted. No attribution is legally required for CC0; recorded here for provenance.

## HDRIs
- `public/assets/hdri/meadow_4k.hdr` — "Meadow" by Poly Haven (CC0). Source: https://polyhaven.com/a/meadow
```

- [ ] **Step P4: Commit the asset**

```bash
git add public/assets/hdri/meadow_4k.hdr ASSETS.md
git commit -m "assets: bundle CC0 meadow 4K HDRI for renderer env"
```

> Note: `data/courses/` and `.shots/` are gitignored (capture evidence goes in `.shots/`, with a leading dot); `public/assets/` is NOT — the HDRI is meant to ship in-repo.

---

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `public/render/config.js` | Feature flags + quality knobs, single import | Create |
| `public/render/hdri-analyze.js` | Pure math: sun direction + horizon color from equirect float data (no three import) | Create |
| `public/render/assets.js` | Offline asset path registry | Create |
| `public/render/env.js` | HDRI → PMREM env + background, directional sun from `sunDir`, `GroundedSkybox` factory | Create |
| `public/render/atmosphere.js` | Horizon-matched `FogExp2` | Create |
| `public/render/scene.js` | Orchestrate: async env load, `envReady`, place skybox in `loadCourse`, exposure rebalance | Modify (`_setupSkyAndLights` 112–150, constructor 49–63, `loadCourse` ~201, imports) |
| `test/hdri-analyze.test.mjs` | Unit tests for the pure HDRI math | Create |
| `test/config.test.mjs` | Unit test for config defaults | Create |
| `ASSETS.md` | CC0 provenance | Create (pre-flight) |

`node --test` discovers `test/**/*.test.mjs`. Add a `test` script in Task 1.

---

## Task 1: Feature-flag config module

**Files:**
- Create: `public/render/config.js`
- Create: `test/config.test.mjs`
- Modify: `package.json` (add `test` script)

- [ ] **Step 1: Write the failing test**

`test/config.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RENDER_CONFIG } from '../public/render/config.js';

test('tier-0 systems default on, heavy/stretch systems default off', () => {
  assert.equal(RENDER_CONFIG.hdriEnv, true);
  assert.equal(RENDER_CONFIG.groundedSky, true);
  assert.equal(RENDER_CONFIG.aerialFog, true);
  assert.equal(RENDER_CONFIG.volumetricClouds, false);
  assert.equal(RENDER_CONFIG.dof, false);
});

test('exposure + env intensity are numbers in sane range', () => {
  assert.ok(RENDER_CONFIG.toneMappingExposure > 0 && RENDER_CONFIG.toneMappingExposure < 3);
  assert.ok(RENDER_CONFIG.environmentIntensity > 0 && RENDER_CONFIG.environmentIntensity <= 2);
});
```

- [ ] **Step 2: Add the `test` script and run to verify it fails**

Add to `package.json` `scripts`: `"test": "node --test"`.

Run: `npm test`
Expected: FAIL — `Cannot find module '../public/render/config.js'`.

- [ ] **Step 3: Write minimal implementation**

`public/render/config.js`:

```js
// Single source of feature flags + quality knobs for the renderer.
// Toggle a system off here to isolate regressions or hit a perf budget.
export const RENDER_CONFIG = {
  // Tier 0 (foundation) — on by default
  hdriEnv: true,
  groundedSky: true,
  aerialFog: true,
  // Tier 0 tunables (rebalanced empirically in Task 7)
  toneMappingExposure: 0.6,
  environmentIntensity: 1.0,
  sunIntensity: 2.0,
  fogDensity: 0.00016,
  skyboxHeight: 30, // GroundedSkybox projection height (world meters); tuned in Task 7
  hdriFile: 'meadow_4k.hdr',
  // Later tiers / stretch — off until their tier lands
  foliageTrees: false,
  pbrTurf: false,
  groundGrass: false,
  gtao: false,
  dof: false,
  volumetricClouds: false,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (both config tests).

- [ ] **Step 5: Commit**

```bash
git add public/render/config.js test/config.test.mjs package.json
git commit -m "feat(render): add feature-flag config module"
```

---

## Task 2: Pure HDRI analysis (sun direction + horizon color)

Pure functions, no `three` import, so they unit-test in node and run in the browser. Convention: equirect data is row-major RGBA float, `u` across width = azimuth `[0,2π)`, `v` down height = colatitude (row 0 = zenith, last row = nadir). Returns sim-friendly spherical so the caller builds a `THREE.Vector3`.

**Files:**
- Create: `public/render/hdri-analyze.js`
- Create: `test/hdri-analyze.test.mjs`

- [ ] **Step 1: Write the failing tests**

`test/hdri-analyze.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunSphericalFromEquirect, horizonColorFromEquirect } from '../public/render/hdri-analyze.js';

// Build a tiny equirect: dark everywhere, one very bright texel.
function makeEquirect(w, h, brightX, brightY, rgb = [50, 50, 50]) {
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 0.2; data[i * 4 + 1] = 0.2; data[i * 4 + 2] = 0.2; data[i * 4 + 3] = 1;
  }
  const idx = (brightY * w + brightX) * 4;
  data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2]; data[idx + 3] = 1;
  return { data, width: w, height: h };
}

test('sun azimuth/altitude derive from the brightest texel', () => {
  // bright texel at u = 1/4 width (az = π/2), v = 1/4 height (high in the sky)
  const { data, width, height } = makeEquirect(16, 8, 4, 2);
  const s = sunSphericalFromEquirect(data, width, height);
  assert.ok(Math.abs(s.azimuth - Math.PI / 2) < 0.5, `az ${s.azimuth}`);
  assert.ok(s.altitude > 0.4, `alt should be well above horizon, got ${s.altitude}`);
});

test('a texel on the bottom half yields a below-or-near-horizon altitude', () => {
  const { data, width, height } = makeEquirect(16, 8, 8, 6); // v = 6/8, below mid
  const s = sunSphericalFromEquirect(data, width, height);
  assert.ok(s.altitude < 0.3, `alt ${s.altitude}`);
});

test('horizon color samples the mid rows and returns a 0xRRGGBB int', () => {
  const c = horizonColorFromEquirect(new Float32Array(16 * 8 * 4).fill(0.5), 16, 8);
  assert.equal(typeof c, 'number');
  assert.ok(c >= 0 && c <= 0xffffff);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`public/render/hdri-analyze.js`:

```js
// Pure analysis of an equirectangular HDRI's float pixel data.
// No three.js import so it runs in node tests and the browser alike.
// data: Float32Array RGBA, row-major. Row 0 = zenith, last row = nadir.

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Brightest texel -> { azimuth (rad, 0..2π), altitude (rad, -π/2..π/2) }.
// step samples a subset for speed on large (4K) images.
export function sunSphericalFromEquirect(data, width, height, step = 2) {
  let best = -Infinity, bx = 0, by = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const L = lum(data[i], data[i + 1], data[i + 2]);
      if (L > best) { best = L; bx = x; by = y; }
    }
  }
  const azimuth = ((bx + 0.5) / width) * Math.PI * 2;
  const colatitude = ((by + 0.5) / height) * Math.PI; // 0 = zenith
  const altitude = Math.PI / 2 - colatitude;           // + above horizon
  return { azimuth, altitude };
}

// Average color of the rows near the horizon (v ≈ 0.5), tone-mapped to 0xRRGGBB.
export function horizonColorFromEquirect(data, width, height) {
  const y0 = Math.floor(height * 0.46), y1 = Math.ceil(height * 0.54);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  r /= n; g /= n; b /= n;
  // simple Reinhard + gamma so the fog tint matches the displayed sky, not raw HDR
  const enc = (c) => Math.min(255, Math.round(Math.pow(c / (1 + c), 1 / 2.2) * 255));
  return (enc(r) << 16) | (enc(g) << 8) | enc(b);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (all hdri-analyze tests + earlier config tests).

- [ ] **Step 5: Commit**

```bash
git add public/render/hdri-analyze.js test/hdri-analyze.test.mjs
git commit -m "feat(render): pure HDRI sun/horizon analysis with tests"
```

---

## Task 3: Asset path registry

Tiny indirection so paths live in one place and `config.hdriFile` selects the HDRI.

**Files:**
- Create: `public/render/assets.js`

- [ ] **Step 1: Write the module**

`public/render/assets.js`:

```js
import { RENDER_CONFIG } from './config.js';

const BASE = '/assets/';
export const ASSETS = {
  hdri: () => `${BASE}hdri/${RENDER_CONFIG.hdriFile}`,
};
```

- [ ] **Step 2: Sanity check it imports**

Run: `node --input-type=module -e "import('./public/render/assets.js').then(m=>console.log(m.ASSETS.hdri()))"`
Expected: prints `/assets/hdri/meadow_4k.hdr`.

- [ ] **Step 3: Commit**

```bash
git add public/render/assets.js
git commit -m "feat(render): asset path registry"
```

---

## Task 4: Environment module (HDRI env + background + sun)

Loads the HDRI, builds the PMREM env, sets background, derives `sunDir` via Task 2, and builds the directional sun. Async; returns a promise the scene awaits.

**Files:**
- Create: `public/render/env.js`

- [ ] **Step 1: Write the module**

`public/render/env.js`:

```js
import * as THREE from 'three';
// HDRLoader, not RGBELoader: RGBELoader is a deprecated shim in r0.184 that logs a
// console.warn on construction, which would trip our "no console warnings" gate.
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { sunSphericalFromEquirect, horizonColorFromEquirect } from './hdri-analyze.js';
import { RENDER_CONFIG } from './config.js';
import { ASSETS } from './assets.js';

// sim -> three (matches scene.js V()): x east, z up, -y north
const sunVec = (azimuth, altitude) => {
  const x = Math.cos(altitude) * Math.sin(azimuth);
  const y = Math.cos(altitude) * Math.cos(azimuth);
  const z = Math.sin(altitude);
  return new THREE.Vector3(x, z, -y).normalize();
};

// Loads HDRI, returns { envTexture, equirect, sunDir, horizonColor }.
export async function loadHDRIEnvironment(renderer) {
  const equirect = await new HDRLoader().setDataType(THREE.FloatType).loadAsync(ASSETS.hdri());
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromEquirectangular(equirect).texture;
  pmrem.dispose();

  const { data, width, height } = equirect.image;
  const { azimuth, altitude } = sunSphericalFromEquirect(data, width, height);
  const sunDir = sunVec(azimuth, Math.max(altitude, THREE.MathUtils.degToRad(8))); // floor so shadows read
  const horizonColor = horizonColorFromEquirect(data, width, height);
  return { envTexture, equirect, sunDir, horizonColor };
}

// Directional key light. Given an initial aim along sunDir; _fitShadows refines
// position/frustum per hole. (Direction = sun.position - sun.target; target is at origin.)
export function makeSun(sunDir) {
  const sun = new THREE.DirectionalLight(0xfff4e0, RENDER_CONFIG.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.35;
  sun.position.copy(sunDir).multiplyScalar(700); // initial aim before first _fitShadows
  return sun;
}

// Ground-projected HDRI dome so the horizon meets the course edge.
// radius/height derived from course bounds (sim meters).
export function makeGroundedSkybox(equirect, bounds) {
  const spanX = bounds.maxX - bounds.minX, spanY = bounds.maxY - bounds.minY;
  const radius = Math.max(spanX, spanY) * 1.6 + 600;
  const height = RENDER_CONFIG.skyboxHeight; // projection height; tuned in Task 7
  const sky = new GroundedSkybox(equirect, height, radius);
  // REQUIRED: GroundedSkybox flattens its lower hemisphere to local y = -height;
  // lifting by +height puts the projected ground at world y ≈ 0 (the course plane).
  // Omitting this sinks the horizon ground below the course — the exact failure we're fixing.
  sky.position.y = height;
  sky.name = 'groundedSky';
  return sky;
}
```

- [ ] **Step 2: Verify the module parses (browser import path)**

It imports `three` + addons, so it only fully resolves in the browser. Confirm no syntax error:
Run: `node --check public/render/env.js`
Expected: no output (exit 0). (Full runtime resolution is verified in Task 7's render.)

- [ ] **Step 3: Commit**

```bash
git add public/render/env.js
git commit -m "feat(render): HDRI environment module (env, sun, grounded skybox)"
```

---

## Task 5: Atmosphere module (horizon-matched fog)

**Files:**
- Create: `public/render/atmosphere.js`

- [ ] **Step 1: Write the module**

`public/render/atmosphere.js`:

```js
import * as THREE from 'three';
import { RENDER_CONFIG } from './config.js';

// Exponential-squared fog tinted to the HDRI horizon = real aerial perspective,
// not a flat grey veil. No hard far-plane cutoff (unlike linear THREE.Fog).
export function makeAerialFog(horizonColor) {
  return new THREE.FogExp2(horizonColor, RENDER_CONFIG.fogDensity);
}
```

- [ ] **Step 2: Verify it parses**

Run: `node --check public/render/atmosphere.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add public/render/atmosphere.js
git commit -m "feat(render): aerial-perspective fog module"
```

---

## Task 6: Wire env + atmosphere into scene.js (replace Preetham, remove band-aids)

**Files:**
- Modify: `public/render/scene.js` — imports (top, ~1–7); constructor fog (59) + exposure (55); `_setupSkyAndLights` (112–150); `loadCourse` skybox placement (~201).

- [ ] **Step 1: Update imports**

In `scene.js` replace the `Sky` import (line 5) with the new modules:

```js
// remove: import { Sky } from 'three/addons/objects/Sky.js';
import { loadHDRIEnvironment, makeSun, makeGroundedSkybox } from './env.js';
import { makeAerialFog } from './atmosphere.js';
import { RENDER_CONFIG } from './config.js';
```

- [ ] **Step 2: Exposure + remove constructor fog**

`scene.js:55` — change `this.renderer.toneMappingExposure = 0.45;` →
```js
this.renderer.toneMappingExposure = RENDER_CONFIG.toneMappingExposure;
```
`scene.js:59` — delete the constructor `this.scene.fog = new THREE.Fog(...)` line (fog is now set when the HDRI horizon color is known, in `_setupSkyAndLights`).

- [ ] **Step 3: Replace `_setupSkyAndLights` body**

Replace the entire method (112–150) with an async-kickoff version. It sets a temporary neutral background, then applies HDRI env/sun/fog when the load resolves; `this.envReady` lets callers await it.

```js
_setupSkyAndLights() {
  // neutral hold until the HDRI resolves (avoids a black flash)
  this.scene.background = new THREE.Color(0x9fb8cf);
  // sun must exist before first frame / first _fitShadows; aim updated on load
  this.sunDir = new THREE.Vector3().setFromSphericalCoords(
    1, THREE.MathUtils.degToRad(60), THREE.MathUtils.degToRad(135));
  this.sun = makeSun(this.sunDir);
  this.scene.add(this.sun, this.sun.target);

  this.envReady = loadHDRIEnvironment(this.renderer).then(({ envTexture, equirect, sunDir, horizonColor }) => {
    this.scene.environment = envTexture;
    this.scene.environmentIntensity = RENDER_CONFIG.environmentIntensity;
    this.scene.background = envTexture;
    this._equirect = equirect;
    this.sunDir.copy(sunDir);
    if (RENDER_CONFIG.aerialFog) this.scene.fog = makeAerialFog(horizonColor);
    if (this.bounds) this._placeSkybox(); // course already loaded
    if (this._activeHole) this._fitShadows(this._activeHole); // re-aim shadows to HDRI sun
  }).catch((e) => { console.error('[env] HDRI load failed', e); });
}

_placeSkybox() {
  if (!RENDER_CONFIG.groundedSky || !this._equirect || !this.bounds) return;
  if (this._skybox) { this.scene.remove(this._skybox); this._skybox.geometry?.dispose(); }
  this._skybox = makeGroundedSkybox(this._equirect, this.bounds);
  this.scene.add(this._skybox);
}
```

> Removed: the `Sky` object, its uniforms, `pmrem.fromScene`, the `environmentIntensity = 0.5` band-aid, and the `HemisphereLight` (the HDRI env now provides fill). If verification shows shadowed areas are too dark, re-add a low `HemisphereLight` in Task 7 as a tunable.

- [ ] **Step 4: Place the skybox + record active hole**

In `loadCourse`, after `this.bounds = b;` (line 201) add:
```js
this._placeSkybox();
```
Find where the active hole is set for `_fitShadows` (the caller around `scene.js:487`); store it so the env-load callback can re-aim shadows. In that method add `this._activeHole = hole;` immediately before `this._fitShadows(hole);`.

- [ ] **Step 5: Verify no syntax error + server boots**

Run: `node --check public/render/scene.js`
Expected: exit 0.
Then confirm the dev server serves the new files (preview server already runs on 8222):
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8222/render/env.js`
Expected: `200`.

- [ ] **Step 6: Commit**

```bash
git add public/render/scene.js
git commit -m "feat(render): HDRI env + grounded skybox + aerial fog in scene"
```

---

## Task 7: Visual verification + exposure rebalance (goal-driven loop)

The acceptance gate from the spec: on the two fixed Augusta frames, the midground/horizon turf must no longer clip toward white, and the horizon must be full (HDRI/skybox visible past the course). We measure it in-browser.

**Files:** none (verification + tuning `config.js` only).

- [ ] **Step 1: Reload the preview and await env**

Ensure the preview server (8222) is running with Augusta cached (it is, from earlier setup). In the preview page, reload and wait for the HDRI:
```
preview_eval: (async () => { location.reload(); })()
```
Then (after reload) await readiness:
```
preview_eval: (async () => { await window.__birdie.scene.envReady; return { hasFog: !!window.__birdie.scene.scene.fog, hasSkybox: !!window.__birdie.scene._skybox, sunDir: window.__birdie.scene.sunDir.toArray() }; })()
```
Expected: `hasFog: true`, `hasSkybox: true`, a plausible `sunDir`.

- [ ] **Step 2: Capture the two Augusta frames + luminance histogram**

Start the throwaway sink (`node tmp-sink.js`, port 9100 — recreate the small sink server if absent; see memory `preview-webgl-screenshots`; point its output dir at `.shots/`). For each of the two framings (hole-1 tee POV; long par-5), set the camera as in the prior session, then:
```
preview_eval: (async () => {
  const s = window.__birdie.scene; await s.envReady;
  s.resize(); s._snapIdleCam(); s.postfx.render();
  const c = document.querySelector('#scene canvas');
  // luminance histogram over the lower-center turf region.
  // NOTE: gl.readPixels origin is BOTTOM-left, so the turf (lower screen) is the LOW y band.
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const W=c.width,H=c.height, x0=W*0.3|0,x1=W*0.7|0,y0=H*0.05|0,y1=H*0.45|0;
  const px=new Uint8Array((x1-x0)*(y1-y0)*4);
  gl.readPixels(x0,y0,(x1-x0),(y1-y0),gl.RGBA,gl.UNSIGNED_BYTE,px);
  let sum=0,white=0,n=px.length/4;
  for(let i=0;i<px.length;i+=4){const L=0.2126*px[i]+0.7152*px[i+1]+0.0722*px[i+2];sum+=L;if(L>245)white++;}
  const dataURL=c.toDataURL('image/jpeg',0.82);
  await fetch('http://localhost:9100',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'tier0-h1',dataURL})});
  return { meanLum: sum/n, whiteFrac: white/n };
})()
```
Acceptance thresholds (turf region): `whiteFrac < 0.02` (no white-clip wash) and `meanLum` roughly `70–150` (mid-range, not blown out, not black). Read the saved JPEGs to eyeball horizon fullness + color consistency.

- [ ] **Step 3: Rebalance if outside thresholds**

If `whiteFrac` high / `meanLum` > 150 → lower `RENDER_CONFIG.toneMappingExposure` (e.g. 0.6 → 0.5) and/or `environmentIntensity` (1.0 → 0.8). If too dark (`meanLum` < 70) → raise them, or re-add a low `HemisphereLight(0xaeccff, 0x46603a, 0.15)` in `_setupSkyAndLights`. Edit `config.js`, reload, re-capture. Loop until both frames pass. Keep changes in `config.js` so they're centralized.

- [ ] **Step 4: Compare against the pre-Tier-0 baseline**

The earlier assessment captures are the "before" (they live in `shots/` from the prior session; copy them into `.shots/` to keep before/after together). Save the new ones as `.shots/tier0-h1.jpg` / `.shots/tier0-long.jpg` and confirm the qualitative wins: full believable horizon, no white-out midground, consistent light. (`.shots/` is gitignored — evidence, not committed.)

- [ ] **Step 5: Commit any tuning**

```bash
git add public/render/config.js public/render/scene.js
git commit -m "chore(render): rebalance exposure/env for HDRI (tier 0)"
```

---

## Task 8: Cleanup + docs

- [ ] **Step 1: Confirm `Sky` is fully unused**

Run: `grep -rn "Sky" public/render/` — expect only `GroundedSkybox`/`skybox` references, no leftover `objects/Sky.js` import. Remove any dead Preetham remnants.

- [ ] **Step 2: Update the renderer doc note**

If a renderer doc/section exists (per the spec's module map), note the new modules (`env.js`, `atmosphere.js`, `config.js`, `hdri-analyze.js`, `assets.js`) and that lighting now comes from a bundled HDRI. Update `ASSETS.md` if the HDRI choice changed during verification.

- [ ] **Step 3: Final test + commit**

Run: `npm test`
Expected: PASS (config + hdri-analyze).
```bash
rm -f tmp-sink.js                       # remove the throwaway capture sink
git add docs/ public/render/ ASSETS.md  # explicit paths — do NOT `git add -A` (avoids staging .shots/ stragglers / tmp files)
git commit -m "docs(render): note HDRI env modules for tier 0"
```

---

## Done criteria (Tier 0)

- [ ] `npm test` passes (config + HDRI math).
- [ ] App boots offline; HDRI loads; `envReady` resolves; no console errors / WebGL sampler warnings.
- [ ] Both Augusta frames meet the luminance acceptance (`whiteFrac < 0.02`, `meanLum` 70–150) and show a full, believable horizon via the GroundedSkybox.
- [ ] `this.sunDir` drives both the directional light and `_fitShadows`; shadows agree with the HDRI sun.
- [ ] Band-aids removed (`toneMappingExposure 0.45`, `environmentIntensity 0.5`, hardcoded Preetham sun); values now centralized in `config.js`.
- [ ] Before/after captures saved as evidence.

## Open questions deferred to later (do NOT solve here)
- Per-course HDRI selection (biome-keyed) — Tier-later.
- Dual-color depth fog via `onBeforeCompile` — FogExp2 is the Tier-0 choice (YAGNI); revisit only if aerial perspective reads flat.
- MSAA composer target for `alphaToCoverage` — Tier-1 fork (foliage edges), not needed for Tier 0.
