# SP-01 — P2a Recovery, Verification, and Integration Plan

**Status:** ACTIVE
**Parent specification:** [`../specs/2026-07-23-pro-visuals-program-design.md`](../specs/2026-07-23-pro-visuals-program-design.md)
**Master plan:** [`2026-07-23-pro-visuals-master-plan.md`](2026-07-23-pro-visuals-master-plan.md)
**Program test strategy:** [`2026-07-23-pro-visuals-test-plan.md`](2026-07-23-pro-visuals-test-plan.md)
**Historical plan:** `origin/claude/p2-sdf-surfaces:docs/superpowers/plans/2026-07-07-p2a-sdf-surfaces.md`
**Target branch:** `codex/sp01-p2a-recovery`
**Required base:** `origin/main` at `88c67d6e1eda2adcc52b8a84643c1b7f15d19ce5`
**Owner/module:** Unassigned recovery lane; `public/render` surface presentation
**Estimate:** 1–2 focused engineering days plus hardware capture review
**Dependency:** SP-00 accepted and integrated through PR #40

## 1. Outcome

At feature, address, and hole/play distance:

- green boundaries end at a stable screen-antialiased mow line;
- a readable green collar/apron sits outside the putting surface without becoming a
  decal or a wide halo;
- fairway mowing structure stops at the authored mown boundary;
- bunker sand does not carry a blurred class-map halo;
- the runtime class map contributes contiguous missing coverage without a dot-screen
  artifact;
- dry Chambers Bay, lush TPC Sawgrass, and rough/incomplete-OSM St Andrews retain
  their existing course character.

SP-01 does **not** promise a sharper overview edge after the far-photo transition.
It records the residual HD patch-boundary/far-photo relief seam as SP-04 input.

Proof frames:

- Chambers Bay: corrected close green, close bunker, address, hole overview, high survey;
- TPC Sawgrass: H17 green, H17 bunker, address, hole overview;
- St Andrews: home green, Road Hole bunker, address, shared fairway, overview;
- synthetic smoke: deterministic renderer/capture sanity.

## 2. What already exists

### Current `origin/main`

- `public/render/scene.js`
  - `_paintMask` builds the blurred packed mown/green mask.
  - `_paintSplat` supplies surface palette color.
  - the class-map texture is loaded when `geo.aerial.classes` is true.
  - `_turfInputs` is shared by base terrain and HD patches.
- `public/render/turf.js`
  - `makeTurfMaterial` owns the single turf shader.
  - `uMask.r` is mown coverage and `uMask.g` is green coverage.
  - green collar/checker/contour, NDVI unions, aerial tint, far-photo, course dryness,
    sand, and detail normal already coexist in the fragment path.
  - shader cache key is `turf-grain-v32`.
- `test/hd-turf.test.mjs` compiles both ordinary and macro variants and asserts shader
  contracts, uniform ownership, class-map ordering, cache identity, and disposal.
- `tools/visual-capture/suites/baseline.json` and the SP-00 capture harness provide
  deterministic three-course captures, comparisons, renderer-capability evidence,
  failure preservation, and performance sampling.
- `test/visual-capture-config.test.mjs` pins baseline identities and cameras.

### Historical work to recover

`origin/claude/p2-sdf-surfaces` contains a reviewed P2a plan and 13 commits. Its useful
implementation is behaviorally valuable, but it is not a current-base candidate.

