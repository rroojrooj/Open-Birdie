# SP-00 Visual Benchmark Harness and Baseline Implementation Plan

> **Status:** Engineering-cleared; implementation in progress
> **Parent specification:** `docs/superpowers/specs/2026-07-23-pro-visuals-program-design.md`
> **Parent master plan:** `docs/superpowers/plans/2026-07-23-pro-visuals-master-plan.md`
> **Program test strategy:** `docs/superpowers/plans/2026-07-23-pro-visuals-test-plan.md`
> **Target branch:** `codex/sp00-visual-benchmark`
> **Base commit:** `fe8e677` (`main`, 2026-07-23)
> **Owner/module:** Rendering verification / `tools/visual-capture`, with a narrow browser seam in
> `public/app.js` and `public/render/scene.js`
> **Estimated effort:** Human team: 2-3 days. Agent-assisted implementation: 4-8 focused hours plus
> the named-GPU capture run.
> **Dependencies:** Node 22+, Electron 42, the existing Three.js renderer, and local real-course caches for
> the full baseline. The committed synthetic smoke fixture has no network dependency.
> **Required prior state:** The 301-test `main` baseline passes. No SP-01+ visual changes are required.

---

## 1. Outcome

One command launches the real Open-Birdie renderer in a hidden Electron window, loads an explicitly named
cached course from an explicitly named data directory, waits for observable renderer readiness, applies
committed cameras, captures the real post-processed output, and writes PNGs plus a machine-readable manifest.

The first delivered evidence set covers:

| Course | Proof role | Required viewing bands |
|---|---|---|
| Synthetic Test Course | Committed, offline renderer smoke | Address, feature, overview, UI |
| Chambers Bay | HD/aerial/seam and coastal-links baseline | Address, feature, overview, horizon, UI |
| TPC Sawgrass | Parkland/water and false-coast control | Address, feature, overview, horizon, UI |
| St Andrews Old Course | Flat links/no-aerial fallback control | Address, feature, overview, horizon, UI |

The fixed frame matrix is:

- Address/play.
- Close green.
- Close bunker or nearest available sand feature.
- Mid-hole/landing.
- Elevated hole overview.
- High course overview.
- Horizon/world edge.
- Full-page UI.

Still frames use a fixed animation time so flag, vegetation, grass, and water uniforms do not create
false diffs. Performance sampling deliberately leaves time live.

Expected artifact root:

```text
.shots/visual/
  synthetic-smoke/<run-id>/
  baseline/<run-id>/
    chambers-bay/
    tpc-sawgrass/
    st-andrews-old-course/
```

Each successful course directory contains `manifest.json`, frame PNGs, and optional CPU/GPU timing data.
A failed run contains `failure.json` and any completed diagnostics, never a misleading success manifest.

---

## 2. What already exists

### 2.1 Reused application paths

| Existing behavior | Exact location | Reuse decision |
|---|---|---|
| Electron starts the in-process sim server and waits for it | `main.js`, `srv.ready` | Reuse the exported server contract, not the fullscreen shell |
| Server accepts an isolated port and data directory through environment variables | `server.js`, `BIRDIE_PORT`, `BIRDIE_OC_PORT`, `BIRDIE_DATA_DIR` | Reuse unchanged |
| Cached course activation | `server.js` `/api/load-course`; `lib/course.js::loadCached` | POST the exact fixture cache filename before opening the page |
| Primary-client HD readiness nonce | `server.js::primaryNonce`; `public/app.js::loadGeometry` | Pass the real nonce in the hidden page URL |
| Course revision | `server.js::courseRevision`; `/api/course-geometry` | Record and require the loaded revision |
| Real renderer | `public/render/scene.js::GolfScene` | Reuse; add only capture/readiness methods |
| Real post-processing | `public/render/postfx.js::PostFX.render` | Capture after this exact path; do not add a verification renderer |
| Deterministic free camera | `GolfScene.enterFreeCam`, `_freeTargets` | Convert the private manual procedure into one explicit capture method |
| Existing page inspection handle | `window.__birdie = { scene, state }` in `public/app.js` | Extend only when `visualCapture=1` is present |
| Existing fixed Chambers cameras | `docs/fixtures/chambers-sweep.json` | Migrate values into the v1 suite schema; keep the old fixture as provenance |
| Renderer memory/program counts | `scene.renderer.info` | Snapshot after readiness and after the declared reset/sample point |
| PNG parsing | production dependency `pngjs` | Reuse for nonblank checks and pixel diffs |
| Existing HD acceptance plan | `docs/superpowers/plans/2026-06-23-hd-visual-acceptance-delivery.md` | Recover its hardware/capability and warm-up rules |

### 2.2 Prior commits to recover, not duplicate

- `cd10fd3` and `ea16690`: free-roam camera behavior.
- `61e401e`: renderer/HD readiness acknowledgement.
- `dfd25d2`: gameplay-object gating by real camera mode.
- `75b7609`: committed Chambers sweep and manual capture procedure.
- `d278ceb`: a prior Task-0 visual gate based on measured evidence.
- `c85aa5f`: latest integrated visual surface work on `main`.

### 2.3 Current gaps

- `docs/fixtures/chambers-sweep.json` requires a second scratch server, private-method calls, a fixed
  thirteen-second sleep, browser-console scripting, and manual uploads.
- `window.__birdie` exposes state but has no stable readiness or capture contract.
- `GolfScene` has an `envReady` promise, but course textures use asynchronous `TextureLoader` calls without a
  unified outstanding-work count.
- `public/app.js` catches boot and HD failures, but the manual procedure does not reliably turn page console
  errors into a failed run.
- The renderer contains live-time wind, flag, grass, and water animation, so otherwise identical stills can
  differ.
- There is no committed synthetic visual course, suite schema, manifest, comparison report, or release-machine
  capability proof.

---

## 3. Scope and non-scope

### 3.1 In scope

- A development-only visual-capture CLI.
- A versioned suite schema with explicit course identity, capture settings, viewing bands, judging intent,
  camera mode/pose, capture target, and optional performance route.
- One fresh Electron/server lifecycle per course.
- Caller-selected data directory and optional caller-selected HTTP port.
- Fixed `deviceScaleFactor=1`, fixed content size, fixed color/post-processing configuration, and exact output
  dimension checks.
- Deterministic seeds for the currently unseeded pine-straw and flower texture generation.
- Observable readiness for app state, course geometry/revision, primary HD acknowledgement, Three.js loading
  manager activity, HDR environment settlement, shader compilation, document fonts, and settled rendered
  frames.
- Fixed-time still rendering through `PostFX.render`.
- Full-page UI capture through Electron `webContents.capturePage`.
- Canvas-only render capture through the renderer canvas after `PostFX.render`.
- Console, page-crash, renderer, WebGL, GPU, Git, suite-hash, environment, course, and timing diagnostics.
- CPU frame-interval statistics and best-effort GPU timer-query samples when the extension is supported and
  non-disjoint.
- Nonblank image checks, dimension checks, pixel diff artifacts, and a Markdown contact sheet.
- A committed offline synthetic smoke fixture.
- Real baseline suites and an initial local baseline for Chambers, Sawgrass, and St Andrews.
- Focused unit/contract tests plus one synthetic Electron smoke.
- Exact operator documentation and package scripts.

### 3.2 NOT in scope

- Judging realism automatically. Pixel diffs detect change; the program rubric and a human judge quality.
- Cross-GPU golden-image equality. GPU, driver, Chromium, and color-pipeline changes can alter pixels.
- General app diagnostics refactoring. SP-02 owns the typed product-wide diagnostic contract; SP-00 emits typed
  harness failures and records existing console output.
