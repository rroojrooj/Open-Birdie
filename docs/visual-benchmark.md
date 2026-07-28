# Visual benchmark operator guide

The SP-00 visual benchmark captures deterministic evidence from the real Open-Birdie renderer. It is a
measurement harness, not a replacement renderer and not proof by itself that a scene looks realistic.

## Requirements

- Windows PowerShell.
- Node.js 22 or newer (`package.json` declares `>=22`).
- The repository's installed Electron 42.4.0 and npm dependencies (`npm install`).
- For the baseline suite, a local real-data directory containing the declared course JSON caches and every
  aerial/classmap file referenced by those caches. The synthetic smoke suite uses committed test data.
- A hardware-backed WebGL 2 renderer for qualifying visual evidence. Software rendering is preserved as a
  typed failure, never reported as a pass.

Start in the repository:

```powershell
Set-Location "C:\Users\USER\Documents\GitHub\Open-Birdie"
npm install
```

## Commands

Run the committed synthetic course:

```powershell
npm run visual:smoke
```

Capture all three real baseline courses:

```powershell
npm run visual:capture -- --suite baseline --data-dir "C:\Users\USER\Documents\GitHub\Open-Birdie\data"
```

Capture only one course while retaining the baseline suite identity and hash:

```powershell
npm run visual:capture -- --suite baseline --course chambers-bay --data-dir "C:\Users\USER\Documents\GitHub\Open-Birdie\data"
```

Run the 60-second Chambers performance route:

```powershell
npm run visual:perf -- --suite baseline --course chambers-bay --data-dir "C:\Users\USER\Documents\GitHub\Open-Birdie\data" --show-window
```

On this host, only the shown-window performance route is qualifying. A hidden performance run is diagnostic:
if its cadence cannot satisfy the claim, the runner exits with `PERFORMANCE_CADENCE_NON_QUALIFYING`. Preserve
that failure evidence, then recover by rerunning the canonical command above with `--show-window`. You may
also add `--show-window` to a capture command when diagnosing a visual problem. Do not compare shown- and
hidden-window evidence as interchangeable runs.

Compare two completed run directories:

```powershell
npm run visual:compare -- --before "C:\path\to\before-run" --after "C:\path\to\after-run" --output "C:\path\to\comparison"
```

Only compare runs from matching suite data, capture dimensions, DPR, course/frame set, targets, OS, Electron,
GPU, WebGL, window mode, and quality profile. Every manifest records `capture.windowMode` as `shown` or
`hidden`, and the comparison preflight rejects a mismatch.

## Missing course data

The tool fails before Electron starts when a cache or referenced visual asset is missing. Its recovery text is
an executable command plus the exact course to select, for example:

```powershell
npm start # search for "Chambers Bay" and select it once to create chambers-bay.json
```

Run `npm start`, search for the quoted course name, and select it once. Then confirm the generated JSON cache
and every aerial/classmap file named inside it are together under `<data-dir>\courses`; rerun the benchmark.
Do not rename a different course cache to satisfy the filename.

## Output and evidence

The default root is `.shots\visual`. Successful capture layout:

```text
.shots\visual\<suite>-<timestamp>\
  manifest.json
  <course-id>\
    result.json
    <frame-id>.png
```

`manifest.json` records the suite ID/basename/hash, requested course and selected course IDs, normalized
capture settings including explicit shown/hidden window mode, Git SHA and dirty state, sanitized data-root
identity/hash, per-course input hashes, frames, renderer/capability identity, HD policy, console/runtime
events, renderer resource totals, and CPU/GPU timing evidence. A failed run stays in its owned
`.staging-<pid>` directory with `failure.json`; it is not published as a successful manifest. Use
`--require-clean` for named release evidence.

Comparison output contains `comparison.json`, per-frame visible PNG diffs, and `report.md` with relative links
and human-review prompts. Pixel diff can prove byte stability and localize change. It cannot judge realism,
material quality, composition, golf readability, or whether a changed frame is better; those require human
review against the frame's committed `judges` criteria.

## Adding coverage

Edit or add a closed JSON suite under `tools\visual-capture\suites`. Add a course declaration with a safe ID,
expected cache name, HD policy, and frames; add each frame's role, band, target, mode, judges, and free-camera
pose when applicable. This changes benchmark inputs only; do not change renderer code to make a frame pass.
The baseline contract requires one of every proof role and all viewing bands per course.

Still captures freeze animation at the suite's committed `fixedTimeSeconds` so water, vegetation, post-FX,
and other time-dependent pixels are comparable across processes. Normal gameplay retains its live loop.

SP-00 stills are exactly 1280x720 at DPR 1 because the named host cannot provide an unclamped hidden
1920x1080 content area. That decision does not lower the separate 1080p performance acceptance gate:
release performance must be measured on a named Windows GPU/display that can provide an exact 1920x1080
content area. The canonical shown-window `visual:perf` command above proves the 60-second sampling path and
1280x720 cadence. The ordinary `visual:capture` baseline proves deterministic still coverage; it does not
make a performance claim. Neither 1280x720 result is the 1080p release-performance acceptance result.

## CI and release evidence

Ordinary CI runs unit tests and may exercise configuration/comparison logic. The real Electron smoke may be
non-qualifying on a virtual or software renderer; its E2E driver preserves the typed capability failure and
marks the renderer exercise skipped, not passed. A named Windows release GPU must run the synthetic smoke,
two unchanged full baseline captures plus their comparison, and the 60-second performance route. Record the
machine/display/GPU/WebGL identity, output directories, hashes, frame review, and performance verdict.