| Historical commit | Recovery disposition | Reason |
|---|---|---|
| `08dc1f7` plan | Omit from replay | Superseded by this current-base plan |
| `85c71fb` engineering review | Preserve as design evidence | Its fwidth-first decision remains valid; do not copy the old report as current acceptance |
| `d278ceb` diagnostic/fixture | Reimplement in the canonical suite | Preserve the diagnosis and corrected pose, but leave the superseded fixture as provenance |
| `bbd2827` green edge | Cherry-pick with fixture hunk omitted/resolved | Core behavior applies; current capture-readiness code remains authoritative |
| `fab55dd` fairway edge | Cherry-pick | Isolated turf/test change; keep the deliberate no-fairway-recolor decision |
| `90f67f0` bunker edge | Cherry-pick, then correct | Useful edge code, but its “raw” bunker sample is blurred and needs an actual raw blue channel |
| `f4f03ad` task-1 docs | Omit from replay | Recovered in this plan and the final done record |
| `8ac822d` collar | Cherry-pick | Approximate raw-mask collar is simpler than a local or course-wide SDF |
| `2d4a827` task-2 docs | Omit from replay | Recovered in this plan and the final done record |
| `ca7cf03` class-map precedence | Cherry-pick, then correct | `mkRaw.b` was never populated; the OSM-near bunker claim was therefore false |
| `4aef205` task-3 docs | Omit from replay | Recovered in this plan and the final done record |
| `c85aa5f` class-map smoothing | Cherry-pick, then harden | The historical callback silently retained raw data on processing failure |
| `3f04a75` task-4 docs | Preserve diagnosis only | HD seam routing belongs to SP-04 |

### Recovery defects already found

1. The canonical Chambers `green-complex` pose at `(138, -289)` points at a tee whose
   aerial appearance resembles a green. The valid authored green verified by P2a is
   near `(193, -263)`, distance 30. A green-edge claim from the old pose is invalid.
2. The historical raw packed mask contains only mown/green, but later shader code
   treats `.b` as raw bunker coverage. Consequently `mkRaw.b` is always zero and
   `osmNear` cannot suppress a class-map bunker halo as claimed.
3. The historical class-map smoothing catches all errors without surfacing the cause,
   then silently renders the noisy raw texture.

These defects make a 13-commit branch merge or unreviewed replay a **NO-GO**. The exact
recovery sequence is:

1. correct the canonical camera, commit it, then capture the clean before stills and
   before performance route;
2. cherry-pick `bbd2827` with its legacy-fixture hunk omitted/resolved;
3. cherry-pick `fab55dd`;
4. cherry-pick `90f67f0`;
5. commit raw additive RGB ownership, raw-blue bunker use, raster/shader tests, and
   production wiring before any dependent commit;
6. cherry-pick `8ac822d`;
7. cherry-pick `ca7cf03`, resolving it onto the already-correct raw-blue contract;
8. cherry-pick `c85aa5f`;
9. commit the tested class-map texture-state helper, visible raw fallback, and missing
   integration/error tests;
10. run candidate captures, comparison, candidate performance, independent review,
    and consolidated current-program documentation.

An evidence gate runs after the camera commit, after raw RGB correction, and after
class-map hardening. No historical completion claim is inherited from an intermediate
uncorrected state.

## 3. Scope and non-scope

### In scope

- Correct the canonical Chambers close-green proof camera and its config test.
- Preserve the superseded `docs/fixtures/chambers-sweep.json` as historical provenance;
  do not make it a second active source of benchmark truth.
- Add one explicit raw packed surface mask with documented channels:
  `.r = mown`, `.g = green`, `.b = bunker`.
- Use `fwidth` to antialias authored green, mown, and bunker membership at the screen
  edge.
- Recover the approximate green collar, class-map/OSM precedence, and class-map
  smoothing/threshold behavior.
- Make class-map smoothing fallback observable and testable.
- Update shader cache keys, disposal ownership, shader-contract tests, benchmark
  evidence, `docs/TODO.md`, and `docs/HANDOFF.md`.

### NOT in scope

- Whole-course or per-green signed-distance-field generation: the accepted collar
  approximation earns the visual result with no new field, cache, or UV lifecycle.
- HD patch geometry, normals, relief, LOD, or far-photo seam correction: SP-04.
- P2b turf light response, anisotropic sheen, new normal octaves, or stripe-width
  retuning: SP-04.
- World context, coastline, horizon, vegetation, buildings, landmarks, UI, camera,
  physics, shot, scoring, or course-presentation architecture.
- New curated course art.
- Broad dependency remediation from `npm audit`; it is a separate dependency-management
  concern and must not be mixed into a renderer recovery PR.
- TrackMan/GSPro parity claims or final M1/M2 acceptance.

## 4. Task 0 — Diagnostic and recovery gate

### Hypothesis

The historical fwidth/collar/class-map behavior can be reimplemented on current
`origin/main` with a small surface-presentation diff, provided that the proof camera,
raw bunker channel, and smoothing fallback are corrected first.

