# HD Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load a validated local HD bundle into server physics and browser rendering as one coherent course revision, with secure asset serving and complete fallback/disposal.

**Architecture:** The server owns validated filesystem descriptors and exposes only allow-listed asset keys plus sanitized metadata. The browser verifies bytes/hashes/dimensions before constructing an HD overlay mesh; a revision handshake activates matching physics only after the primary scene is ready.

**Tech Stack:** Node.js 18+, Electron HTTP server, Three.js, browser Fetch/Crypto/ImageBitmap, existing Open-Birdie terrain/physics modules.

---

**Prerequisite:** Complete `2026-06-23-hd-compiler-foundation.md`. Use synthetic fixture
bundles until Plan 2 produces the real Bandon bundle.

## File map

- Extend `lib/hd-bundle.js` — discovery/descriptor/public metadata.
- Create `lib/hd-http.js` — allow-listed GET/HEAD/range serving.
- Modify `lib/elevation.js`, `lib/game.js`, `server.js` — terrain precedence/readiness.
- Modify `main.js` — loopback primary-client nonce handoff.
- Create `public/render/hd-bundle.js` — verified browser asset loader/disposer.
- Create `public/render/terrain-grid.js` — pure browser sampler contract.
- Create `public/render/hd-terrain.js` — high-resolution overlay mesh.
- Modify `public/render/scene.js`, `public/render/water-depth.js`, `public/render/turf.js`, `public/render/config.js`, `public/app.js`.
- Create `test/hd-server.test.js`, `test/hd-runtime-loader.test.mjs`, `test/hd-terrain-runtime.test.mjs`, `test/hd-turf.test.mjs`, `test/hd-readiness.test.js`.
- Extend `test/elevation-patch.test.js`, `test/game.test.js`.

### Task 1: Discover bundles and inject one terrain contract into physics

**Files:**

- Modify: `lib/hd-bundle.js`
- Modify: `lib/elevation.js`
- Modify: `lib/game.js`
- Modify: `test/elevation-patch.test.js`
- Modify: `test/game.test.js`
- Modify: `test/hd-bundle.test.js`

- [ ] **Step 1: Write failing discovery/precedence/physics tests**

Cover absent/rejected/valid status, duplicate fingerprints, immutable `active.json`, coarse-
grid mismatch, HD-first precedence, legacy patch default edge blend, HD `edgeBlendM: 0`,
and `Game` sampling the injected HD grid. Add a regression proving `smooth:true` preserves
raw `h(x,y)` values while deriving `grad(x,y)` from a smoothed copy.

```js
const hd = { minX: 0, minY: 0, cellM: 1, nx: 3, ny: 3,
  heights: new Array(9).fill(10), edgeBlendM: 0, kind: 'hd-hole' };
game.setCourse(course, { terrainPatches: [hd] });
assert.equal(game.terrain.h(1, 1), 10);
```

- [ ] **Step 2: Verify focused tests fail**

Run:

```powershell
node --test test/hd-bundle.test.js test/elevation-patch.test.js test/game.test.js
```

Expected: FAIL because discovery/injected patches are missing.

- [ ] **Step 3: Implement descriptor and terrain precedence**

`resolveHdBundle(course, { dataDir })` scans only immediate HD course directories up to a
hard count, reads `active.json`, validates the referenced immutable bundle, rejects duplicate
matches, and returns a server-owned descriptor. Descriptor paths/heights never attach to the
serializable course object.

Change `makeTerrain` to use `patch.edgeBlendM ?? 4`; zero means the compiler already blended
the edge. When `smooth:true`, keep the raw sampler for `h()` and use a smoothed clone only
for `grad()`. That makes rendered and physics ground heights identical while preserving
stable putting gradients. Change `Game.setCourse` to:

```js
setCourse(course, { terrainPatches = [], ready = true } = {}) {
  // existing guards/state reset
  this.terrain = course.elevation
    ? makeTerrain(course.elevation, [
        ...terrainPatches,
        ...(course.elevation.patches || []),
      ], { smooth: true })
    : flatTerrain();
  this.runtimeReady = ready;
}
```