- The final quality-profile system and enforceable release budgets. SP-09b owns profile selection and release
  thresholds; SP-00 records the current baseline and makes a GPU-backed run distinguishable from a capability
  failure.
- A second renderer, mock post-processing path, Playwright browser stack, remote browser farm, or cloud image
  storage.
- CI workflow authoring. The tool and synthetic smoke command will be CI-capable; wiring a hosted GPU runner is
  a repository/operations decision outside this focused branch.
- Shipping the capture tool in the Electron installer. It is a developer artifact and remains excluded by the
  existing `build.files` allowlist.
- Downloading arbitrary courses inside the capture tool. The full suite deliberately consumes named local
  caches so it cannot silently change source data between baselines.
- Refactoring every `TextureLoader` to a custom manager. The existing Three.js default loading manager is
  observed at the `GolfScene` boundary.
- Full five-load leak enforcement. SP-00 records comparable resource snapshots; SP-09b turns the repeated-load
  protocol into a release budget after the modular lifecycle work exists.

### 3.3 Scope-reduction rationale

The master plan listed a separate `report.mjs`. SP-00 instead uses two small pure modules:
`config.mjs` for contracts/ownership and `metrics.mjs` for image/timing work. A report service would have one
caller and no second behavior yet. Extract it later only if SP-08/SP-09 add another report consumer.

---

## 4. Task 0 diagnostic gate

### 4.1 Hypothesis

The current real renderer can produce deterministic, post-processed, GPU-backed stills from a hidden Electron
window with only a narrow page/scene capture seam. A parallel renderer and a fixed wall-clock sleep are not
required.

### 4.2 Cheapest falsification probe

Before building the full suite/report layer:

1. Launch Electron directly on `tools/visual-capture/electron-runner.cjs`.
2. Set `BIRDIE_NO_WATCH=1`, an isolated HTTP port, `BIRDIE_OC_PORT=0`, and the committed synthetic data
   directory before requiring `server.js`. Set `BIRDIE_NO_AUTOLOAD=1` so no arbitrary cached course activates
   before the exact requested fixture.
3. Open one hidden 1280x720 `BrowserWindow` with `backgroundThrottling:false`,
   `paintWhenInitiallyHidden:true`, `contextIsolation:true`, and `visualCapture=1`.
4. Wait for the proposed page readiness snapshot. Do not sleep for a guessed asset duration.
5. Render one fixed-time free-camera frame, read the WebGL canvas PNG, and capture one full-page PNG.
6. Assert exact dimensions, a nonblank luminance range, `document.visibilityState === "visible"`, the loaded
   course revision, a settled environment result, zero outstanding default-loader items, and evidence that
   `PostFX.render` produced the frame.
7. Record `app.getGPUFeatureStatus()`, `app.getGPUInfo("complete")`, WebGL vendor/renderer, DPR, Electron,
   Chromium, Node, OS, and software-renderer classification.
8. Shut down through the runner's normal cleanup and verify the parent owns no unclosed child process.

### 4.3 Outcomes

| Outcome | Evidence | Plan effect |
|---|---|---|
| **GO** | Exact-size nonblank canvas and page PNGs, hardware WebGL, readiness settles, clean exit | Continue all tasks |
| **CHANGE** | Hidden window paints but canvas extraction, DPR, or GPU qualification is wrong | Change the capture adapter only: use `capturePage(rect, {stayHidden:true})`, content bounds, or a visible-offscreen window; keep suite/manifest contracts |
| **CHANGE** | Default loading manager cannot prove completion for one resource | Add an explicit promise only around that resource class; do not add a second asset loader |
| **NO-GO** | Real post-processing cannot be captured without bypassing the app, or hidden Electron is software-only on the named machine | Stop. Record the capability artifact and fix the runtime/machine before creating baselines |

Tasks 2-7 do not begin until the synthetic probe is GO or an explicitly documented CHANGE path passes.

---

## 5. Architecture

### 5.1 Process and ownership diagram

```text
npm run visual:capture -- --suite baseline --data-dir <root>
        |
        v
tools/visual-capture/cli.mjs
  - parse + validate config
  - resolve exact data/output roots
  - hash suite + fixture files
  - hash cache JSON + referenced aerial/classmap files
  - request port 0 by default, or validate an explicit port
  - create owned staging directory
  - spawn one Electron child per course ------------------------------+
  - read one atomic result JSON file                                  |
  - compare/report after all children                                 |
  - rename staging -> final only on complete success                  |
        |                                                             |
        +---------------- owns exact child PID ------------------------+
                                                                      v
                                          electron-runner.cjs (one course)
                                            - read validated job JSON
                                            - set env before server import
                                            - force scale factor before app ready
                                            - require server.js
                                            - POST exact cached course
                                            - create hidden BrowserWindow
                                            - collect console/crash events
                                            - call page capture bridge
                                            - write PNG + atomic result JSON
                                            - close BrowserWindow + server
                                            - app.quit()
                                                                      |
                                                                      v
                                          public/app.js ?visualCapture=1
                                            - expose capture bridge
                                            - report app/course state
                                            - wait for matching revision
                                            - delegate scene operations
                                                                      |
                                                                      v
                                          public/render/scene.js
                                            - track loader/env readiness
                                            - compile real scene
                                            - apply fixed camera
                                            - fixed-time PostFX still render
                                            - live performance sample
                                            - renderer/WebGL snapshot
```

Job/result files are the control channel because `server.js` legitimately writes progress logs to stdout;
parsing a magic stdout line would be brittle. The CLI never scans the machine for Electron processes and never
kills by process name. It stores the direct child PID. Normal completion asks the child to close its own
window/server. Timeout fallback terminates only that recorded process tree.

The runner calls `app.commandLine.appendSwitch("force-device-scale-factor", "1")` before
`app.whenReady()`. It creates the window with `useContentSize:true`, the suite width/height, `show:false`,
`paintWhenInitiallyHidden:true`, and `backgroundThrottling:false`, then verifies `window.innerWidth`,
`window.innerHeight`, DPR, canvas CSS size, and drawing-buffer size before any accepted frame.

### 5.2 File map

| File | Change |
|---|---|
| `tools/visual-capture/config.mjs` | Pure suite validation, arguments, hashes, error records, job/result contracts, output naming, and child-cleanup adapter |
| `tools/visual-capture/metrics.mjs` | Pure image statistics/diff, percentile/timing summaries, and Markdown report generation |
| `tools/visual-capture/cli.mjs` | Orchestrator entry point for capture, smoke, performance, and compare |
| `tools/visual-capture/electron-runner.cjs` | Electron main-process adapter and per-course lifecycle |
| `server.js` | Support `BIRDIE_NO_AUTOLOAD=1`; return/log the actual OS-assigned HTTP port from `server.address().port` when `BIRDIE_PORT=0` |
| `tools/visual-capture/suites/synthetic-smoke.json` | Offline suite |
| `tools/visual-capture/suites/baseline.json` | Chambers/Sawgrass/St Andrews fixed suite |
| `test/fixtures/visual-capture-data/courses/synthetic-visual.json` | Small committed synthetic visual course |
| `public/app.js` | Query-gated capture bridge and matching app-state readiness |
| `public/render/capture-readiness.js` | Pure readiness evaluation/polling used by the browser and Node contract tests |
| `public/render/scene.js` | Default-loader tracker, capture readiness, fixed camera/time render, diagnostics, optional timing sampler |
| `public/render/vegetation.js` | Replace visible `Math.random()` texture generation with fixed local seeds |
| `test/visual-capture-config.test.mjs` | Pure/contract tests |
| `test/visual-capture-smoke.e2e.mjs` | Explicit spawned synthetic Electron smoke; intentionally outside the ordinary `npm test` glob |
| `docs/fixtures/chambers-sweep.json` | Mark as legacy provenance and point to the versioned suite |
| `docs/visual-benchmark.md` | Operator and review guide |
| `package.json` | `visual:capture`, `visual:smoke`, `visual:compare`, `visual:perf` scripts |