### Cheapest falsification

1. On a clean branch from the required base, update only the Chambers close-green
   camera to the validated full pose
   `{tx: 193, ty: -263, dist: 30, pitch: -28, yaw: 0, hOff: 0}` and update its
   config assertion.
2. Run `test/visual-capture-config.test.mjs` and the full suite.
3. Commit that evidence-input correction.
4. Capture a clean hardware-backed **before** baseline at that commit.
5. Port only raw-mask plumbing and green fwidth composite.
6. Run both turf variants, synthetic smoke, and a Chambers corrected-green capture.
7. Orbit or capture adjacent fixed poses to check shimmer and mis-registration.

### Outcomes

- **GO:** corrected frame targets an authored green; both shader variants compile;
  edge is stable; current palette, HD path, and capture readiness remain healthy.
  Continue Tasks 1–5.
- **CHANGE:** fwidth is stable but the crisp edge exposes unacceptable OSM slop. Keep
  the raw mask but add only a bounded confidence/softening rule documented by a new
  test and three-course frames; do not add an SDF.
- **NO-GO:** raw-mask plumbing breaks base/HD material sharing, disposal, WebGL
  compilation, or course identity; or the corrected proof frame cannot be captured
  deterministically. Stop, preserve failure evidence, and return for architecture
  review. Do not recover later historical commits.

## 5. Architecture

### Data and shader flow

```text
OSM surface polygons
       |
       +--> blurred packed mask ----------------------> uMask
       |      R mown / G green                          |
       |                                               +--> soft coverage,
       |                                                    existing grooming
       |
       +--> raw packed surface mask ------------------> uSurfaceMaskRaw
              R mown / G green / B bunker               |
                                                         +--> fwidth membership
                                                              | green base edge
                                                              | fairway stripe edge
                                                              | bunker sand edge
                                                              | OSM-near precedence

runtime classmap image
       |
       +--> one-time tested canvas smoothing
       |          | success --> smoothed texture
       |          ` failure --> warning + explicit raw fallback
       |
       +--> shader confidence threshold
                    |
                    +--> suppress near authored OSM boundaries
                    `--> union only into genuine OSM gaps

surface palette + detail + macro tint + far-photo
       |
       `--> final lit turf material shared by base terrain and every HD patch