Reject shots while `runtimeReady === false`; include `runtimeReady` in state.

- [ ] **Step 4: Run focused/full tests**

Run: `node --test test/hd-bundle.test.js test/elevation-patch.test.js test/game.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/hd-bundle.js lib/elevation.js lib/game.js test/hd-bundle.test.js test/elevation-patch.test.js test/game.test.js
git commit -m "feat(hd): inject validated terrain into physics"
```

### Task 2: Serve only validated HD assets

**Files:**

- Create: `lib/hd-http.js`
- Create: `test/hd-server.test.js`
- Modify: `server.js`

- [ ] **Step 1: Write failing HTTP tests**

Test:

- public metadata contains no absolute path or Float32 heights;
- asset keys are exactly `terrain`, `orthophoto`, `surfaces`, `coverage`;
- unknown keys/traversal/encoded separators return 404/400;
- GET and HEAD return correct MIME/length;
- one valid byte range returns 206/Content-Range;
- invalid/multiple ranges return 416;
- hash-keyed assets receive private immutable cache headers; and
- rejected/absent bundles expose safe status only.

- [ ] **Step 2: Verify it fails**

Run: `node --test test/hd-server.test.js`

Expected: FAIL because `lib/hd-http.js` and routes are missing.

- [ ] **Step 3: Implement an active-descriptor route**

Route:

```text
GET|HEAD /api/hd-assets/<bundle-id>/<asset-key>
```

`serveHdAsset(req, res, descriptor, assetKey)` maps the enum key to a path already validated
by `lib/hd-bundle.js`; it never resolves a URL filename. Add `.f32` and `.webp` MIME types.

Refactor `server.js` course activation into one `activateCourse(course)` path used by POST
load and startup cache load. Keep `activeHd`, `courseRevision`, and readiness state outside
the course object. `courseGeometry()` returns sanitized `hd` metadata only.

- [ ] **Step 4: Run focused/full tests**

Run: `node --test test/hd-server.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/hd-http.js server.js test/hd-server.test.js
git commit -m "feat(hd): serve validated bundle assets"
```

### Task 3: Load and verify all browser assets before scene ownership

**Files:**

- Create: `public/render/hd-bundle.js`
- Create: `test/hd-runtime-loader.test.mjs`

- [ ] **Step 1: Write failing browser-loader tests**

Inject `fetchImpl` and `imageDecoder`. Test terrain endian/dimension/hash/length failures,
image hash/dimension failure, abort, stale revision, partial fetch cleanup, double-dispose,
and successful texture configuration (`SRGBColorSpace` for aerial, `NoColorSpace` for masks,
clamp wrapping, mipmap generation).

```js
const assets = await loadHdBundle(meta, { fetchImpl, imageDecoder, expectedRevision: 7 });
assert.equal(assets.terrain.heights.length, meta.terrain.nx * meta.terrain.ny);
assets.dispose();
assets.dispose(); // idempotent
```

- [ ] **Step 2: Verify it fails**

Run: `node --test test/hd-runtime-loader.test.mjs`

Expected: FAIL because browser loader is missing.

- [ ] **Step 3: Implement verified all-or-nothing loading**

Use `crypto.subtle.digest('SHA-256', bytes)`, enforce response `Content-Length`, and decode
images with injected `createImageBitmap(blob, { premultiplyAlpha: 'none' })`. Do not transfer
resources to `GolfScene` until all four assets pass. `dispose()` closes ImageBitmaps and
disposes textures exactly once.

- [ ] **Step 4: Run tests**

Run: `node --test test/hd-runtime-loader.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add public/render/hd-bundle.js test/hd-runtime-loader.test.mjs
git commit -m "feat(hd): verify browser bundle assets"
```

### Task 4: Build an HD terrain overlay with sampler parity

**Files:**

- Create: `public/render/terrain-grid.js`
- Create: `public/render/hd-terrain.js`
- Create: `test/hd-terrain-runtime.test.mjs`
- Modify: `public/render/scene.js`
- Modify: `public/render/water-depth.js`

- [ ] **Step 1: Write failing parity/geometry tests**