No production package dependency is added. `pngjs` already exists in production dependencies; Electron and
Ajv already exist in development dependencies.

### 5.3 Suite contract

The v1 suite shape is explicit and closed to unknown fields:

```json
{
  "schemaVersion": 1,
  "id": "baseline",
  "capture": {
    "width": 1920,
    "height": 1080,
    "deviceScaleFactor": 1,
    "qualityProfile": "current-default",
    "readinessTimeoutMs": 45000,
    "settleFrames": 3,
    "fixedTimeSeconds": 12
  },
  "courses": [{
    "id": "chambers-bay",
    "cacheFile": "chambers-bay.json",
    "expectedName": "Chambers Bay",
    "frames": [{
      "id": "address-h1",
      "role": "address",
      "target": "canvas",
      "mode": "idle",
      "band": "address",
      "judges": ["gameplay framing", "turf response"]
    }, {
      "id": "overview",
      "role": "high-overview",
      "target": "canvas",
      "mode": "free",
      "band": "overview",
      "pose": {
        "tx": 0,
        "ty": -16,
        "dist": 320,
        "pitch": -42,
        "yaw": 0,
        "hOff": 0
      },
      "judges": ["HD seam", "surface composition"]
    }]
  }]
}
```

Validation rules:

- IDs match `^[a-z0-9][a-z0-9-]{0,63}$`.
- `cacheFile` is a basename ending in `.json`; no separators, absolute path, or traversal.
- Width/height are integers from 320 to 7680/4320.
- DPR is exactly `1` in v1.
- Timeout is 1,000-120,000 ms.
- `settleFrames` is 2-10.
- `band` is one of `address`, `feature`, `hole`, `overview`, `horizon`, `ui`.
- `role` is one of `address`, `close-green`, `close-bunker`, `landing`, `hole-overview`,
  `high-overview`, `horizon`, `ui`; every baseline course contains each role exactly once.
- `target` is `canvas` or `page`; `ui` requires `page`, non-UI frames default to `canvas`.
- `mode` is `idle` or `free`; `free` requires every finite pose field.
- Pitch is `-88..-4`, distance is `4..12000`, yaw is finite, and all local coordinates are within
  `-20000..20000`.
- Frame IDs are unique inside a course; course IDs are unique inside a suite.
- Every real baseline course includes all eight required proof roles.
- `hdPolicy` is `required`, `optional`, or `forbidden`. Required means advertised, successfully decoded, and
  acknowledged bundle-ID sets are exactly equal; forbidden means all three sets are empty.
- Unknown fields fail validation.

### 5.4 Browser capture interface

Only URLs containing `visualCapture=1` receive:

```text
window.__birdie.visualCapture
  .status() -> serializable readiness snapshot
  .waitUntilReady({ expectedCourse, timeoutMs, settleFrames })
  .applyFrame(frame, fixedTimeSeconds)
  .canvasPng() -> data URL from the post-processed WebGL canvas
  .diagnostics({ resetRendererInfo })
  .samplePerformance({ durationMs, route })
```

Normal users still receive the existing `window.__birdie.scene/state` debug handle; no capture loop runs and
no animation is frozen unless the query-gated API is called. The scene's loading-manager observer preserves
and chains any pre-existing Three.js manager callbacks rather than silently replacing them.

### 5.5 Readiness state machine

```text
BOOT
 |
 +--> wait app state loaded -------------------------+
 +--> wait scene.geo + expected course name --------+
 +--> wait matching courseRevision -----------------+
 +--> wait state.runtimeReady -----------------------+
 +--> wait HD advertised=loaded=acked when required -+
 +--> wait environment settled (HDR or fallback) ---+
 +--> wait DefaultLoadingManager outstanding = 0 ---+
 +--> await document.fonts.ready --------------------+
 +--> await renderer.compileAsync(scene, camera) ----+
 +--> render N settled requestAnimationFrame turns --+
 |                                                   |
 +------------------- all current -------------------+
                                                     v
                                                   READY

Any deadline:
  READINESS_TIMEOUT {
    outstanding: ["environment", "loader:..."],
    lastStatus: {...},
    console: [...]
  }
```

`environment=fallback` is settled so failure evidence is emitted instead of a misleading timeout, but it cannot
qualify as release evidence. The existing HDRI path emits a console error, so a strict run fails after recording
the fallback status. A failed optional course aerial/classmap settles through Three.js loader error handling and
appears in captured console output. An unexpected console error, renderer-process crash, unresponsive window,
partial required-HD set, or mismatched course/revision fails the run.

### 5.6 Still-frame determinism

`GolfScene.applyVisualCaptureFrame`:

1. Stops the animation loop for still capture only.
2. Selects `idle` or real `free` camera mode.
3. Copies the computed camera target to current position/look vectors, eliminating easing history.
4. Sets a private fixed capture time used by tree, grass, flag, and water updates.
5. Executes the existing `_frame()` path once.
6. `_frame()` still ends at `this.postfx.render()`.
7. Calls `gl.finish()` only in still-capture mode so readback cannot race queued GPU work.
8. Returns a diagnostic marker with the camera, fixed time, canvas buffer size, and render-path identifier.

After all stills, performance sampling restores the live animation loop and clears the fixed capture time.
The runner closes the page after capture, so there is no user-session restoration burden.

### 5.7 Performance semantics

- Warm-up: at least 300 rendered frames or 5 seconds, whichever is later.
- Sample route: committed suite cameras, held for equal segments, at least 60 seconds for `visual:perf`.
- CPU metric: successive `requestAnimationFrame` intervals. Report average, median, p95 interval, worst hitch,
  average FPS, and 1% low FPS.
- `renderer.info.reset()` occurs after warm-up and before the timed sample. Counts are read after the sample.
- Because `PostFX` executes multiple passes, capture sampling temporarily sets
  `renderer.info.autoReset = false`, resets and aggregates at explicit per-frame boundaries, then restores the
  prior value. The manifest labels counts as per-frame maxima/medians or cumulative totals; it never reports an
  ambiguous final-pass snapshot.
- GPU metric: only when WebGL2 `EXT_disjoint_timer_query_webgl2` is available. Report valid non-disjoint query
  samples separately. Never label rAF cadence as GPU time.
- Capture-only runs may use a short 2-second diagnostics sample. Only `visual:perf` may claim the 60-second
  performance baseline.
- Hardware qualification is recorded, not guessed. SwiftShader, llvmpipe, disabled GPU compositing, wrong DPR,
  hidden/throttled document state, or a wrong canvas size marks the run non-qualifying.

### 5.8 Output transaction

```text
requested output
  |
  +--> create <run-id>.staging-<pid>/
  |      +--> environment.json
  |      +--> <course>/...
  |      `--> failure.json on any failure
  |
  +--> all required courses and frames valid?
          | yes                         | no
          v                             v
      write manifest.json          keep failed staging evidence
      atomic rename to run-id/      exit non-zero
