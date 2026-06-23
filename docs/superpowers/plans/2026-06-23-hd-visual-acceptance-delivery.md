# HD Visual Acceptance and Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce repeatable visual/performance evidence for Bandon Dunes Hole 1, document actual costs and limitations, and make a go/no-go decision before full-course work.

**Architecture:** Checked-in camera poses drive identical procedural/HD captures in a hidden Electron verification window. A deterministic camera path records frame timing and conservative decoded GPU resource estimates; human visual review remains explicit because pixel hashes are not portable across GPUs.

**Tech Stack:** Electron `BrowserWindow`/`webContents.capturePage`, Three.js renderer diagnostics, Node.js reports, existing Open-Birdie server, `@browse`, `@benchmark`, `@verification-before-completion`.

---

**Prerequisites:** Complete and integrate Plans 2 and 3 on the same branch. A validated local
Bandon Hole 1 bundle must be active.

## File map

- Create `tools/hd-course/cameras/bandon-dunes-hole-01.json` — fixed views/path.
- Create `tools/capture-hd-hole.cjs` — procedural/HD screenshots.
- Create `tools/benchmark-hd-hole.cjs` — warm-up, fixed path, timing/memory report.
- Create `test/hd-verification-tools.test.js` — pose/report calculations.
- Modify `public/render/scene.js` — development-only verification camera/metrics API.
- Modify `package.json` — capture/benchmark scripts.
- Create `docs/research/2026-06-23-bandon-hd-hole-01-results.md` — measured report.
- Modify `README.md`, `ASSETS.md`, `CHANGELOG.md`, `docs/visual-upgrade-plan.md`.

### Task 1: Add deterministic camera poses and verification hooks

**Files:**

- Create: `tools/hd-course/cameras/bandon-dunes-hole-01.json`
- Create: `test/hd-verification-tools.test.js`
- Modify: `public/render/scene.js`

- [ ] **Step 1: Write failing pose/metrics tests**

The JSON contains `tee`, `landing`, `approach`, and a timestamped camera path. Tests reject
non-finite/out-of-bounds poses and verify 1%-low calculation from frame durations:

```js
assert.equal(onePercentLowFps(new Array(99).fill(16).concat([25])), 40);
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/hd-verification-tools.test.js`

Expected: FAIL because pose/report helpers do not exist.

- [ ] **Step 3: Implement development verification hooks**

Expose through existing `window.__birdie.scene` only:

```js
scene.setVerificationCamera(pose);
scene.runVerificationPath(path, { warmupMs, sampleMs });
scene.resourceSnapshot();
```

The production renderer behavior is unchanged unless these methods are called. The fixed
views must show the tee, main landing area, and green approach with identical sun/exposure/
quality settings in procedural and HD modes.

- [ ] **Step 4: Run focused/full tests**

Run: `node --test test/hd-verification-tools.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tools/hd-course/cameras/bandon-dunes-hole-01.json public/render/scene.js test/hd-verification-tools.test.js
git commit -m "test(hd): add fixed visual verification views"
```

### Task 2: Capture matched procedural and HD evidence

**Files:**

- Create: `tools/capture-hd-hole.cjs`
- Modify: `package.json`

- [ ] **Step 1: Add a failing capture contract test**

Extend `test/hd-verification-tools.test.js` to validate CLI arguments, output naming, and a
nonblank-image detector using PNGJS. Do not assert cross-GPU pixel hashes.

- [ ] **Step 2: Verify it fails**

Run: `node --test test/hd-verification-tools.test.js`

Expected: FAIL because capture helpers are missing.

- [ ] **Step 3: Implement hidden Electron capture**

The orchestrator launches a fresh child Electron process for each mode/temporary port with
`BIRDIE_HD_VERIFY_MODE=procedural|hd`. Each child starts a new server process state and course
revision, obtains the newly generated primary nonce through the local server module export,
and opens one primary loopback `BrowserWindow` with the validated mode/nonce query. In
procedural mode the primary loader skips HD and acknowledges procedural; HD mode follows the
normal loader. The child captures its three poses and exits before the other mode starts, so
no activated revision is reused or switched.

Add:

```json
"capture:hd-hole": "electron tools/capture-hd-hole.cjs"
```

Outputs remain ignored under:

```text
.shots/hd-hole-01/procedural/{tee,landing,approach}.png
.shots/hd-hole-01/hd/{tee,landing,approach}.png
```

- [ ] **Step 4: Run capture and browser review**

Run: `npm run capture:hd-hole`

Expected: six nonblank 1920×1080 captures with identical lighting/cameras.

Use `@browse`/visual inspection to confirm:

- aerial/OSM alignment within approximately 2 m at chosen landmarks;
- no patch edge, tile seam, stretching, mirrored Y, or inconsistent acquisition seam;
- real macro variation survives from tee/landing/approach;
- close turf still has PBR shading and grass silhouettes; and
- water/bunker geometry remains authoritative.

- [ ] **Step 5: Commit tool/script changes only**

```powershell
git add tools/capture-hd-hole.cjs package.json package-lock.json test/hd-verification-tools.test.js
git commit -m "test(hd): capture matched prototype views"
```

Do not commit `.shots/`.

### Task 3: Benchmark load, frame timing, and decoded resource budget

**Files:**

- Create: `tools/benchmark-hd-hole.cjs`
- Modify: `package.json`
- Modify: `test/hd-verification-tools.test.js`

- [ ] **Step 1: Write failing metric-calculation tests**

Test warm-up exclusion, average FPS, percentile/1%-low, startup-to-HD-ready time, bundle byte
sum, conservative texture mip estimate (`width * height * 4 * 4/3` per RGBA texture),
terrain/geometry buffer estimate, and threshold verdicts.

- [ ] **Step 2: Verify it fails**

Run: `node --test test/hd-verification-tools.test.js`

Expected: FAIL because benchmark helpers are missing.

- [ ] **Step 3: Implement repeatable hidden Electron benchmark**

Add:

```json
"benchmark:hd-hole": "electron tools/benchmark-hd-hole.cjs"
```

Clear Electron HTTP cache, load once, wait for readiness, warm up for at least 5 seconds,
then run the fixed path for at least 15 seconds. Write JSON containing environment, bundle
ID/bytes, startup-to-ready milliseconds, average/1%-low FPS, decoded resource estimate,
and `renderer.info.memory` counts. Create the verification window with `show:false`, fixed
1920×1080 content size, `useContentSize:true`, and `backgroundThrottling:false`; set zoom/DPR
to 1 and verify the captured canvas dimensions. Before `app.ready`, request device scale 1.
Record `document.hidden`, display refresh rate/scale factor, Electron GPU feature status,
WebGL vendor/renderer, actual DPR, and whether hardware acceleration is active. Abort rather
than report an FPS pass if rendering is software, throttled, or wrong-sized. Actual VRAM is
not available reliably through WebGL;
label the 250 MB comparison as a conservative estimate.

- [ ] **Step 4: Run benchmark**

Run: `npm run benchmark:hd-hole`

Expected on the current RTX 3060/1920×1080:

- average frame time ≤ 16.8 ms, or delivered FPS ≥99% of the measured 59–60 Hz refresh cap;
- 1%-low FPS ≥ 45;
- local load < 5 seconds; and
- decoded GPU resource estimate < 250 MB.

When `EXT_disjoint_timer_query_webgl2` is available, also record GPU draw-time percentiles;
do not confuse refresh-capped rAF cadence with raw GPU capacity.

If a gate fails, use `@systematic-debugging` and profile the measured bottleneck. Do not
reduce source quality or add renderer tuning without recording before/after evidence.

- [ ] **Step 5: Commit**

```powershell
git add tools/benchmark-hd-hole.cjs package.json package-lock.json test/hd-verification-tools.test.js
git commit -m "test(hd): benchmark prototype load and rendering"
```

### Task 4: Verify fallback, reload stability, and packaging boundary

**Files:**

- Modify: `test/hd-server.test.js`
- Modify: `test/hd-readiness.test.js`
- Modify: `README.md`
- Modify as failures require: `server.js`
- Modify as failures require: `public/app.js`
- Modify as failures require: `public/render/scene.js`
- Modify as failures require: `public/render/hd-bundle.js`