Import the browser sampler and compare it with `lib/elevation.makeTerrain` at corners,
interior points, exact patch boundary, blend ring, and outside. Also instantiate `Game` with
the fixture and compare browser `h()` directly with `game.terrain.h()` while independently
checking the smoothed gradient contract. Assert geometry vertex/UV/`Uint32Array` index counts,
correct north/south orientation, and a coarse-mesh cutout containing no triangles whose
positive-area footprint intersects the HD rectangle. Include a fixture where HD relief is
lower than coarse terrain; it must remain visible because no coarse triangle covers it.
Assert coarse/HD boundary vertices have identical positions/heights and that the water-depth
prepass receives both terrain meshes.

- [ ] **Step 2: Verify it fails**

Run: `node --test test/hd-terrain-runtime.test.mjs`

Expected: FAIL because sampler/mesh modules are missing.

- [ ] **Step 3: Implement sampler, mesh, and disposal boundary**

Public contracts:

```js
export function makeTerrainSampler(base, patches) { /* HD, legacy, base precedence */ }
export function buildHdTerrain({ grid, bounds, material }) { /* Mesh */ }
export function buildCoarseTerrain({ grid, cutout }) { /* Mesh with HD interior removed */ }
```

Update `GolfScene.loadCourse(geo, { hdAssets = null } = {})` to set one terrain sampler used
by `hAt`, patch vertices, props, grass, ball/pin, aim, and markers. Remove coarse-grid cells
inside the exact HD rectangle, which compilation snapped to coarse cell lines. Add the HD
mesh with a shared boundary but zero positive-area overlap. Boundary heights are the
compiler-blended coarse samples, so no overlap/polygon offset is used. A plain overlay is
forbidden because lower HD terrain can be occluded; the intersection-area regression test
must fail if those coarse triangles return. Skip legacy green overlays fully contained by
the HD bounds. Change the water-depth prepass to render a group/list containing both coarse
and HD terrain meshes.

Extract `_disposeCourseGroup` using Sets for shared geometry/material/texture instances and
material arrays. If HD construction throws, dispose the entire candidate and build one
procedural scene; do not keep a partial overlay.

- [ ] **Step 4: Run focused/full tests**

Run: `node --test test/hd-terrain-runtime.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add public/render/terrain-grid.js public/render/hd-terrain.js public/render/scene.js public/render/water-depth.js test/hd-terrain-runtime.test.mjs
git commit -m "feat(hd): render unified high-resolution terrain"
```

### Task 5: Blend real macro color into the existing PBR turf stack

**Files:**

- Modify: `public/render/turf.js`
- Modify: `public/render/config.js`
- Modify: `public/render/hd-terrain.js`
- Create: `test/hd-turf.test.mjs`

- [ ] **Step 1: Write failing shader-contract tests**

Invoke `onBeforeCompile` with a minimal fake shader and assert macro/surface/coverage uniforms,
channel mapping, color-space assignment, near/far weighting, water/bunker authority, and
texture disposal registration. Test the legacy call path remains unchanged when no macro is
provided.

- [ ] **Step 2: Verify it fails**

Run: `node --test test/hd-turf.test.mjs`

Expected: FAIL because macro options are missing.

- [ ] **Step 3: Refactor to an options contract and add scale-separated blending**

```js
makeTurfMaterial({
  baseMap, mownMask, bunkerMask, bounds, anisotropy,
  macro: hdAssets ? {
    albedo: hdAssets.orthophoto,
    surfaces: hdAssets.surfaces,
    coverage: hdAssets.coverage,
    bounds: hdAssets.terrain.bounds,
    closeWeight: RENDER_CONFIG.hdMacroCloseWeight,
    farWeight: RENDER_CONFIG.hdMacroFarWeight,
  } : null,
});
```

Aerial RGB contributes only low-frequency color. Existing tiled PBR normal/roughness/detail
and nearby grass geometry remain. Coverage R gates aerial; surface RGBA controls fairway/
green/tee/bunker; coverage G marks water. Existing bunker/water geometry wins. Add an
`hdMacro` feature flag and conservative close/far weights; visual tuning waits for Plan 4.

- [ ] **Step 4: Run focused/full tests**