```

The runner writes only below the resolved staging root supplied by the CLI. The CLI rejects output roots
outside the requested `.shots/visual` root unless the user explicitly supplies `--output`.

### 5.9 Failure record

Harness errors have a stable shape:

```js
{
  code: "READINESS_TIMEOUT",
  stage: "renderer-ready",
  courseId: "chambers-bay",
  message: "Renderer did not become ready within 45000 ms",
  recovery: "Inspect outstanding[] and console[]; rerun with --show-window",
  details: { outstanding: ["environment"], lastStatus: {} }
}
```

Initial codes:

- `ARGS_INVALID`
- `SUITE_INVALID`
- `COURSE_CACHE_MISSING`
- `COURSE_IDENTITY_MISMATCH`
- `PORT_UNAVAILABLE`
- `SERVER_START_FAILED`
- `PAGE_LOAD_FAILED`
- `READINESS_TIMEOUT`
- `CAPABILITY_UNQUALIFIED`
- `PAGE_CONSOLE_ERROR`
- `RENDERER_CRASHED`
- `FRAME_CAPTURE_FAILED`
- `IMAGE_INVALID`
- `PERF_SAMPLE_INVALID`
- `COMPARE_INCOMPATIBLE`
- `CHILD_TIMEOUT`
- `CLEANUP_FAILED`

---

## 6. Implementation tasks

### Task 1: Task-0 vertical slice only

**Files**

- Create `tools/visual-capture/suites/synthetic-smoke.json`.
- Create `test/fixtures/visual-capture-data/courses/synthetic-visual.json`.
- Create `test/visual-capture-readiness.test.mjs`.
- Create `public/render/capture-readiness.js`.
- Modify `public/render/scene.js`.
- Modify `public/render/vegetation.js`.
- Modify `public/app.js`.
- Create the initial `tools/visual-capture/electron-runner.cjs`.

**Tests first**

- Readiness timeout formatting names every outstanding subsystem.
- Readiness polling reaches ready only after consecutive settled frames and preserves the last snapshot on
  timeout.
- Loading tracker preserves existing callbacks and balances start/end/error transitions.
- Two independent vegetation texture builds have identical pixel checksums.

**Implementation**

- Add the query-gated browser API.
- Track `THREE.DefaultLoadingManager` activity at scene construction while chaining existing callbacks.
- Track environment settlement as `ready` or `fallback`.
- Replace visible vegetation `Math.random()` calls with fixed file-local seeds.
- Add fixed-time capture camera/render methods without changing normal `_frame()` behavior.
- Implement only enough runner code for one synthetic canvas frame and one synthetic UI frame. No generalized
  schema, report, comparison, orchestration, or GPU timer-query code is permitted before the GO decision.

**Evidence**

- Run focused tests.
- Run one synthetic canvas frame and one UI frame.
- Inspect both PNGs.
- Record GO/CHANGE/NO-GO in this plan before Task 2.

**Commit boundary**

`test(visual): prove deterministic renderer capture`

**Rollback**

Remove the query-gated API and tool files. Normal application behavior remains unchanged.

### Task 2: Complete suite validation and CLI orchestration

**Files**

- Create `tools/visual-capture/config.mjs`.
- Create `tools/visual-capture/metrics.mjs`.
- Create `tools/visual-capture/cli.mjs`.
- Complete `tools/visual-capture/electron-runner.cjs`.
- Modify `server.js`.
- Create `test/visual-capture-config.test.mjs`.

**Tests first**

- CLI resolves built-in suite IDs and explicit suite paths.
- Valid synthetic suite passes and receives normalized defaults.
- Unknown fields, traversal cache names, duplicate IDs, missing poses, invalid bands/roles/HD policy,
  NaN-like values, wrong DPR, impossible dimensions, and missing required proof roles fail with exact paths.
- Timing summary excludes warm-up and computes median/p95/1%-low correctly.
- Nonblank detector rejects a transparent, solid-black, and one-color placeholder PNG.
- `server.ready` reports the actual non-zero bound port when configured with port `0`.
- `BIRDIE_NO_AUTOLOAD=1` suppresses startup cache activation; normal server startup keeps current auto-load
  behavior.
- Data/output paths become absolute for internal use. Shared manifests retain only source kind, root basename,
  and a root/content hash; they do not leak the operator's absolute user path.
- Missing cache produces `COURSE_CACHE_MISSING`, expected path, expected course, and the exact hydration command.
- Course identity mismatch fails before capture.
- Child timeout calls cleanup with only the recorded child PID.
- Windows cleanup uses `taskkill /PID <recorded> /T /F`; POSIX cleanup signals only the direct child/process group.
- Electron spawn removes an inherited `ELECTRON_RUN_AS_NODE` value so the runner cannot accidentally start as
  plain Node.
- A failed child yields failure evidence and a non-zero CLI exit.
- Missing/malformed child result files fail even when the process exit code is zero.
- Server stdout noise cannot be interpreted as a runner result.
- A job whose output path escapes its owned staging root is rejected by both CLI and runner.
- `--require-clean` rejects release evidence from a dirty worktree while normal iteration remains allowed and
  clearly marked.
- A partial staging directory never receives a success manifest.

**Implementation**

- Parse `capture`, `smoke`, `perf`, and `compare` modes.
- Set `BIRDIE_PORT=0` by default and consume the actual bound port returned by `srv.ready`. This uses the
  operating system's atomic port allocation and avoids a probe-then-bind race. An explicit `--port` remains
  available for single-course diagnosis.
- Set `BIRDIE_NO_AUTOLOAD=1` in every runner job so only the explicit cache POST creates a revision.
- Spawn one Electron child per course sequentially.
- Pass validated jobs and atomic results through files; never parse server stdout as protocol.
- Stream human-readable progress to stderr and reserve stdout final JSON for automation.
- Enforce course timeout and scoped cleanup.
- Atomically publish only a complete run.

**Evidence**

- Unit/contract tests pass.
- Interrupt one synthetic child and show no unrelated Electron process is targeted.

**Commit boundary**

`feat(visual): add isolated capture orchestration`

**Rollback**

Package scripts are not added until Task 6, so incomplete tooling has no default entry point.

### Task 3: Capture diagnostics and performance sampling

**Files**

- Modify `public/render/scene.js`.
- Modify `public/app.js`.
- Modify `tools/visual-capture/electron-runner.cjs`.
- Extend `test/visual-capture-config.test.mjs`.

**Tests first**

- Software renderer strings are classified as non-qualifying.
- Hardware renderer strings are not rejected.
- Unsupported timer query reports `supported:false`, not zero GPU time.
- Disjoint/invalid GPU samples are discarded and counted.
- Renderer counts retain explicit reset-point metadata.
- Fixed still time serializes in every frame record.
- Required HD accepts only exact equality among advertised, loaded, and acknowledged bundle-ID sets; one
  rejected bundle fails readiness with its recorded reason.
- Forbidden HD rejects any advertised/loaded/acknowledged bundle.
- A normal page URL has no `window.__birdie.visualCapture` API and keeps its animation loop live.
- Installing the loading tracker preserves pre-existing manager callbacks and reports balanced start/end/error
  transitions.

**Implementation**

- Capture Electron GPU feature status/info and display scale/refresh information.
- Capture WebGL version/vendor/renderer, DPR, drawing-buffer size, timer-query support, visibility, and hardware
  qualification.
- Capture console levels, source URL, line, and message.
- Capture advertised HD metadata, successfully decoded bundle IDs, per-bundle load failures, acknowledgement
  request/response, and enforce the suite's `hdPolicy`.
- Fail on console error, page load failure, unresponsive/crashed renderer, or invalid image.
- Record renderer calls, triangles, points, lines, geometries, textures, programs, scene object counts, and
  post-processing render-path marker.
- Aggregate post-processing metrics with `renderer.info.autoReset=false` during capture sampling, then restore
  the prior renderer setting.
- Add warm-up, live CPU frame intervals, and best-effort GPU timer queries.

**Evidence**

- Synthetic smoke manifest contains all required environment and renderer keys.
- CPU stats have the declared duration/sample count.
- GPU stats are either valid samples or an explicit unsupported/disjoint reason.

**Commit boundary**

`feat(visual): record renderer capability and timing evidence`

**Rollback**

All sampling remains behind `visualCapture=1`; remove the methods without changing play.

### Task 4: Real-course fixtures

**Files**

- Create `tools/visual-capture/suites/baseline.json`.
- Modify `docs/fixtures/chambers-sweep.json`.
- Extend `test/visual-capture-config.test.mjs`.

**Tests first**

- Baseline contains Chambers, Sawgrass, and St Andrews exactly once.
- Each real course contains the eight required proof roles and all six viewing bands.
- Chambers migrated camera values remain equal to the legacy fixture.
- Every fixture names at least one visual feature being judged.
- UI frames target the full page; survey frames target the canvas.

**Implementation**

- Migrate Chambers poses.
- Add Sawgrass fixed frames centered on the parkland/water identity and the 17th-hole complex.
- Add St Andrews fixed frames centered on links character, shared fairways, sparse horizon, and no-aerial
  fallback.
- Preserve absolute local sim coordinates in the fixtures; never infer a pose from display name at runtime.
- Mark the old Chambers procedure as superseded but retain its provenance.

**Evidence**

- Run all three locally against
  `C:\Users\USER\Documents\GitHub\Open-Birdie\data`.
- Inspect frame coverage and adjust fixtures, not renderer behavior.

**Commit boundary**

`test(visual): pin cross-course baseline views`

**Rollback**

Fixture-only revert. No renderer rollback required.

### Task 5: Pixel comparison and review sheet

**Files**

- Extend `tools/visual-capture/metrics.mjs`.
- Extend `tools/visual-capture/cli.mjs`.
- Extend `test/visual-capture-config.test.mjs`.

**Tests first**

- Identical PNGs report zero changed pixels and zero RMS error.
- A known one-pixel change reports the exact changed count, max delta, and a visible diff PNG.
- Different dimensions, suites, course IDs, frame IDs, DPRs, or capture targets fail as
  `COMPARE_INCOMPATIBLE`.
- Threshold affects classification but never hides raw statistics.
- Contact sheet escapes labels and uses relative artifact links.

**Implementation**

- Compare matching manifest frame keys only.
- Write per-frame diff PNGs and `comparison.json`.
- Write a Markdown contact sheet with before, after, diff, raw metrics, viewing band, judging intent, and blank
  human scorecard fields from the program specification.
- State in the report that a pixel pass is not a realism pass.

**Evidence**

- Compare a synthetic run to itself.
- Compare two unchanged synthetic runs.
- Deliberately alter one generated test image and prove the diff.

**Commit boundary**

`feat(visual): add deterministic comparison reports`

**Rollback**

Capture remains useful without compare mode; revert only library/CLI comparison functions.

### Task 6: Package scripts, operator guide, and smoke integration

**Files**

- Modify `package.json`.
- Create `test/visual-capture-smoke.e2e.mjs`.
- Create `docs/visual-benchmark.md`.

**Scripts**

```json
{
  "visual:capture": "node tools/visual-capture/cli.mjs capture",
  "visual:smoke": "node tools/visual-capture/cli.mjs smoke",
  "visual:compare": "node tools/visual-capture/cli.mjs compare",
  "visual:perf": "node tools/visual-capture/cli.mjs perf"
}
```

**Tests first**

- Synthetic smoke exits zero on a qualifying WebGL machine and produces required PNG/manifest files.
- A genuinely unsupported environment exits with the documented non-zero capability code and preserves
  `failure.json`. The explicit E2E driver reports the capability evidence but does not relabel it as a renderer
  pass.
- Any page console error fails smoke.
- Timeout test reports the outstanding subsystem.
- Child/process cleanup completes after success and failure.

**Documentation**

- Exact Windows PowerShell commands.
- Required Node/Electron versions.
- Full-course data-directory prerequisite.
- Exact missing-cache hydration command.
- Output layout and manifest fields.
- How to add a course/frame without changing the renderer.
- Why fixed animation time is used for stills.
- What pixel diff does and cannot prove.
- Ordinary CI versus named Windows GPU release-machine rules.
- How to use `--show-window` for diagnosis.
- How to compare runs from matching environments.

**Evidence**

- `npm run visual:smoke`.
- `npm run visual:capture -- --suite baseline --data-dir
  "C:\Users\USER\Documents\GitHub\Open-Birdie\data"`.
- `npm run visual:perf -- --suite baseline --course chambers-bay --data-dir
  "C:\Users\USER\Documents\GitHub\Open-Birdie\data"`.

**Commit boundary**

`docs(visual): publish benchmark workflow`

**Rollback**

Remove scripts and docs. No production startup behavior depends on them.

### Task 7: Baseline, stability proof, and done record

**Files**

- Modify this plan's Done record only.

**Execution**

1. Run the focused tests and full `npm test`.
2. Run synthetic smoke twice.
3. Compare the two synthetic runs.
4. Run the full three-course baseline on the named local Windows GPU.
5. Repeat it without code/config/data changes.
6. Compare matching baseline runs.
7. Run the 60-second Chambers performance route.
8. Inspect every contact-sheet frame for hard-gate violations.
9. Record exact commands, commits, environment, test counts, output directories, stability metrics, renderer
   resources, performance numbers, deviations, and remaining artifacts.

**Commit boundary**

`test(visual): record SP-00 baseline evidence`

Baseline PNGs remain ignored under `.shots/`; only the plan's evidence references are committed. The final
named baseline requires a clean Git worktree. Dirty runs remain available for iteration but are marked
non-release evidence in the manifest.

---

## 7. Test diagram

```text
CODE PATHS                                             USER / OPERATOR FLOWS