```

### Ownership

- `GolfScene` creates the blurred mask, raw packed surface mask, class-map texture,
  and palette inputs for a course load.
- `makeTurfMaterial` references those textures and registers shader-only textures in
  `material.userData.disposeTextures`.
- The raw surface mask is one texture, not separate green/mown/bunker textures.
- Its channels are painted independently/additively rather than by last-kind-wins
  replacement: mown membership contributes red, green membership contributes green,
  and bunker membership contributes blue. Polygon overlap may set multiple channels;
  it must never erase a prior channel.
- The ordinary and macro material variants share channel semantics and differ only in
  macro uniforms/code.
- No global cache or asynchronous transaction is introduced.

### Interfaces

`makeTurfMaterial` adds explicit optional inputs:

```js
{
  surfaceMaskRaw, // packed raw OSM coverage: R=mown, G=green, B=bunker
  pal             // linear palette entries required by the composite
}
```

If `surfaceMaskRaw` is absent in a narrow unit-test construction, the material may
fall back to the existing mask only to compile. Production `GolfScene` must always
supply the raw packed mask, and a test must assert that wiring.

Class-map smoothing lives in a small pure/testable renderer helper that accepts the
loaded texture and a canvas factory. On success it replaces `texture.image`, sets
`texture.needsUpdate`, and returns a `smoothed` status. On failure it warns with the
original error plus explicit raw-fallback wording, returns a `raw-fallback` status,
and guarantees that the original `texture.image` and `needsUpdate` value are
unchanged.

### Inline documentation required

- The raw-mask construction in `scene.js` must include the RGB channel diagram.
- The shader composite in `turf.js` must explain why green overrides base color,
  fairway only gates mowing structure, and bunker uses raw blue.
- The class-map precedence block must state that raw OSM wins only in its bounded
  neighborhood and NDVI remains a gap filler.

## 6. Implementation tasks

### Task 1 — Correct the proof input and establish the before baseline

**Files**

- `tools/visual-capture/suites/baseline.json`
- `test/visual-capture-config.test.mjs`

**Behavior**

- Point the Chambers close-green role at the verified authored green with the exact
  validated pose
  `{tx: 193, ty: -263, dist: 30, pitch: -28, yaw: 0, hOff: 0}`, without changing
  any other course or proof role.
- Update the judge text to name authored OSM green edge and collar.
- Pin the corrected pose in the config test so it cannot drift back to the tee.
- Leave the superseded legacy operator fixture unchanged and make the test document
  the deliberate SP-01 replacement: assert the exact new close-green pose and its
  inequality to legacy `green`, while retaining exact legacy-pose equality for every
  unchanged Chambers role and all existing suite identity/coverage assertions.

**Tests and evidence**

- `node --test test/visual-capture-config.test.mjs`
- `npm test`
- clean hardware baseline capture with the corrected suite and current renderer;
  record run directory, suite hash, course hashes, renderer identity, and Git SHA.
- clean Chambers performance run from the same corrected-base commit and hardware;
  record CPU cadence, GPU timing support/value, and renderer resource totals.

**Commit boundary**

`test(visual): correct Chambers authored-green proof camera`

**Rollback**

Revert this commit only if source geometry proves the coordinate is not a green.
Do not restore `(138, -289)` merely to preserve historical pixel identity.

### Task 2 — Raw packed mask and crisp authored boundaries

**Files**

- `public/render/scene.js`
- `public/render/surface-mask.js` (new, if required to keep packing independently testable)
- `public/render/turf.js`
- `test/surface-mask.test.mjs` (new, if the helper is extracted)
- `test/hd-turf.test.mjs`

**Behavior**

- Add raw-mask rasterization without changing the existing blurred mask.
- Pack mown/green/bunker into raw RGB with additive/independent channel passes:
  mown contributes red, green contributes green, bunker contributes blue.
- Restore the normal canvas composite mode after raw-mask painting so later canvas
  operations cannot inherit additive blending.
- Linearize only required palette colors before supplying uniforms.
- Derive screen-antialiased `gCrisp`, `mCrisp`, and `bCrisp` with `fwidth`.
- Green gets a crisp palette base-color composite.
- Fairway keeps its current base color and uses `mCrisp` only for stripe ownership.
- Bunker sand uses `bCrisp` from raw blue, never a blurred bunker sample.
- Bump the cache key and register the new texture exactly once for disposal.

**Tests and evidence**

- Shader source asserts one raw sample and all three channel extractions.
- Shader tests assert `bCrisp` and OSM-near inputs derive from raw blue.
- Raster/helper tests use overlapping mown, green, and bunker inputs and prove that
  simultaneous RGB ownership survives; paint order cannot clear an existing channel.
- Tests assert production input plumbing and no duplicate disposal.
- Both ordinary and macro variants compile.
- Synthetic smoke and corrected Chambers green/bunker captures.

**Commit boundary**

Historical commits `bbd2827`, `fab55dd`, and `90f67f0`; raw RGB ownership is corrected
immediately after `90f67f0` before any dependent historical commit is applied.

**Rollback**

Revert the commit as one unit; blurred shipping masks remain intact.

### Task 3 — Recover the bounded green collar

**Files**

- `public/render/turf.js`
- `test/hd-turf.test.mjs`

**Behavior**

- Build the collar from a bounded raw-green dilation around `gCrisp`.
- Keep a crisp inner edge, soft outer apron, and existing 45–70 m distance fade.
- Composite collar color into the base before putting-surface color.
- Suppress fairway stripes on the collar.
- Remove only the legacy collar code made redundant by the new band.
- Bump the cache key.

**Tests and evidence**

- Assert collar order, band bounds, distance fade, and stripe suppression.
- Corrected Chambers green plus Sawgrass H17 green captures.
- St Andrews green control for OSM-slop amplification.

**Commit boundary**

Historical commit `8ac822d`.

**Rollback**

Revert this commit while retaining Task 2 crisp edges.

### Task 4 — Correct OSM/class-map precedence

**Files**

- `public/render/turf.js`
- `test/hd-turf.test.mjs`

**Behavior**

- Compute `osmNear` from raw mown `.r` and raw bunker `.b` over a bounded neighborhood.
- Suppress `cls.r` and `cls.b` before either class-map union where OSM owns the edge.
- Preserve NDVI/class-map coverage where the raw authored neighborhood is absent.
- Bump the cache key.

**Tests and evidence**

- Assert raw blue participates in `osmNear`.
- Assert suppression occurs before mown and bunker unions.
- Assert zero `osmNear` leaves class-map channels eligible.
- Chambers and Sawgrass bunker frames show no pale double edge.
- St Andrews/no-aerial path remains unchanged.

**Commit boundary**

Historical commit `ca7cf03`, applied after the dedicated raw-RGB correction commit.

**Rollback**

Revert independently if the bounded precedence creates coverage holes.

### Task 5 — Remove class-map dot screen with explicit fallback

**Files**

- `public/render/classmap-smoothing.js` (new)
- `public/render/scene.js`
- `public/render/turf.js`
- `test/classmap-smoothing.test.mjs` (new)
- `test/hd-turf.test.mjs`

**Behavior**

- Smooth a loaded class-map image once through a 4 px canvas blur.
- Replace the texture image and mark it dirty only on successful processing.
- Threshold red/blue coverage in the shader so isolated low-confidence scatter drops
  while contiguous regions remain.
- On a missing image, missing 2D context, draw failure, or other processing exception:
  retain the exact original texture image/state and log the real error plus explicit
  raw-classmap fallback wording; never swallow it.
- Bump the cache key.

**Tests and evidence**

- Pure helper test: dimensions, filter, draw source, returned canvas.
- Error integration tests: absent dimensions, absent 2D context, and draw exception
  each prove that the original loaded texture/image remains selected and byte/object
  identical, `needsUpdate` is not spuriously changed, and the warning contains the
  original error plus `raw classmap fallback`.
- Shader test asserts threshold precedes OSM suppression and unions.
- Chambers play/mid and high-survey captures localize dot-screen removal.

**Commit boundary**

Historical commit `c85aa5f`, followed by a dedicated class-map fallback/test correction
commit.

**Rollback**

Revert smoothing and threshold together to avoid mismatched amplitude assumptions.

### Task 6 — Full verification, seam routing, and documentation

**Files**

- `docs/TODO.md`
- `docs/HANDOFF.md`
- this plan's Done Record
- program ledger and handover, updated by the PIC after acceptance

**Behavior**

- Capture candidate with the exact corrected suite and inputs used for the before run.
- Produce the SP-00 comparison report and visible diffs.
- Review named surface criteria; pixel statistics remain diagnostic only.
- Capture Chambers high-survey with class-map present and record the residual HD
  patch-boundary/far-photo relief artifact for SP-04.
- Do not tune HD terrain in this branch.
- Run corrected-base and candidate performance routes on the same host and compare
  cadence, supported GPU timing, and renderer resource totals.

**Tests and evidence**

- focused tests;
- `npm test`;
- `npm run visual:smoke -- --require-clean`;
- full three-course baseline capture with `--require-clean`;
- `visual:compare` before versus candidate;
- Chambers diagnostic `visual:perf` on the same hardware/environment.

**Commit boundary**

`docs(sp01): record surface recovery evidence and SP-04 seam handoff`

**Rollback**

Documentation follows accepted code. If acceptance fails, do not mark SP-01 done.

## 7. Test diagram

```text
CODE PATHS                                           USER / REVIEW FLOWS