Run: `node --test test/hd-turf.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add public/render/turf.js public/render/config.js public/render/hd-terrain.js test/hd-turf.test.mjs
git commit -m "feat(hd): blend aerial macro color into PBR turf"
```

### Task 6: Activate matching physics only after coherent scene readiness

**Files:**

- Create: `test/hd-readiness.test.js`
- Modify: `server.js`
- Modify: `main.js`
- Modify: `public/app.js`
- Modify: `public/render/scene.js`
- Modify: `public/style.css`

- [ ] **Step 1: Write failing revision/readiness tests**

Test HD success, client HD failure→procedural activation, stale revision rejection, duplicate
acknowledgement, shots blocked while pending, startup non-HD immediate readiness, wrong nonce,
non-loopback acknowledgement, and a LAN mirror racing both before and after the Electron
primary client. Also test that rejected/load-failed bundles expose an exact safe reason in
state/UI while normal absence remains quiet. Reserve a development-only
`hdVerifyMode=procedural|hd` query contract: it is honored only for a loopback primary with a
valid nonce; LAN clients cannot select mode. Fresh-process/revision creation belongs to the
capture harness in Plan 4, not this query flag.

- [ ] **Step 2: Verify it fails**

Run: `node --test test/hd-readiness.test.js`

Expected: FAIL because readiness route/state is missing.

- [ ] **Step 3: Implement the readiness handshake and SSE race guard**

Route:

```text
POST /api/course-runtime-ready
{ "courseRevision": 7, "bundleId": "...", "mode": "hd" | "procedural", "primaryNonce": "..." }
```

For valid HD, server holds decoded terrain but sets `runtimeReady:false`. Browser changes
`loadGeometry()` to await all HD resources and `scene.loadCourse()`, then acknowledges `hd`.
On load/construction failure it fully rebuilds procedural and acknowledges `procedural`.
Server installs matching terrain and unlocks shots only after a valid current revision ack.

`server.js` generates a cryptographically random primary nonce. `main.js` receives it through
the local module interface and appends it only to the loopback Electron URL. Headless mode
offers a loopback-only nonce bootstrap endpoint. Readiness POSTs require both loopback remote
address and constant-time nonce match; LAN mirrors can render but cannot activate a revision.
Remove the nonce from visible error messages/logs.

For later matched captures, the primary loader recognizes `hdVerifyMode=procedural|hd` only
when the nonce/loopback checks pass. Procedural mode intentionally skips bundle loading and
acks procedural; HD mode follows the normal path. This switch is disabled for ordinary
sessions and cannot change an activated revision. Bootstrap it only when the server process
starts with `BIRDIE_HD_VERIFY_MODE=procedural|hd`; `server.js` exports that validated mode
and its generated nonce to the local Electron entrypoint, which appends both to the first
loopback URL. There is no endpoint that changes verification mode after startup.

While geometry is loading, `public/app.js` stores incoming SSE state and never calls
`scene.setHole()` against the prior course. Show a small noninteractive “preparing course”
state while shots are locked. For a rejected/load-failed bundle, show the exact safe reason
and chosen procedural fallback; bundle absence produces no warning.

- [ ] **Step 4: Run all runtime tests**

Run:

```powershell
node --test test/hd-bundle.test.js test/hd-server.test.js test/hd-readiness.test.js test/hd-runtime-loader.test.mjs test/hd-terrain-runtime.test.mjs test/hd-turf.test.mjs
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server.js main.js public/app.js public/render/scene.js public/style.css test/hd-readiness.test.js
git commit -m "feat(hd): activate coherent course revisions"
```

## Plan 3 completion gate

- [ ] Absolute paths and terrain arrays never leak through course JSON.
- [ ] Asset requests are key-allow-listed and range-safe.
- [ ] Browser verifies every asset before handing ownership to the scene.
- [ ] Physics and renderer pass sampler parity tests.
- [ ] HD load failure results in one complete procedural state.
- [ ] Shots remain locked until the matching scene/physics revision is ready.
- [ ] Repeated load/unload has no monotonically growing Three resource counts.
- [ ] `npm test` passes.