[+] suite input                                        [+] npm run visual:smoke
 |-- [UNIT] built-in ID -> resolved file                |-- [E2E] committed cache found
 |-- [UNIT] explicit path -> resolved file              |-- [E2E] server owns isolated port/data
 |-- [UNIT] valid closed schema -> normalized suite     |-- [E2E] hidden GPU renderer loads
 |-- [UNIT] unknown/invalid field -> SUITE_INVALID      |-- [E2E] deterministic canvas + UI PNG
 `-- [UNIT] missing cache -> actionable typed error     `-- [E2E] manifest + scoped clean exit
     test/visual-capture-config.test.mjs                    test/visual-capture-smoke.e2e.mjs

[+] CLI orchestration                                  [+] npm run visual:capture
 |-- [UNIT] one child per course                        |-- [E2E] explicit real data directory
 |-- [UNIT] success -> atomic final directory           |-- [E2E] exact named cache loaded
 |-- [UNIT] failure -> evidence + non-zero              |-- [E2E] all required frames written
 |-- [UNIT] timeout -> recorded-PID cleanup             |-- [E2E] errors make run fail
 `-- [UNIT] no unrelated PID ever selected              `-- [VISUAL] human contact-sheet review
     test/visual-capture-config.test.mjs                    named Windows GPU only