[+] scene surface-mask construction                  [+] corrected Chambers proof
    |-- blurred R/G mask -> existing soft uses           |-- [unit] pose is (193,-263), d=30
    `-- raw R/G/B mask -> new edge path                  `-- [hardware] frame hits authored green
         |-- R mown          [unit contract]
         |-- G green         [unit contract]          [+] course load with classmap
         `-- B bunker        [unit contract]              |-- load succeeds
                                                           |    `-- smooth image [unit]
[+] turf shader ordinary + macro variants                 |         `-- threshold [shader contract]
    |-- raw texture absent in narrow test fallback        `-- smoothing fails
    |      `-- compiles [unit]                                  |-- warning names error [integration]
    |-- raw texture present                                     `-- raw fallback remains visible
    |      |-- gCrisp -> green base [unit + hardware]
    |      |-- mCrisp -> stripes    [unit + hardware]     [+] three-course regression
    |      `-- bCrisp -> sand       [unit + hardware]         |-- Chambers dry links
    |-- collarBand                                          |-- Sawgrass lush/water control
    |      |-- crisp inner/soft outer [unit + hardware]      `-- St Andrews rough/no-aerial control
    |      `-- fades by 70 m          [unit + hardware]
    `-- class-map precedence                            [+] comparison review
           |-- OSM near -> suppress cls R/B [unit]          |-- pixel diff localizes change
           `-- OSM absent -> retain cls R/B  [unit]          `-- reviewer judges improvement