- [ ] **Step 1: Add failure-matrix tests**

Test bundle absent, invalid manifest, corrupt terrain, corrupt each image, stale active
pointer, interrupted staging, client abort, course switch during load, and repeated
HD→procedural→HD reload. Assert one coherent readiness mode and bounded resource counts.

- [ ] **Step 2: Run focused tests and verify new cases fail**

Run: `node --test test/hd-server.test.js test/hd-readiness.test.js test/hd-runtime-loader.test.mjs`

Expected: FAIL on at least one newly added failure-matrix assertion before implementation.

- [ ] **Step 3: Implement the minimal fallback/reload fixes**

Fix only the failures exposed by Step 2. Every rejected or load-failed bundle must surface
its exact safe reason to the primary UI; a normally absent bundle stays silent. Ensure each
failed candidate disposes all partial resources before the procedural scene becomes ready.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/hd-server.test.js test/hd-readiness.test.js test/hd-runtime-loader.test.mjs`

Expected: PASS.

- [ ] **Step 5: Verify packaged fallback**

Run: `npm run pack`

Expected: packaged app builds; compiler tools and generated `data/` remain excluded; the app
starts procedurally when no external bundle is installed. Document clearly that HD bundle
distribution/install is deferred and the current prototype runs from a development
workspace using `BIRDIE_DATA_DIR`.

- [ ] **Step 6: Exercise reload stability**

Run the capture/benchmark harness with at least ten HD/procedural course reload cycles.
Expected: no monotonically growing geometry/texture counts and no unclosed ImageBitmaps.

- [ ] **Step 7: Commit**

```powershell
git add README.md server.js public/app.js public/render/scene.js public/render/hd-bundle.js test/hd-server.test.js test/hd-readiness.test.js
git commit -m "docs(hd): document prototype runtime boundary"
```

### Task 5: Write the measured prototype report and go/no-go decision

**Files:**

- Create: `docs/research/2026-06-23-bandon-hd-hole-01-results.md`
- Modify: `ASSETS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/visual-upgrade-plan.md`

- [ ] **Step 1: Record evidence, not estimates**

Report:

- source IDs/date/GSD/service metadata and uncertainty;
- compiler/tool versions and exact commands;
- raw workspace/final bundle/asset sizes;
- alignment checks and screenshot locations;
- average FPS, 1%-low, load time, decoded resource estimate;
- fallback/reload/packaging results;
- visual wins and remaining gaps versus TrackMan; and
- any acceptance gate miss with root cause.

- [ ] **Step 2: Update provenance and roadmap**

Record OSM ODbL, NAIP, USGS, Planetary Computer catalog access, normalization/encoding
parameters, and generated asset IDs in `ASSETS.md`. Update the roadmap with a factual go/no-
go recommendation; do not claim TrackMan parity.

- [ ] **Step 3: Run final verification**

Run:

```powershell
node --test "test/hd-*.test.js" "test/hd-*.test.mjs"
npm test
npm run smoke:hd-providers -- --manifest tools/hd-course/manifests/bandon-dunes-hole-01.json
npm run validate:hd-bundle -- --course bandon-dunes
npm run capture:hd-hole
npm run benchmark:hd-hole
npm run pack
git diff --check
git status --short
```

Expected: all automated checks pass; generated/cache/capture files remain untracked/ignored;
manual visual review is recorded.

- [ ] **Step 4: Commit documentation**

```powershell
git add docs/research/2026-06-23-bandon-hd-hole-01-results.md ASSETS.md CHANGELOG.md docs/visual-upgrade-plan.md
git commit -m "docs(hd): report Bandon Hole 1 prototype results"
```

## Plan 4 completion gate

- [ ] Six matched captures reviewed and documented.
- [ ] Alignment and seam checks pass.
- [ ] Average/1%-low/load/resource gates pass or failures have root causes.
- [ ] Ten-cycle reload does not leak resources.
- [ ] Packaged procedural fallback still works.
- [ ] Actual sizes and source/tool provenance are recorded.
- [ ] Full-course scaling has an explicit evidence-based go/no-go decision.