[+] renderer readiness                                 [+] readiness failure
 |-- [CONTRACT] expected course/revision/state          |-- [E2E] deadline expires
 |-- [CONTRACT] env ready or fallback                   |-- [E2E] failure.json survives
 |-- [CONTRACT] loader outstanding=0                    |-- [E2E] names outstanding subsystem
 |-- [CONTRACT] fonts + compileAsync                    `-- [UX] recovery command is actionable
 `-- [SMOKE] N settled real frames                         synthetic delayed-readiness injection

[+] deterministic still                               [+] fixed frame review
 |-- [UNIT] finite pose validation                      |-- [VISUAL] address keeps play aids
 |-- [SMOKE] idle mode uses real idle targets           |-- [VISUAL] survey has no play objects
 |-- [SMOKE] free mode uses real free targets           |-- [VISUAL] UI frame includes DOM HUD
 |-- [SMOKE] camera easing snapped                      `-- [VISUAL] post-processing preserved
 |-- [SMOKE] animation fixed to fixture time
 `-- [SMOKE] exact-size nonblank post-FX PNG

[+] capability / performance                           [+] release-machine proof
 |-- [UNIT] software renderer rejected                  |-- [E2E] 5s/300-frame warm-up excluded
 |-- [UNIT] unsupported GPU query explicit              |-- [E2E] 60s live route
 |-- [UNIT] disjoint samples discarded                  |-- [E2E] CPU and GPU semantics separate
 |-- [UNIT] percentile/1%-low math                      |-- [E2E] renderer.info reset declared
 `-- [SMOKE] environment keys populated                 `-- [E2E] qualifying hardware recorded

[+] compare                                             [+] review report
 |-- [UNIT] same image -> zero diff                     |-- [UNIT] relative safe links
 |-- [UNIT] known pixel -> exact raw stats               |-- [UNIT] all frame metadata shown
 |-- [UNIT] threshold -> classification only            |-- [DOC] blank human rubric fields
 |-- [UNIT] incompatible manifests -> typed failure     `-- [DOC] no automatic realism claim
 `-- [UNIT] diff image written
```

### 7.1 Exact test inventory

| Test | Input | Assertion | Environment |
|---|---|---|---|
| Suite happy path | `synthetic-smoke.json` | Normalized v1 object, no unknown fields | Node |
| Suite invalid matrix | Mutated fixture per field/branch | Exact JSON path and `SUITE_INVALID` | Node |
| Cache traversal | `../course.json`, absolute paths, separators | Rejected before filesystem read | Node |
| Missing cache | Empty temporary data root | Expected file/name/path and hydration command | Node |
| Output transaction | Injected child success/failure | Success rename only after all required artifacts | Node |
| PID scope | Fake child PID and cleanup adapter | Only recorded PID appears in call arguments | Node |
| Timing math | Known frame/GPU arrays | Warm-up exclusion, median, p95, FPS, 1%-low | Node |
| Software classification | SwiftShader/llvmpipe/hardware strings | Non-qualifying reason or qualifying result | Node |
| PNG validation | Generated blank/solid/gradient fixtures | Blank rejected, gradient accepted | Node |
| Pixel diff | Generated 2x2 pairs | Exact changed count/RMS/max and diff pixels | Node |
| Compare compatibility | Mismatched manifest fields | `COMPARE_INCOMPATIBLE` lists mismatch | Node |
| Synthetic renderer smoke | Committed suite/course | Exact PNG sizes, no page errors, manifests, clean exit | Electron/WebGL |
| Normal-page isolation | Synthetic page without `visualCapture=1` | No capture API; normal animation remains active | Electron/WebGL |
| Readiness timeout contract | Fake status provider that never settles | Typed timeout names subsystem and last status | Node |
| Full baseline | Three named local caches | Complete eight-frame matrices | Named Windows GPU |
| Repeatability | Two unchanged full runs | Raw diff stats within pinned tolerance | Same machine/GPU/driver |
| Performance | 60-second Chambers route | Valid environment and separate CPU/GPU fields | Named Windows GPU |

---

## 8. Failure modes

| Failure | Handling | Visible? | Recoverable? | Test |
|---|---|---:|---:|---|
| Suite is malformed | Reject before spawn with exact JSON path | Yes | Yes, edit fixture | Unit |
| Cache file missing | Name expected path/course and hydration command | Yes | Yes | Unit + CLI |
| Cache file name escapes root | Reject basename contract | Yes | Yes | Unit |
| Server auto-loads another cache first | Runner sets `BIRDIE_NO_AUTOLOAD=1`; exact POST owns first revision | Yes if violated | Yes | Server contract |
| Cached display name does not match fixture | Abort before page capture | Yes | Yes, correct data/suite | Unit + smoke |
| Requested port is occupied | `PORT_UNAVAILABLE`, do not kill owner | Yes | Yes, auto/other port | Unit + CLI |
| Server fails before ready | Preserve child stderr and failure record | Yes | Yes | Injected runner test |
| HD client acknowledgement never completes | Readiness timeout names `runtimeReady`/revision | Yes | Usually | Timeout smoke |
| One advertised HD bundle fails client decode | Required-HD equality fails with bundle/reason; no visual pass | Yes | Fix asset or use explicit optional suite | Unit + real smoke |
| HDRI fails | Settle as fallback; record page error/fallback status | Yes | Play degrades; release run fails on console error | Smoke |
| Aerial/classmap fails | Existing fallback completes; console warning recorded | Yes in manifest | Yes | Real/no-aerial control |
| Loader remains outstanding | Deadline names item/count | Yes | Diagnose asset | Timeout smoke |
| Shader compilation fails | Page console error or capture failure | Yes | Fix/revert visual change | Synthetic smoke |
| Renderer process crashes | `RENDERER_CRASHED`, child exits non-zero | Yes | Rerun after fix | Event adapter test |
| Hidden page is throttled | Capability non-qualifying | Yes | Show window/change machine | Unit + smoke |
| Software rendering | Capability artifact, cannot pass release | Yes | Fix GPU/runtime | Unit + smoke |
| Wrong DPR or drawing-buffer size | Abort before baseline frames | Yes | Fix flags/window | Smoke |
| Animation time leaks into still | Repeatability diff fails | Yes | Fix capture-time gate | Two-run comparison |
| Procedural texture uses unseeded randomness | Fixed vegetation seeds plus repeat checksum/diff | Yes | Fix generator | Unit + two-run comparison |
| Canvas capture bypasses post-FX | Missing render-path marker/hard visual mismatch | Yes | Change adapter | Synthetic smoke |
| Page error is swallowed by app catch | Console listener turns it into failed run | Yes | Fix real error | Smoke |
| One course fails after earlier courses | Keep staging evidence; no success manifest | Yes | Fix and rerun | Transaction unit |
| Child hangs during shutdown | Grace period then recorded-tree termination | Yes | Automatic | Cleanup test |
| Cleanup targets unrelated process | Design forbids discovery/name kill; test exact PID | Yes if violated | N/A, test must block | Unit |
| Baselines use different environments | Compare rejects or warns on pinned identity mismatch | Yes | Rerun same machine | Unit |
| Pixel diff is mistaken for realism | Report labels it change-only and keeps human rubric blank | Yes | Human review | Doc/contract |
| GPU timer query unsupported/disjoint | Explicit unsupported/invalid result, no fake zero | Yes | CPU baseline remains; release records limitation | Unit + perf |
| Post-FX metrics reset per pass | Capture disables auto-reset and labels aggregate semantics | Yes in manifest | Fix sampler | Unit + perf |

No failure is both silent, unhandled, and untested in SP-00's owned path.

Known unresolved risks:

- Chromium/driver updates can change pixels even with identical source. Environment mismatch is recorded and comparison
  refuses a strict stability verdict.
- Three.js may retain global/cache resources between frames. SP-00 records steady-state counts; the later five-course-load
  leak gate must judge monotonic growth rather than literal zero.
- The current app emits untyped console strings. SP-00 records them and owns typed harness errors; SP-02 replaces
  product-wide string diagnostics.

---

## 9. Acceptance

### 9.1 Hard gates

- The synthetic smoke is one command and requires no network or user interaction.
- Every successful frame is the declared exact pixel size and nonblank.
- Every canvas frame comes from the real `PostFX.render` path.
- Readiness contains no outstanding subsystem at capture time.
- Unexpected console errors, renderer crashes, missing required frames, and invalid capability fail the run.
- The full baseline manifest identifies Git SHA, dirty state, suite hash, fixture hash, course/revision, capture
  configuration, cache/aerial/classmap content hashes, Electron/Chromium/Node/OS, GPU/WebGL, DPR, resolution,
  renderer counts, and errors/warnings.
- The final named baseline is rejected as release evidence when the worktree is dirty.
- Cleanup targets only recorded process ownership.
- Two unchanged synthetic runs compare within:
  - exact dimensions and matching metadata;
  - per-channel change threshold `2/255`;
  - changed-pixel ratio at or below `0.05%`; and
  - no structural/blank image difference.
- The real baseline repeat records observed drift. Any drift above the synthetic tolerance must be explained
  per frame before SP-01 starts.
- A capability-only run cannot be labeled a visual/performance pass.

### 9.2 Visual proof

Required first-run frames:

```text
synthetic: address, green, bunker, landing, hole-overview, course-overview, horizon, ui
chambers:  address, close-green, close-bunker, landing, elevated-overview, high-overview, horizon, ui
sawgrass:  address, close-green-17, close-bunker/water, landing, elevated-overview, high-overview, horizon, ui
st-andrews: address, close-green, close-bunker, landing, elevated-overview, high-overview, horizon, ui
```

The first baseline does not need to look professional. It must honestly show:

- Current course-edge/horizon behavior.
- Current HD patch/material seam behavior.
- Current green, bunker, water, vegetation, and structure readability.
- Current gameplay-versus-survey object gating.
- Current cross-course identity and false-feature controls.

### 9.3 Commands

Planned focused verification:

```powershell
node --test test/visual-capture-config.test.mjs
node --test test/visual-capture-smoke.e2e.mjs
npm test
npm run visual:smoke
npm run visual:capture -- --suite baseline --data-dir "C:\Users\USER\Documents\GitHub\Open-Birdie\data"
npm run visual:compare -- --before "<first-run>" --after "<second-run>"
npm run visual:perf -- --suite baseline --course chambers-bay --data-dir "C:\Users\USER\Documents\GitHub\Open-Birdie\data"
```

Expected result: all Node tests pass; smoke either passes on hardware WebGL or emits an explicit non-qualifying
capability artifact; the named Windows GPU run must pass, not skip.

### 9.4 Cross-course controls

- Chambers may show HD/aerial/coastal evidence.
- Sawgrass must not acquire an inferred/curated ocean.
- St Andrews must render safely without a course aerial/classmap.
- Synthetic must render from committed data only.
- All suites must load by exact cache filename and expected course name, never fuzzy display-name selection.

### 9.5 Documentation

`docs/visual-benchmark.md` must be sufficient for a developer unfamiliar with the manual July capture session
to produce, compare, inspect, and diagnose a run without opening DevTools.

---

## 10. Worktree execution strategy

The implementation is sequential. The narrow scene/app capture contract defines the runner, and the runner
defines the CLI artifact contract. Parallel work before that seam stabilizes would create merge conflicts and
two interpretations of readiness.

| Step | Modules touched | Depends on |
|---|---|---|
| Task 1 vertical slice | `public/render/`, `public/`, `tools/visual-capture/`, `test/` | — |
| Task 2 orchestration | `tools/visual-capture/`, `test/` | Task 1 |
| Task 3 diagnostics/perf | `public/render/`, `public/`, `tools/visual-capture/`, `test/` | Tasks 1-2 |
| Task 4 real fixtures | `tools/visual-capture/suites/`, `docs/fixtures/`, `test/` | Tasks 1-3 |
| Task 5 compare/report | `tools/visual-capture/`, `test/` | Task 2 |
| Task 6 scripts/docs/smoke | root scripts, `docs/`, `test/` | Tasks 1-5 |
| Task 7 evidence | ignored artifacts, plan done record | Tasks 1-6 |

One isolated worktree is used:

```text
codex/sp00-visual-benchmark
  Task 1 -> spec review -> code review
  Task 2 -> spec review -> code review
  ...
  Task 7 -> final review