[+] resource lifecycle                                [+] performance diagnostic
    |-- raw texture registered once [unit]                |-- warmup discarded
    `-- material/course disposal path  [full suite]        |-- CPU/GPU evidence recorded
                                                          `-- no >3 ms median GPU addition
```

Coverage goal: every conditional branch introduced by SP-01 has a unit or focused
integration assertion, and every visual claim has a hardware-backed fixed frame.
No new E2E gameplay flow is needed because SP-01 does not alter gameplay state; the
baseline address and UI roles remain regression evidence.

## 8. Failure modes

| Failure | Handling | User/reviewer visibility | Required coverage |
|---|---|---|---|
| Corrected camera still targets non-green source geometry | Task 0 NO-GO; inspect surface identity before tuning | Explicit failed acceptance, not a soft-looking screenshot | Config assertion plus captured frame/source check |
| Raw mask channel paint order loses green or bunker ownership | Reject candidate | Wrong edge is visible; test names channel | Shader/wiring tests and close frames |
| `fwidth` edge shimmers or aliases under movement | Task 0 CHANGE or NO-GO | Visible in orbit/capture sequence | Hardware motion inspection plus fixed frame |
| Crisp edge amplifies bad OSM registration | Bounded softening only if three-course evidence requires it | Visible in rough-OSM control | St Andrews frames |
| Base and HD patches use different masks/materials | Reject candidate | Seam or mismatched surface edge | Input identity test and Chambers HD frames |
| Raw texture is disposed twice or leaked | Reject candidate | Usually silent until course switching | Disposal ownership assertion; full suite |
| Class-map smoothing cannot create/draw a canvas | Warn with real cause; deliberately retain raw texture | Console warning and possible known dot screen | Helper errors plus fallback integration assertion |
| Threshold removes real class-map coverage | Revert Task 5 or retune from evidence | Coverage hole visible | Chambers/Sawgrass controls and ordering tests |
| `osmNear` ignores bunker blue again | Reject candidate | Pale bunker halo remains | Explicit raw-blue and suppression-order tests |
| Shader cache key is stale | Reject candidate | Old program may render despite new source | Exact cache-key tests after each shader step |
| Software renderer or dirty capture is used | Capture fails evidence gate | Typed manifest/failure record | SP-00 harness contracts |
| Residual HD overview seam remains | Route to SP-04; do not hide | Named high-survey evidence | Diagnostic frame and TODO/handover |
| Fragment cost regresses beyond budget | Reject or optimize before acceptance | Perf report | Same-host perf run; ≤3 ms median GPU phase delta |

No planned failure mode is both silent and untested.

## 9. Acceptance

### Automated hard gates

```powershell
node --test test/visual-capture-config.test.mjs
node --test test/classmap-smoothing.test.mjs
node --test test/hd-turf.test.mjs
npm test
npm run visual:smoke -- --output ".shots/visual/sp01/smoke" --require-clean
```

Expected result: all tests pass on Node 22 or newer; hardware smoke publishes a clean
success manifest or records a typed non-qualifying capability failure. A capability
skip is not a visual pass.

### Before/after evidence

Run the corrected-suite base commit and final candidate on the same named Windows
hardware and unchanged data root:

```powershell
npm run visual:capture -- --suite baseline --data-dir "C:\Users\USER\Documents\GitHub\Open-Birdie\data" --output ".shots/visual/sp01/before" --require-clean --course-timeout-ms 900000
npm run visual:perf -- --suite baseline --course chambers-bay --data-dir "C:\Users\USER\Documents\GitHub\Open-Birdie\data" --output ".shots/visual/sp01/perf-before" --show-window --require-clean --course-timeout-ms 900000
npm run visual:capture -- --suite baseline --data-dir "C:\Users\USER\Documents\GitHub\Open-Birdie\data" --output ".shots/visual/sp01/after" --require-clean --course-timeout-ms 900000
npm run visual:compare -- --before "<before-run>" --after "<after-run>" --output ".shots/visual/sp01/compare"
npm run visual:perf -- --suite baseline --course chambers-bay --data-dir "C:\Users\USER\Documents\GitHub\Open-Birdie\data" --output ".shots/visual/sp01/perf-after" --show-window --require-clean --course-timeout-ms 900000
```

Required review verdicts:

- corrected Chambers close green is an authored green and shows a crisp, stable inner
  mow line plus bounded collar;
- Chambers and Sawgrass bunkers have no pale/dotted double edge;
- Sawgrass remains lush; its water and source-geometry gaps do not worsen;
- St Andrews retains broad links/fallback character and does not acquire obviously
  wrong sharp boundaries;
- address/play, sky, QL1 relief, terrain registration, and UI proof frames do not
  regress;
- dot screen is removed where class-map coverage is present;
- high-survey residual HD seam is recorded, not claimed fixed;
- no default-on phase cost greater than 3 ms median GPU time; if GPU timers are
  unsupported, report that fact and compare CPU cadence without upgrading it into a
  GPU pass.

### Review and integration gates

- Candidate worktree clean; candidate SHA and base SHA recorded.
- Independent review confidence at least 75%.
- No unresolved Critical, High, or Medium finding.
- All changed files remain inside SP-01 scope.
- Focused PR only; no dependency, world-context, UI, geometry, physics, or release work.
- After merge, candidate ancestry or integrated-tree equivalence is proven and
  `origin/main` reruns the full suite.

## 10. Done record

Complete only after integration:

| Field | Evidence |
|---|---|
| Implementation owner/worktree | `/root/sp01_implementation`; `C:\Users\USER\.config\superpowers\worktrees\Open-Birdie\sp01-p2a-recovery` |
| Base commit | `88c67d6e1eda2adcc52b8a84643c1b7f15d19ce5` |
| Candidate commit | TBD |
| Pull request / merge commit | TBD |
| Focused tests | TBD |
| Full test count | TBD |
| Before capture | TBD |
| After capture | TBD |
| Comparison report | TBD |
| Hardware / renderer | TBD |
| Performance before/after | TBD |
| Texture/resource delta | One additional raw packed surface-mask texture per loaded course; measured result TBD |
| Independent review | TBD |
| Deviations | TBD |
| SP-04 seam evidence | TBD |

## 11. Parallelization

SP-01 implementation is one sequential lane because `scene.js`, `turf.js`, and
`hd-turf.test.mjs` are shared by nearly every task:

```text
camera/evidence correction
    -> raw mask + crisp edges
    -> collar
    -> class-map precedence
    -> smoothing/fallback
    -> full capture + docs
```

No internal SP-01 worktree split is safe. At the program level, the independent SP-02a
contract-planning lane may run in parallel after SP-01 enters implementation.

## 12. Engineering review record

The historical plan's clean review supports the fwidth-first architecture but did not
clear this current-base recovery by itself.

Current-program review:

| Review | Result | Confidence | Findings |
|---|---|---:|---|
| Legacy recovery audit | GO with correction, no wholesale merge | 92% | Invalid green camera, absent raw bunker channel, silent smoothing failure, SP-00 readiness preservation |
| Independent plan gate, pass 1 | REJECT | 93% | Six Medium: perf comparison, exact camera, test carve-out, additive RGB semantics, recovery order, runtime fallback test |
| Independent plan gate, pass 2 | ACCEPT | 97% | All six corrected; zero unresolved Critical/High/Medium findings |

Dispatch verdict: **READY / YES**. Implementation must follow the exact staged sequence
in Section 2 and return for independent candidate review; plan acceptance is not code
acceptance.