```

Fresh subagents may implement/review one task at a time, but they share this worktree sequentially. There is
no safe parallel lane in SP-00's core.

---

## 11. Engineering review checklist

- [x] Step 0 scope challenge completed.
- [x] Architecture review completed.
- [x] Code-quality review completed.
- [x] Test diagram audited branch by branch.
- [x] Performance semantics reviewed.
- [x] Outside voice completed.
- [x] All recommended choices auto-selected under the user's standing instruction.
- [x] Review report appended.

---

## 12. Engineering review decisions

### 12.1 Step 0 scope challenge

The initial file count exceeds eight, but only four new executable modules form the harness core:
`config.mjs`, `metrics.mjs`, `cli.mjs`, and `electron-runner.cjs`. The remaining files are small browser seams,
fixtures, tests, scripts, and documentation. Reductions accepted:

- No separate report service.
- No second renderer or browser stack.
- No custom asset-loading system.
- No hosted GPU/CI infrastructure in this branch.
- No general product-diagnostics refactor.
- Task 1 is now only the hidden-Electron falsification slice; generalized contracts and GPU queries wait for GO.

**Step 0 verdict:** Scope reduced and accepted.

### 12.2 Resolved architecture findings

1. **[P0] (confidence 10/10) `server.js` stdout is not a control protocol.** Server progress would corrupt
   JSON-line parsing. Jobs and atomic result files now carry control data.
2. **[P0] (confidence 10/10) server startup could activate an arbitrary unsorted cache.** The runner now
   requires `BIRDIE_NO_AUTOLOAD=1`; only its exact POST owns the first course revision.
3. **[P0] (confidence 9/10) fixed animation time did not cover visible `Math.random()` vegetation textures.**
   Pine-straw and flower textures receive deterministic local seeds and repeat checks.
4. **[P0] (confidence 10/10) `runtimeReady` does not prove all advertised HD visuals decoded.** Required-HD
   suites now require exact advertised/loaded/acknowledged bundle-ID equality and preserve per-bundle failures.
5. **[P1] (confidence 10/10) probe-then-bind port selection has a race.** SP-00 uses Node's built-in port `0`
   allocation and reads `server.address().port`.
6. **[P1] (confidence 9/10) hidden-window dimensions were underspecified.** Scale is forced before app ready;
   `useContentSize:true`, DPR, inner size, canvas size, and drawing-buffer size are all gates.
7. **[P1] (confidence 9/10) Three.js loading callbacks could be clobbered.** The observer chains existing
   callbacks and has balanced transition tests.
8. **[P1] (confidence 9/10) fallback was both “ready” and fatal.** Fallback settles to produce evidence, but
   cannot qualify as release evidence and its existing console error fails a strict run.
9. **[P1] (confidence 9/10) runner output paths trusted the parent too much.** CLI and child independently
   enforce the owned staging root.

### 12.3 Resolved code-quality findings

1. **[P1] (confidence 9/10) a single helper module mixed config, processes, images, timing, and reports.**
   Contracts/ownership moved to `config.mjs`; image/timing/report work moved to `metrics.mjs`.
2. **[P1] (confidence 10/10) a `*.test.mjs` Electron smoke would silently join every ordinary `npm test`.**
   The E2E file uses `.e2e.mjs` and runs only through the explicit smoke command.
3. **[P1] (confidence 9/10) readiness embedded in `app.js` would be difficult to test.** Pure evaluation and
   polling live in `capture-readiness.js`.
4. **[P2] (confidence 8/10) capture-only behavior could leak into normal play.** The API is query-gated and a
   normal-page E2E asserts the API is absent and animation remains live.

### 12.4 Resolved test gaps

The review added coverage for:

- Closed frame-role and HD-policy enums.
- Required eight-role completeness.
- OS-assigned server port and no-autoload behavior.
- Job/result files under noisy stdout.
- Missing/malformed child results.
- Runner-side output containment.
- Inherited `ELECTRON_RUN_AS_NODE`.
- Dirty release evidence.
- Loading-manager callback chaining.
- Deterministic vegetation texture checksums.
- Normal-page isolation.
- Partial HD decode and forbidden-HD cases.
- Fallback qualification.
- Multi-pass renderer-info aggregation.
- Cache, aerial, and classmap content hashes.

**Test verdict:** Every owned branch is mapped to a Node contract, Electron smoke, visual frame, or named-GPU
performance check. No silent untested failure remains in the planned path.

### 12.5 Performance review

1. **[P1] (confidence 10/10) `renderer.info.autoReset` would report only a pass/final frame, not composed
   workload.** Sampling now disables auto-reset temporarily, aggregates at explicit boundaries, labels
   semantics, and restores the original setting.
2. **[P1] (confidence 9/10) rAF cadence could be mislabeled as GPU capacity.** CPU intervals and valid
   non-disjoint timer-query samples remain separate; unsupported GPU timing is explicit.
3. **[P2] (confidence 8/10) still-capture readback can race queued work.** `gl.finish()` is capture-only and
   performance warm-up occurs after still mode.

### 12.6 Outside voice reconciliation

The outside reviewer found eight SP-00-specific issues: unseeded visible textures, arbitrary startup cache,
partial-HD readiness, missing frame roles, underspecified Electron sizing, misleading multi-pass metrics,
fallback-policy conflict, and an overlarge Task-0 slice. All eight were verified against the current code and
incorporated. There is no cross-model tension.

### 12.7 Remaining scope and execution

- **What already exists:** Documented in section 2 and reused.
- **NOT in scope:** Documented in section 3.2.
- **TODO proposals:** Zero. Review findings are either fixed in this plan or already owned by named later
  phases; duplicating them in `docs/TODO.md` would create two sources of truth.
- **Failure modes:** 28 listed, zero critical silent gaps.
- **Parallelization:** One sequential lane. The page/scene contract gates runner and CLI work.
- **Lake score:** 15/15 review recommendations chose the complete option.
- **Unresolved decisions:** Zero.

### 12.8 Completion summary

- Step 0 Scope Challenge: scope reduced and accepted.
- Architecture Review: 9 issues found, 9 resolved in plan.
- Code Quality Review: 4 issues found, 4 resolved in plan.
- Test Review: coverage diagram produced, 15 gaps identified and added.
- Performance Review: 3 issues found, 3 resolved in plan.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 0 items proposed; no duplicate backlog entries.
- Failure modes: 0 critical gaps remain.
- Outside voice: ran via independent subagent; 8 findings incorporated, no tension.
- Parallelization: 1 sequential lane.
- Review verdict: **CLEAR**.

---

## 13. Done record

To be completed after implementation:

- **Task-0 outcome:** **CHANGE**. Hidden Electron produced exact-size, nonblank canvas and page PNGs
  through the real post-processing path on hardware WebGL, and shut down cleanly. Cross-process pixel drift
  still exceeds the pinned synthetic gate, so Tasks 2-7 must not claim baseline determinism yet.
- **Commits:** Task-0 implementation commit `test(visual): prove deterministic renderer capture`.
- **PR:** pending/not requested.
- **Tests:** `node --test test/visual-capture-readiness.test.mjs` passed 7/7; `npm test` passed 308/308;
  `git diff --check`, `node --check server.js`, and `node --check tools/visual-capture/electron-runner.cjs`
  passed.
- **Synthetic capture:** two final independent runs passed readiness and image validation at 1280x720,
  DPR 1, `document.visibilityState=visible`, HDR environment `ready`, loader 14/14 with zero outstanding or
  failed items, forbidden-HD policy with all advertised/loaded/failure/ack sets empty, and `postfx.render`
  still marker. Canvas luminance range was 200. Two independently
  rasterized Canvas2D builds per run, and both separate Electron runs, produced exact matching RGBA SHA-256:
  straw `74789c8188c8b46a33a99a4edb2aa3182934c5feb7660d6dcfcfe2693d7699b4`; flower
  `2a445b7cd433bfa013ae17b24bdebfc542c31012617db9b3f8c078e5df39a946`.
- **Real baseline capture:** pending.
- **Comparison/stability:** final canvas repeat: mean absolute channel delta `0.08075/255`, max delta `42`,
  `10,322 / 921,600 = 1.1200%` pixels above the `2/255` threshold. Final page repeat:
  mean `0.07050/255`, max `40`, `9,070 / 921,600 = 0.9842%`. Both exceed the required `0.05%`;
  exact PNG hashes also differ. The likely remaining seam is cross-process GPU/post-processing/shadow
  rasterization, not unseeded visible vegetation or camera time.
- **Performance environment/results:** pending.
- **Renderer resource counts:** 20 geometries, 50 textures, 58 compiled programs after eight fixed-time
  warm-up stills. Final-pass `renderer.info.render` reports one fullscreen post-process draw and one triangle,
  so scene-pass timing/counting remains Task 6 work.
- **Artifact locations:** ignored local evidence under `.shots/visual/task0-probes/probe-j` and `probe-k`.
- **Plan deviations:** the initial fixture frame was changed from idle to the planned real free-camera
  overview after the first repeat exposed larger foreground/readability drift. No generalized CLI, schema,
  comparison service, or GPU timer queries were added.
- **Known remaining artifacts:** Electron emits its upstream `console-message` deprecation warning; page
  console contains existing Three Clock/shadow-map deprecations and the development CSP warning. No page
  error-level messages were observed.
- **Follow-ups routed to SP-01+:** none. The repeatability CHANGE is owned by SP-00 and must be resolved
  before SP-01 begins.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | Not run for SP-00 | Parent program already reviewed |
| Codex Review | `/codex review` | Independent second opinion | 1 | CLEAR | 8 SP-00 findings incorporated |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 16 issues resolved, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | Not required | Developer harness; no product UI change |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | Not required | Exact commands and recovery are in acceptance |

- **CROSS-MODEL:** Both reviews agree on a real-renderer, fixed-fixture harness; the outside review strengthened
  determinism, lifecycle, HD coherence, and metric semantics.
- **UNRESOLVED:** 0.
- **VERDICT:** ENG + OUTSIDE VOICE CLEARED - ready to implement.
