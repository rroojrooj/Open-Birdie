# SP-02a — CoursePresentation Contract, Identity, Activation, and Asset Delivery

**Status:** READY_FOR_INTEGRATION
**Program charter:** [`2026-07-28-pro-visuals-program-charter.md`](2026-07-28-pro-visuals-program-charter.md)  
**Program ledger:** [`2026-07-28-pro-visuals-program-ledger.md`](2026-07-28-pro-visuals-program-ledger.md)  
**Source design:** user-authored `2026-07-23-pro-visuals-program-design.md`,
`2026-07-23-pro-visuals-master-plan.md`, and
`2026-07-23-pro-visuals-test-plan.md`, read from the protected original
worktree without modifying it  
**Planning/review base:** `origin/main` at
`03a1ff73cd135bac2aa7e9d1d331aa1c2852bd76`  
**Implementation base:** the current `origin/main` containing this accepted plan;
the PIC records the exact SHA before dispatch  
**Target branch:** `codex/sp02a-course-presentation-contract`  
**Owner/module:** unassigned implementation lane; server-side course package
contract and local curated-asset gateway  
**Estimate:** 5–8 focused engineering days plus packaged-root and hardware smoke  
**Dependencies:** SP-00 and SP-01 accepted; SP-02b remains blocked until SP-02a is
accepted and integrated

## 1. Outcome

Loading a course produces one identity-safe, revisioned, immutable-by-ownership
`ResolvedCoursePackage`. A slow or failed course request cannot replace a newer or
currently playable course. Optional curated data can change presentation through a
strict normalized contract, while missing or corrupt curated data falls back to a
generic automatic presentation without leaking another course's content.

This phase establishes the server/data seam. It intentionally does not change the
visible renderer:

- `/api/course-geometry` gains sanitized `courseId`, `contentRevision`,
  `presentation`, `assetManifest`, `terrainPatches`, and diagnostics fields;
- the current browser ignores those new fields until SP-02b;
- `public/render/scene.js`, shader uniforms, placement logic, and GPU asset ownership
  remain unchanged;
- the existing name-based `courseDryFor()` consumer is removed only in SP-02b, after
  the browser consumes normalized presentation.

Observable proof is behavioral rather than a beauty claim:

- two same-name courses cannot share a base cache or curated pack;
- renaming a course with the same OSM source keeps its identity and HD v2
  compatibility;
- failed preparation leaves the previous course, revision, HD state, and readiness
  timer intact;
- slow request A cannot commit after newer request B;
- active curated assets are available only through a revision/key allowlist;
- packs-disabled mode resolves Chambers, Sawgrass, St Andrews, and unknown fixtures as
  `tier: "automatic"` and ignores legacy curated sidecars;
- the accepted SP-01 visual baseline remains pixel-equivalent because no renderer
  consumer changes.

Viewing bands affected: none intentionally. The address, feature, hole, course, and
world bands are regression controls.

Proof courses:

- Chambers Bay — stable identity `osm:way:26787026`, curated and packs-disabled paths;
- TPC Sawgrass — lush automatic control and no Chambers leakage;
- St Andrews Old Course — rough/legacy-cache control;
- two synthetic same-name/different-origin fixtures;
- one unknown/no-pack fixture.

## 2. What already exists

### Course acquisition and caches

`lib/course.js` already owns:

- `searchCourses()` and Nominatim `osmType`/`osmId` results;
- `loadCourse()` and the complete OSM/elevation/aerial/class-map acquisition path;
- `listCached()` and `loadCached()`;
- `applySurfaceOverride()` and `loadSurfaceOverride()`;
- atomic single-file JSON writes through `.tmp` plus rename.

The acquisition work is reusable, but selection is currently unsafe:

- `loadCourse()` keys JSON by `slug(name)`;
- aerial and class-map filenames also use `slug(name)`;
- `parseOsm()` drops the OSM source identity;
- a cache hit checks only cache version and hole presence;
- legacy surface/pin sidecars are selected by display name and mutate the supplied
  course.

Existing tests to retain and extend:

- `test/cache-path.test.js`
- `test/course-classmap.test.js`
- `test/course-override.test.js`
- `test/course-curated-fallback.test.js`

### HD fingerprint and path safety

`lib/hd-bundle.js` and `tools/hd-course/course-source.mjs` contain byte-equivalent
canonical sorting and SHA-256 fingerprint logic. Runtime bundle validation returns
typed `absent`, `rejected`, or `valid` states. The compiler and runtime already have a
parity assertion.

The current fingerprint is v1:

- it includes mutable `course.name` and hole names;
- manifests do not identify a fingerprint version;
- runtime and compiler compute duplicate implementations;
- `resolveHdBundles()` compares only one fingerprint.

`lib/hd-bundle.js:resolveAssetPath()` and
`tools/hd-course/paths.mjs:resolveWithin()` provide useful containment patterns.
Course-art validation must add realpath containment so a Windows junction or symlink
cannot escape an allowed root.

Tests to reuse:

- `test/hd-fingerprint.test.mjs`
- `test/hd-bundle.test.js`
- `test/hd-resolve-bundle.test.mjs`
- `test/hd-paths.test.mjs`
- `test/hd-manifest.test.mjs`
- `test/hd-compiler.test.mjs`

### Server activation and readiness

`server.js:activateCourse()` currently:

1. resolves HD bundles;
2. mutates `activeHd`;
3. increments `courseRevision`;
4. loads and mutates the course with a legacy override;
5. calls `game.setCourse()`;
6. replaces the HD readiness timer.

`POST /api/load-course` awaits `loadCourse()` before any generation is allocated, so
slow A can commit after fast B. A failure after `activeHd` or revision mutation can
leave mixed state.

`lib/hd-readiness.js:verifyReadinessAck()` already validates revision, bundle IDs,
primary nonce, loopback origin, and mode. Preserve this contract.

`lib/game.js:Game.setCourse()` already centralizes physics activation, but assigns
`this.course` before constructing every derived value. It needs a prepare-then-commit
primitive so a sampler/surface error cannot leave partial game state.

Existing tests:

- `test/game.test.js`
- `test/robustness.test.js`
- `test/hd-readiness.test.js`
- `test/hd-terrain-inject.test.js`
- the synthetic server exercised by `test/visual-capture-config.test.mjs`

### Presentation and current manual data

`public/render/course-character.js` provides reusable pure palette data and
`blendPalette()`. It also contains the renderer-side manual `COURSE_DRY` name map:

- Chambers Bay `0.85`;
- TPC Sawgrass `0.0`;
- St Andrews Old Course `0.7`;
- Bandon Dunes `0.8`.

SP-02a commits the exact Chambers identity/profile required to prove the contract. It
does not yet remove the renderer map. Before SP-02b deletes that map, SP-02b must
discover, independently verify, and commit identity-bound St Andrews and Bandon
profiles (or a reviewed generic derivation) so their current non-default values do not
silently disappear. Sawgrass remains the zero/default control.

Ajv is already a development dependency. No course-art schema, generated standalone
validator, pack index, presentation resolver, asset manifest, or content revision
exists.

### HTTP and packaged roots

`lib/hd-http.js` is the closest serving template:

- exact opaque lookup;
- GET/HEAD;
- fixed MIME handling;
- private paths retained server-side.

The current course aerial/class-map endpoints use `path.basename()` but have no active
content revision, opaque registry, content hash, immutable ETag, total byte budget, or
realpath containment.

`main.js` already redirects writable course data to `BIRDIE_DATA_DIR` in packaged
mode. `package.json` includes `lib/**/*` and `public/**/*`, but no
`BIRDIE_ART_DIR` or `extraResources/course-art` contract exists.

### Historical work

No prior SP-02 identity/package implementation branch was found. The user-authored
design documents are requirements, not executable code. Do not copy SP-01 renderer
changes into this lane; SP-01 is already integrated.

## 3. Scope and non-scope

### In scope

- Stable OSM identity and geographic legacy identity.
- Source-keyed JSON, aerial, and class-map cache artifacts.
- Verified, recoverable migration from name-keyed legacy caches.
- HD fingerprint v2 plus explicit v1 read compatibility.
- Strict course-art schema v1 and committed standalone validator.
- Canonical multi-file authoring pack and deterministic runtime staging contract.
- Automatic and curated presentation adapters with one normalized output.
- Packs-disabled isolation and temporary identity-verified legacy sidecar adapter.
- Runtime asset validation, hashing, public/private manifest split, and
  `contentRevision`.
- Pure `ResolvedCoursePackage` preparation.
- Atomic `Game` prepare/commit primitive.
- Separate latest-only activation generation and committed course revision.
- Server startup and POST activation through the same manager.
- Sanitized geometry/package response.
- Active-package GET/HEAD asset gateway with revision, key, ETag, limits, and
  containment.
- Development and packaged course-art roots.
- Typed diagnostics and public redaction.
- Empty ordered terrain-patch transport and capability declaration.
- Full unit/contract/server/package-fixture verification.
- Renderer smoke and fixed-frame regression proving no visible change.

### Not in scope

- No `public/render/scene.js` presentation wiring.
- No renderer load generation or `CourseBuildContext`.
- No reference-counted browser texture/model registry.
- No removal of `courseDryFor()` or renderer name map until SP-02b.
- No world, coast, atmosphere, surface-material, vegetation, landmark, or HUD visual
  implementation.
- No terrain-feature compiler. Schema-valid non-empty terrain-feature requests are
  rejected by capability policy until SP-05.
- No live art-pack preview or general authoring CLI. SP-07a owns authoring workflow;
  SP-02a owns only validation and deterministic runtime staging.
- No CDN, remote service, or renderer filesystem access.
- No deletion of legacy caches or sidecars during migration.
- No broad dependency upgrade or `npm audit fix`.
- No change to golf physics except making course commit failure-atomic.

### Deferred ownership

| Deferred item | Owner |
|---|---|
| Browser generation, abort, stale-result disposal | SP-02b |
| Normalized presentation consumed by renderer | SP-02b |
| Shared GPU asset handles | SP-02b |
| World/coast/atmosphere implementation | SP-03 |
| HD/far-photo seam and material presentation | SP-04 |
| Terrain-feature compilation | SP-05 |
| Vegetation/landmarks | SP-06 |
| Authoring validation CLI and reference hydration | SP-07a |
| Packaged preview and second-pack proof | SP-07b |

## 4. Task 0 — Contract and transaction falsification gate

### Hypotheses

1. One server-owned normalized presentation object can express all current character
   intent without exposing shader uniforms or local paths.
2. Stable source identity can key every new cache artifact while legacy caches remain
   readable through a verified, non-destructive migration.
3. HD v2 can ignore display names while v1 bundles continue to resolve.
4. Course activation can prepare all fallible work before a non-throwing commit.
5. A public asset manifest can contain only opaque keys while the server retains exact
   validated absolute paths privately.

### Cheapest falsification

Before production edits, create pure fixtures and tests that prove:

- Chambers, Sawgrass, and unknown courses normalize through the same presentation
  shape;
- same name plus different OSM IDs yields different cache bases;
- same OSM ID plus renamed display name yields the same cache base and v2
  fingerprint;
- a legacy cache matches only normalized name plus origin within 250 m;
- a deferred A/B activation manager commits only B;
- a prepared package serializes without private paths;
- a temporary asset root rejects `..`, absolute paths, and a realpath escape.

### GO

Proceed when:

- normalized examples have no renderer uniform or filesystem field;
- v1 and v2 fingerprint fixtures both pass;
- active state is unchanged after injected prepare failure;
- the public/private asset split is explicit and tested.

### CHANGE

- If existing benchmark caches lack source identity, keep them readable and migrate
  only after request name plus geographic proof. Do not invent a source ID.
- If an old HD manifest cannot identify v1 explicitly, treat missing
  `fingerprintVersion` as v1. Never rewrite it silently.
- If a junction/symlink cannot be created in CI, keep pure realpath tests mandatory
  and run the actual Windows escape case on the named release machine.
- If automatic derivation cannot preserve a current manual value generically, keep
  that value in an identity-bound curated source profile. Do not add an automatic
  name/ID special case.

### NO-GO

Stop and return to plan review if:

- a complete course package requires renderer-specific fields;
- successful preparation must mutate `game`, `activeHd`, the current timer, or the
  base course;
- v1 compatibility requires weakening v2 identity verification;
- the asset gateway cannot prove realpath containment or public diagnostic redaction;
- duplicate stable identities or overlapping legacy aliases cannot fail
  deterministically.

## 5. Architecture

### 5.1 Resolved contradictions

| Source tension | Decision |
|---|---|
| SP-02a is renderer-free, but the full SP-02 exit expects renderer presentation consumption | SP-02a produces and serves the contract; SP-02b consumes it and removes the renderer name map. Packs-disabled server assertions belong to SP-02a; visible byte-equivalence belongs to SP-02b. |
| Design load order derives identity after HD | Normalize identity before any v2 fingerprint or HD resolution. HD still sees the untouched base course. |
| Schema mentions terrain features while pre-SP-05 tests reject them | Structural validation accepts the defined shape; package capability policy rejects any non-empty request with `ART_CAPABILITY_UNSUPPORTED`. |
| Unknown fields fail only in development | Unknown fields fail closed in every environment so accepted bytes and revisions are deterministic. |
| Multi-file source pack has one named schema | `profile.json` is the canonical root; it references a closed set of component files. One schema owns root and component `$defs`; the generator exports validators for each entry point. |
| Activation generation and course revision are ambiguous | `activationGeneration` increments per request before acquisition; `courseRevision` increments only on successful commit. |
| Manual values exist for more than Chambers | Non-default values required for default pack-enabled regression become identity-bound curated profiles; automatic mode remains generic. |

### 5.2 Stable identity

New module: `lib/course-identity.js`.

Public pure interface:

```js
normalizeCourseSource({ osmType, osmId }) -> {
  courseId: "osm:way:26787026",
  osmType: "way",
  osmId: 26787026
}

deriveRequestedOrigin({ lat, lon, bbox }) -> { lat, lon } | null

normalizeDisplayName(name) -> normalized string

legacyIdentityMatches({
  requestedName,
  requestedOrigin,
  cachedName,
  cachedOrigin,
  toleranceM: 250
}) -> boolean

courseCacheStem(source) -> "osm-way-26787026"
```

Rules:

- OSM type is exactly `node`, `way`, or `relation`.
- OSM ID is a safe positive integer.
- Stable identity is `osm:<type>:<id>`.
- Stable identity always wins over display name.
- Requested origin uses explicit `lat/lon`, then bbox center, otherwise null.
- Legacy matching requires normalized alias equality and Haversine distance at or
  below 250 m.
- A malformed or missing identity never selects a stable-ID pack.
- Duplicate packs claiming one `courseId`, or legacy aliases whose 250 m regions
  overlap, fail pack-index validation; there is no order-dependent winner.

### 5.3 Source-keyed caches and non-destructive migration

For new fetches:

```text
data/courses/
  osm-way-26787026.json
  osm-way-26787026.aerial.jpg
  osm-way-26787026.classmap.png
```

The cache JSON retains current cache `version: 4` and adds:

```json
{
  "source": {
    "courseId": "osm:way:26787026",
    "osmType": "way",
    "osmId": 26787026
  }
}
```

This is an additive cache field, not a course-shape version bump. Keeping version 4
prevents an identity migration from invalidating existing HD v1 bundles.

Cache lookup order:

1. derive and validate requested stable source;
2. read the source-keyed JSON if it exists;
3. verify its embedded source exactly;
4. otherwise inspect the legacy `slug(name).json`;
5. migrate only if normalized name and origin tolerance pass;
6. write source-keyed asset copies through `.tmp` plus rename;
7. write the cloned source-keyed JSON last;
8. keep original legacy files untouched for rollback;
9. return the keyed course.

A failed migration removes only owned `.tmp` files. It never renames, truncates, or
deletes the legacy set.

`listCached()` deduplicates source-keyed and verified legacy entries by `courseId`.
Public entries include `{ file, name, courseId }`; no absolute path.

### 5.4 Fingerprint versions

New shared conceptual owner: `lib/course-fingerprint.js`. Because runtime is CJS and
compiler tooling is ESM, one implementation may be wrapped by ESM rather than copied.
If module interoperability prevents one file, byte-parity tests remain mandatory and
both implementations import the same canonical field specification fixture.

```js
courseFingerprintV1(course) // exact existing bytes
courseFingerprintV2(course, courseId)
courseFingerprintFor(course, { version, courseId })
```

V2 canonical fields:

- constant fingerprint schema `2`;
- stable `courseId`;
- origin;
- boundary;
- sorted surface kind/polygons;
- sorted holes: ref, par, tee, pin, line, length only;
- sorted trees and woods;
- coarse elevation metadata/heights;
- no course display name;
- no hole display name;
- no presentation, aerial, class map, buildings, generated green patches, curated
  gameplay overlay, or runtime asset bytes.

Build/runtime manifest rule:

- absent `course.fingerprintVersion` on an already-built manifest means v1;
- new discover/build output writes both `fingerprintVersion: 2` and the exact
  `courseId`;
- the v2 compiler requires a valid `course.source.courseId` and rejects source-less
  input with `HD_SOURCE_ID_REQUIRED`;
- the v2 compiler rejects disagreement between requested/manifest identity and cached
  `course.source.courseId` with `HD_SOURCE_ID_MISMATCH`;
- source-less legacy inputs are not rebuilt; already-built v1 manifests remain
  runtime-readable when their version field is absent or explicitly `1`;
- runtime v2 resolution requires the active base course identity to equal the
  descriptor identity before comparing fingerprint bytes;
- runtime selects the matching computation;
- unsupported versions produce a typed rejected descriptor and procedural fallback;
- committed v1 manifests remain byte-compatible and are not rewritten.

### 5.5 Source-pack and runtime-pack contract

Source authoring and runtime consumption are deliberately different contracts.
Development and packaged execution both consume the same staged runtime shape; the
server never interprets raw authoring components.

Authoring source:

```text
courses/curated/
  index.json
  chambers-bay/
    profile.json
    references.json
    landmarks.json
    vegetation.json
    terrain-features.json
    assets/
```

Staged runtime root:

```text
build/course-art/
  index.json
  packs/
    chambers-bay/
      manifest.json
      assets/
        green-normal.<sha-prefix>.ktx2
        clubhouse.<sha-prefix>.glb
```

Packaged runtime root has the identical relative tree at
`process.resourcesPath/course-art`. `BIRDIE_ART_DIR` always means the root containing
runtime `index.json`; in development it defaults to `build/course-art`, never
`courses/curated`.

Source `index.json` is closed schema v1. It maps stable identity to a source pack
directory and repeats only selection metadata—pack ID, `courseId`, and legacy
aliases/origin—so a corrupt selected `profile.json` still produces one actionable
diagnostic. The stage compiler cross-checks the index and profile; any disagreement or
duplicate/overlapping selector fails the whole staging command.

Source `profile.json` is the canonical authoring root:

```json
{
  "version": 1,
  "courseId": "osm:way:26787026",
  "displayName": "Chambers Bay",
  "legacyMatch": {
    "names": ["Chambers Bay"],
    "origin": {
      "lat": 47.2057007,
      "lon": -122.5750529,
      "toleranceM": 250
    }
  },
  "tier": "curated",
  "character": { "biome": "pnw-links", "dryness": 0.85 },
  "world": {},
  "atmosphere": {},
  "materials": {},
  "components": {
    "references": "references.json",
    "landmarks": "landmarks.json",
    "vegetation": "vegetation.json",
    "terrainFeatures": "terrain-features.json"
  },
  "gameplay": {},
  "assets": {
    "clubhouse": {
      "path": "assets/clubhouse.glb",
      "mime": "model/gltf-binary",
      "required": false
    }
  }
}
```

The source schema owns separate entry points for `index.json`, `profile.json`, and
each component `$defs`. Component rules:

- `references.json` is authoring-only provenance and is excluded from runtime staging
  and `contentRevision`;
- landmarks, vegetation, terrain features, gameplay overlays, and runtime asset
  declarations are validated and normalized;
- missing optional component files normalize to empty;
- an explicitly referenced corrupt component rejects the selected pack;
- raw references and authoring intermediates never enter the installer.

Runtime `index.json` has its own closed schema:

```json
{
  "version": 1,
  "packs": [
    {
      "packId": "chambers-bay",
      "courseId": "osm:way:26787026",
      "legacyMatch": {
        "names": ["Chambers Bay"],
        "origin": {
          "lat": 47.2057007,
          "lon": -122.5750529,
          "toleranceM": 250
        }
      },
      "manifest": "packs/chambers-bay/manifest.json"
    }
  ]
}
```

Runtime `manifest.json` also has a separate closed schema. It contains:

- runtime contract version and opaque `packId`;
- stable selection identity copied from the validated source;
- already-normalized presentation;
- already-validated gameplay overlay and empty capability/patch records;
- normalized optional feature records `{ id, required, assetKeys, payload }`;
- only present runtime assets:
  `{ key, file, mime, bytes, sha256, required }`;
- no source filename other than safe runtime-relative `manifest`/asset file entries;
- no references, authoring components, or absolute paths.

The runtime loader validates runtime index and manifest with runtime entry-point
validators; it never calls the source-pack loader. Corrupt staged index means curated
mode is unavailable and emits one root diagnostic. A corrupt selected runtime manifest
falls back only that course to automatic.

`lib/course-art-assets.js` owns both explicitly named sides without conflating them:

```js
stageSourceCourseArt({ sourceRoot, outputRoot }) -> stagedSummary

loadRuntimeCourseArt({
  runtimeRoot,
  courseId,
  legacyIdentity,
  disabled
}) -> {
  status: "disabled" | "absent" | "rejected" | "valid",
  runtimePack,
  diagnostics
}
```

Only the staging function imports source validators. The server imports only the
runtime loader and bundled runtime validator entry points.

Optional assets have one unambiguous policy:

- any structural, security, path, type, magic, dimension, or limit error rejects the
  selected source pack regardless of `required`;
- a missing `required:true` asset rejects the selected source pack;
- a missing `required:false` asset removes the asset and prunes every optional feature
  that references it before normalization and hashing;
- a required feature may reference required assets only; schema/cross-field validation
  rejects any required-feature/optional-asset combination;
- a shared missing optional asset prunes all referencing optional features;
- `contentRevision` is computed from the post-prune runtime manifest.

Both source and runtime schemas are strict and closed in every environment. Central
limits live in
`lib/course-art-limits.js` and are imported by runtime checks and generator tests:

| Limit | v1 value |
|---|---:|
| Root/component JSON file | 1 MiB each |
| Runtime assets | 256 |
| Single asset | 128 MiB |
| Total runtime assets | 512 MiB |
| Source texture dimension | 8192 px |
| Asset key | 1–64 chars, `^[a-z][a-z0-9._-]*$` |
| Local coordinate envelope | ±20,000 m |
| Landmark instances | 4,096 |
| Vegetation rules | 256 |
| Terrain feature declarations | 512 |
| Legacy aliases | 16 |

Allowed runtime v1 asset types:

- PNG;
- JPEG;
- WebP;
- KTX2;
- self-contained GLB.

SVG, HTML, JavaScript, external glTF graphs, arbitrary JSON, absolute paths, device
paths, alternate data streams, traversal, junction escapes, and unknown extensions are
rejected. Extension, declared MIME, magic bytes, dimensions where applicable, file
size, and SHA-256 must agree.

GLB validation parses the header and every chunk:

- exact magic/version/declared length;
- one valid JSON chunk and bounded embedded BIN chunks;
- no `uri` on buffers or images, including data/file/http values;
- images use embedded `bufferView` bytes only;
- referenced buffer views stay within chunk bounds;
- embedded image magic and dimensions obey the same texture limits;
- total embedded bytes obey the pack budget.

Windows path/key hardening additionally rejects reserved device names, drive/UNC/ADS
syntax, trailing dot/space, and case-fold collisions.

Ajv and esbuild remain development-only. `generate-validator.mjs`:

1. asks Ajv for standalone source entry points for source index/profile/components and
   runtime index/manifest;
2. bundles that source with esbuild into one dependency-free CJS artifact;
3. fails if the final artifact has a bare `require()` or dynamic import;
4. writes `lib/generated/course-art-pack-validator.js` deterministically.

The packaged app imports only the bundled artifact. Verification:

- regeneration in a temporary directory must be byte-identical;
- copy the artifact and fixtures into an isolated directory with no `node_modules` and
  execute it under Node;
- build the unpacked Windows application and execute a packaged
  `BIRDIE_COURSE_ART_SMOKE=1` path that imports the validator and validates the staged
  runtime index/manifest before quitting;
- inspect the unpacked resources to prove Ajv, esbuild, source references, and
  authoring files are absent.

### 5.6 Presentation adapters

New module: `lib/course-presentation.js`.

```js
resolveCoursePresentation({
  course,
  courseId,
  stagedRuntimePack,
  packsEnabled,
  environment
}) -> {
  courseId,
  tier,
  character,
  world,
  surfaces,
  materials,
  vegetation,
  landmarks,
  atmosphere,
  assetKeys,
  qualityHints,
  diagnostics
}
```

Automatic adapter:

- returns one complete frozen normalized shape;
- uses generic defaults and broad data/geography signals only;
- has no course display-name or stable-ID cases;
- never reads legacy surface/pin sidecars;
- default dryness is `0` until a reviewed generic signal exists;
- never exposes file paths or shader uniforms.

Curated adapter:

- is selected only by verified stable ID or valid legacy alias plus origin;
- consumes only a validated staged runtime manifest;
- overlays only schema-owned fields;
- clamps no invalid values silently; invalid input rejects the pack;
- missing pack returns automatic with no diagnostic;
- corrupt/unsupported selected pack returns automatic plus exactly one root
  actionable diagnostic;
- non-empty terrain-feature declarations produce
  `ART_CAPABILITY_UNSUPPORTED` and reject the selected pack until SP-05;
- packs-disabled mode skips pack and legacy compatibility lookup completely.

One composition gate owns rollback: `BIRDIE_DISABLE_CURATED=1`, default unset/off.
When set, runtime-pack discovery and the course-art gateway are both disabled and the
package resolves automatic presentation. Identity/cache and HD v2 foundations have no
feature switch; their rollback is a focused commit revert while v1 read compatibility
remains.

Legacy compatibility:

- is considered curated input, never automatic;
- is allowed only when packs are enabled and identity has been verified;
- wraps the current sidecar through the same gameplay-overlay validator;
- is applied to a cloned gameplay course;
- emits one deprecation diagnostic;
- is ignored in packs-disabled mode;
- remains until source profiles contain the required gameplay data.

### 5.7 Diagnostics

New module: `lib/course-diagnostics.js`.

Public records:

```js
{
  code,
  severity: "info" | "warning" | "error",
  stage,
  courseId,
  message,
  recovery
}
```

Rules:

- records never contain an absolute root, stack, raw exception object, query secret,
  or local username;
- private logs may retain a redacted cause ID and stack;
- expected missing pack is silent;
- corrupt selected pack emits one root warning and falls back;
- core acquisition/gameplay preparation errors abort activation;
- API responses expose code/stage/recovery, not raw `err.message`;
- duplicate diagnostics are collapsed by code/stage/courseId;
- unexpected `error` diagnostics fail benchmark/release evidence.

Required initial codes:

- `COURSE_IDENTITY_INVALID`
- `CACHE_IDENTITY_MISMATCH`
- `CACHE_LEGACY_MIGRATION_REJECTED`
- `HD_FINGERPRINT_VERSION_UNSUPPORTED`
- `ART_PACK_INVALID`
- `ART_PACK_VERSION_UNSUPPORTED`
- `ART_PACK_IDENTITY_MISMATCH`
- `ART_PACK_CONFLICT`
- `ART_ASSET_INVALID`
- `ART_ASSET_MISSING`
- `ART_CAPABILITY_UNSUPPORTED`
- `ACTIVATION_SUPERSEDED`
- `ACTIVATION_PREPARE_FAILED`
- `COURSE_ART_NOT_FOUND`

### 5.8 ResolvedCoursePackage preparation

New module: `lib/resolved-course-package.js`.

```js
prepareCourseCandidate({
  baseCourse,
  requestedIdentity,
  packsEnabled,
  dataDir,
  artDir,
  resolveHd,
  loadRuntimePack,
  loadLegacyOverride,
  prepareGame
}) -> Promise<PreparedCourseCandidate>

PreparedCourseCandidate = {
  courseId,
  contentRevision,
  baseCourse,
  gameplayCourse,
  terrainPatches,
  presentation,
  hdDescriptors,
  publicAssetManifest,
  privateAssetManifest,
  diagnostics,
  preparedGameState
}

ResolvedCoursePackage = {
  ...publicCandidateData,
  courseRevision
}

ActiveCourseState = {
  publicPackage: ResolvedCoursePackage,
  privateAssetManifest,
  hdDescriptors
}
```

Preparation order:

```text
clone acquired cache object as untouched base ownership
    -> normalize/verify stable identity
    -> resolve HD v1/v2 against untouched base
    -> locate and validate complete optional staged runtime pack
    -> normalize automatic/curated presentation
    -> clone base as gameplayCourse
    -> validate/apply curated or compatibility gameplay overlays to clone
    -> declare empty terrain-feature patch list/capabilities
    -> validate/hash runtime assets into private/public manifests
    -> compute contentRevision
    -> call injected prepareGame(gameplayCourse, options) without assignment
    -> return PreparedCourseCandidate with no activation/course revision
```

`PreparedCourseCandidate` is private to the activation manager and is never broadcast.
It contains all fallible work, including prepared Game state, but no
`activationGeneration` or `courseRevision`.

`ActiveCourseState` is the activation manager's retained private record. `current()`
returns only `publicPackage`; the HTTP gateway receives a private lookup capability
over `privateAssetManifest`, never the record itself. Commit moves the candidate's
private manifest and HD descriptors into the active record atomically with the public
package and prepared Game state. Superseded/failed candidates are discarded.

New module `lib/canonical-json.js` defines the exact bytes used for
`contentRevision`:

- recursively normalize strings to Unicode NFC;
- reject all non-finite numbers and normalize negative zero to zero;
- serialize numbers using ECMAScript `JSON.stringify` shortest round-trip form;
- sort object keys by Unicode code-unit order, never locale;
- sort map-like asset/feature records by validated key before serialization;
- preserve schema-declared semantic array order, including terrain patch and gameplay
  override precedence;
- encode UTF-8 with no BOM, whitespace, or trailing newline;
- exclude all absolute/runtime root strings before canonicalization.

`contentRevision` is SHA-256 over those canonical bytes for:

- contract version;
- `courseId`;
- normalized accepted presentation;
- validated gameplay overlays;
- ordered terrain-patch metadata;
- each public asset key, MIME, byte size, and content hash.

It excludes:

- display-only source filenames;
- absolute paths;
- authoring references;
- diagnostics text;
- activation generation;
- committed `courseRevision`;
- base display name when it does not affect presentation.

Changing presentation, gameplay overlay, or same-key asset bytes changes
`contentRevision`. Presentation-only changes do not alter the HD base fingerprint.
Object insertion order, source/runtime path spelling, line endings, locale, and
development versus packaged root do not change it.

Candidate normalized metadata is frozen after preparation. Large course/elevation
arrays are not recursively frozen because that would add an O(n) activation cost;
immutability is enforced by exclusive ownership, defensive cloning, and tests that
hash the base before/after every fallible stage. The commit-time active
`ResolvedCoursePackage` is created only after the final stale-generation check and
includes the allocated `courseRevision`.

### 5.9 Game and activation transaction

`lib/game.js` adds:

```js
game.prepareCourse(course, options) -> preparedGameCourse
game.commitPreparedCourse(preparedGameCourse) // assignment-only, non-throwing
game.setCourse(course, options) // backward-compatible wrapper
```

All validation, surface lookup, terrain sampler construction, starting-hole selection,
and derived values happen in `prepareCourse()`. No active field changes until
`commitPreparedCourse()`.

New module: `lib/course-activation.js`.

```js
createCourseActivationManager({
  acquireCourse,
  prepareCandidate,
  commitPreparedActivation,
  onCommitted
}) -> {
  activate(request) -> Promise<
    { status: "committed", package, courseRevision } |
    { status: "superseded", generation } |
    { status: "failed", diagnostic }
  >,
  current()
}
```

State machine:

```text
request arrives
    -> increment activationGeneration
    -> derive stable source key
    -> ask acquisition coordinator to acquire(source key)
         same key already in flight -> attach; preserve its shared fetch
         different stale key -> coordinator may abort its fetch where supported
    -> if generation stale: return superseded, no mutation
    -> prepare PreparedCourseCandidate + Game state
    -> if generation stale: return superseded, no mutation
    -> allocate next committed courseRevision
    -> create/freeze ResolvedCoursePackage public record
    -> synchronously call non-throwing commitPreparedActivation once:
         commit Game prepared state
         replace active package/HD/revision
         replace readiness timer
    -> run broadcast/onCommitted observers behind exception isolation
```

`activationGeneration` and `courseRevision` are separate. Failed or superseded
attempts do not change current package or revision.

`commitPreparedActivation()` accepts exactly the candidate, resolved public record,
and prepared timer specification. It performs assignment only, cannot invoke user
callbacks, and is covered by a test that forces every preparation dependency to throw.
Observer/broadcast failure after commit is logged as a typed diagnostic; it cannot
roll back or mix Game/package/HD/timer state and does not trigger a second commit.

`bootstrap()` defines startup ordering:

1. honor `BIRDIE_NO_AUTOLOAD`;
2. otherwise await autoload through the same manager before `server.listen()`;
3. successful autoload commits before the port is reachable;
4. typed autoload failure logs one redacted diagnostic and the server still listens
   with no active course;
5. POST activation cannot race bootstrap because the listener is not open yet.

A superseded POST returns typed 409 without broadcasting. An unexpected failure
returns a redacted typed error and leaves the prior course playable.

Course acquisition also coordinates disk effects:

- the acquisition coordinator owns every underlying `AbortController`; activation
  callers never abort a shared promise directly;
- one in-flight acquisition promise per stable `courseId`;
- concurrent requests for the same identity attach to the shared promise without
  aborting it, even when the later request supersedes the earlier generation;
- a request for a different identity may cause the coordinator to abort an obsolete
  acquisition where the transport supports abort;
- different identities use unique `.tmp.<pid>.<nonce>` paths;
- activation generation governs active commit, while the acquisition coordinator
  governs cache publication;
- publication rechecks whether a valid source-keyed cache already won before rename.

### 5.10 Public package and active asset gateway

`courseGeometry()` returns the current gameplay geometry plus:

```js
{
  courseId,
  courseRevision,
  contentRevision,
  presentation,
  terrainPatches,
  assetManifest: {
    [assetKey]: {
      url,
      mime,
      bytes,
      sha256
    }
  },
  diagnostics
}
```

No filesystem path, authoring filename, private reference, or pack root is serialized.

New module: `lib/course-art-http.js`.

```text
GET|HEAD /api/course-art/:contentRevision/:assetKey
    -> exact active contentRevision
    -> valid opaque key
    -> exact private-manifest entry
    -> walk/reject reparse-point ancestors and resolve canonical staged path
    -> open the canonical file once
    -> compare opened handle file identity/size to activated private manifest
    -> hash and validate MIME/magic from that exact opened handle
    -> compare SHA-256 to active manifest
    -> ETag/conditional response
    -> stream from the already-verified handle
```

Response:

- `Content-Type` from validated manifest;
- `Content-Length`;
- `ETag: "sha256-<hash>"`;
- `Cache-Control: private, max-age=31536000, immutable`;
- `X-Content-Type-Options: nosniff`;
- `If-None-Match` returns 304;
- HEAD returns identical headers and no body.

HEAD and conditional 304 still open/hash/verify current bytes before returning; a
same-size same-magic replacement can never reuse the old revision/ETag. The read stream
uses the verified file handle with explicit error and exactly-once close handling.
Unlink, rename, junction, and symlink swaps are rejected by file-identity/hash mismatch.

Wrong/stale revision, unknown key, encoded traversal, and inactive content return a
generic typed 404. Malformed/reserved/case-colliding key returns generic 400. No error
body contains a path.

Development and packaged execution both consume runtime staging. Development root
defaults to `build/course-art`. Packaged `main.js` sets:

```js
process.env.BIRDIE_ART_DIR = path.join(process.resourcesPath, "course-art")
```

Electron Builder copies only `build/course-art` through `extraResources`; raw
references, tools, and authoring files are excluded. Staging is an atomic sibling
directory build plus rename, and `/build/course-art/` is ignored.

Exact scripts:

```json
{
  "prepare:course-art": "node tools/course-art/prepare-runtime.mjs",
  "check:course-art": "node tools/course-art/prepare-runtime.mjs --check",
  "start": "npm run prepare:course-art && electron .",
  "start:server": "npm run prepare:course-art && node server.js",
  "pack": "npm run prepare:course-art && electron-builder --dir",
  "dist": "npm run prepare:course-art && electron-builder --win"
}
```

The preparation command must be deterministic, may replace only its owned
`build/course-art` target, and leaves a clean checkout clean because that target is
ignored. CI runs `check:course-art`, isolated validator execution, unpacked package
inspection, and the packaged smoke mode.

### 5.11 Dependency and ownership diagram

```text
search/request source
        |
        v
course-identity.js -----> source-keyed course.js cache
        |                           |
        +---------------------------+
        |
        v
course-fingerprint.js -> HD v1/v2 resolver (untouched base)
        |
        v
course-art index/schema/standalone validator
        |
        +---- absent ----------------> AutomaticPresentationAdapter
        |
        +---- valid -----------------> CuratedPresentationAdapter
        |
        +---- invalid ---------------> one diagnostic + automatic
        |
        v
course-art-assets.js -> private paths + public opaque manifest
        |
        v
resolved-course-package.js -> prepared Game state
        |
        v
course-activation.js latest-only commit
        |
        +---- server active package
        +---- Game active course
        +---- HD readiness state
        +---- sanitized course geometry
        +---- revisioned asset gateway
```

Ownership:

- acquisition owns the returned base object until package preparation clones it;
- the package owns its base clone, gameplay clone, HD descriptors, and manifests;
- `Game` owns only committed prepared gameplay state;
- the server owns the active package and readiness timer;
- the private asset manifest owns no file descriptors, only validated path metadata;
- each HTTP request owns and closes its read stream;
- SP-02a creates no GPU resource.

## 6. Implementation tasks

### Task 1 — Pin contracts and Task 0 fixtures

**Files**

- `test/fixtures/course-presentation/automatic-course.json` (new)
- `test/fixtures/course-presentation/chambers-profile.json` (new)
- `test/fixtures/course-presentation/same-name-a.json` (new)
- `test/fixtures/course-presentation/same-name-b.json` (new)
- `test/course-presentation-contract.test.js` (new)
- this plan and program ledger

**Behavior**

- Commit the normalized presentation/package examples.
- Pin public/private manifest separation.
- Pin the two revision counters and diagnostic shape.
- Run the Task 0 falsification cases before production extraction.

**Tests first**

- No normalized/public object contains a Windows drive, leading slash path, `..`, or
  shader uniform name.
- Same external interface covers automatic and curated examples.
- Deferred A/B fake manager proves latest-only semantics.

**Commit**

`test(sp02a): pin course package and presentation contracts`

**Rollback**

Delete fixtures/tests only; no production behavior has changed.

### Task 2 — Stable identity and source-keyed cache artifacts

**Files**

- `lib/course-identity.js` (new)
- `lib/course.js`
- `test/course-identity.test.js` (new)
- `test/course-cache-identity.test.js` (new)
- `test/cache-path.test.js`
- `test/course-classmap.test.js`

**Behavior**

- Add strict OSM and geographic identity helpers.
- Persist `source` on new cache objects.
- Key JSON, aerial, and class-map artifacts by stable source.
- Verify source on cache hit.
- Implement non-destructive atomic legacy migration.
- Coalesce concurrent acquisition by stable source and use unique owned temporary
  paths for independent identities.
- Deduplicate cache listing and keep existing SP-00 legacy fixture filenames readable.

**Tests**

- way/relation/node identities;
- malformed/overflow IDs;
- renamed same identity;
- same name/different identity;
- legacy tolerance at 249.9/250/250.1 m;
- missing origin does not migrate;
- migration copies referenced artifacts and writes JSON last;
- injected copy/write failure leaves legacy set and no published keyed JSON;
- overlapping same-identity acquisition publishes one coherent cache/artifact set;
- overlapping different identities cannot share a temporary path;
- cache hit source mismatch is typed;
- no absolute paths in list output.

**Commit**

`feat(sp02a): add stable course identity and collision-safe caches`

**Rollback**

Identity/cache publication is foundation behavior and has no runtime switch. Roll back
only by reverting this focused commit; source-keyed and legacy files remain readable
and are never deleted.

### Task 3 — HD fingerprint v2 with v1 compatibility

**Files**

- `lib/course-fingerprint.js` (new)
- `lib/hd-bundle.js`
- `tools/hd-course/course-source.mjs`
- `tools/hd-course/config.mjs`
- `tools/hd-course/discover.mjs`
- `tools/hd-course/compiler.mjs`
- `tools/hd-course/encode.mjs`
- `tools/hd-course/schemas/build-manifest.schema.json`
- representative committed HD manifests only if generator output requires it
- `test/hd-fingerprint.test.mjs`
- `test/hd-bundle.test.js`
- `test/hd-compiler.test.mjs`
- `test/hd-manifest.test.mjs`
- `test/hd-resolve-bundle.test.mjs`

**Behavior**

- Preserve exact v1 bytes.
- Add v2 identity/geometry canonicalization.
- Emit v2 for new build/discover output.
- Treat absent version on an already-built manifest as v1 at runtime; do not rebuild
  source-less inputs.
- Select correct runtime comparison and typed unsupported fallback.

**Tests**

- v1 golden hashes unchanged;
- v2 ignores course and hole display-name changes;
- v2 changes for source, geometry, routing, or coarse elevation;
- v2 ignores presentation/aerial/class-map/building/generated-patch changes;
- v2 build rejects source-less legacy input with migration-required diagnostic;
- v2 build/runtime reject requested, cached, and manifest identity mismatch;
- runtime/compiler parity;
- old committed explicit-v1 and absent-version manifests resolve from source-less
  runtime fixtures without rewrite;
- unsupported version never activates bundle.

**Commit**

`feat(sp02a): version HD fingerprints by stable course identity`

**Rollback**

HD v2 foundation has no runtime switch. Revert this focused commit to restore the
current v1-only behavior; never delete or silently rewrite existing v1 manifests.

### Task 4 — Strict schema, generated validator, and runtime staging

**Files**

- `lib/course-art-limits.js` (new)
- `lib/schemas/course-art-source.schema.json` (new)
- `lib/schemas/course-art-runtime.schema.json` (new)
- `lib/generated/course-art-pack-validator.js` (new)
- `lib/course-art-assets.js` (new)
- `tools/course-art/generate-validator.mjs` (new)
- `tools/course-art/prepare-runtime.mjs` (new)
- `tools/course-art/packaged-smoke.cjs` (new)
- `courses/curated/index.json` (new)
- `courses/curated/README.md` (new)
- `courses/curated/chambers-bay/profile.json` (new)
- `courses/curated/chambers-bay/references.json` (new)
- `.gitignore`
- `package.json`
- `package-lock.json`
- `test/course-art-pack-schema.test.js` (new)
- `test/course-art-staging.test.mjs` (new)

**Behavior**

- Define separate strict source and runtime index/manifest/component entry points.
- Generate and esbuild-bundle dependency-free CJS validation.
- Fail stale generated output.
- Validate index/profile/component consistency and duplicate identity/alias conflicts.
- Validate realpath, GLB chunks/URIs, magic, dimensions, MIME, counts, and byte budgets.
- Prune missing optional assets/features under the exact policy in §5.5.
- Stage the exact runtime tree deterministically and atomically.
- Exclude references and authoring intermediates.
- Ignore `/build/course-art/`.

**Tests**

- valid minimal pack;
- every unknown field and unsupported version;
- duplicate IDs and overlapping aliases;
- NaN/Infinity, coordinate/count/dimension/byte limits;
- traversal, absolute/UNC/device/ADS paths;
- Windows reserved names, trailing dot/space, and case-fold collision;
- symlink/junction escape where environment permits;
- extension/MIME/magic disagreement;
- malformed GLB chunk, external/data URI, out-of-range bufferView, and embedded
  oversized image;
- optional shared asset pruning and required-asset rejection;
- stale validator;
- bundled artifact has no bare runtime import and executes without `node_modules`;
- two staging runs produce byte-identical manifests;
- source and runtime schemas cannot be interchanged;
- authoring references absent from runtime stage;
- unpacked packaged smoke imports validator and runtime manifest successfully.

**Commit**

`feat(sp02a): validate and stage versioned course-art packs`

**Rollback**

Set `BIRDIE_DISABLE_CURATED=1`; automatic package behavior remains. Source validation
and staging can be reverted without affecting identity/HD foundations.

### Task 5 — Automatic/curated presentation and legacy isolation

**Files**

- `lib/course-diagnostics.js` (new)
- `lib/course-presentation.js` (new)
- `lib/course.js` legacy loader adapter
- curated profile files from Task 4
- `test/course-presentation.test.js` (new)
- `test/course-curated-fallback.test.js`
- `test/course-override.test.js`

**Behavior**

- Implement complete automatic and curated normalized outputs.
- Select by stable identity or strict legacy geographic match.
- Make missing pack silent.
- Make corrupt selected pack one actionable diagnostic plus automatic fallback.
- Ignore packs and sidecars completely when disabled.
- Wrap verified legacy sidecar as curated gameplay data when enabled.
- Reject unsupported terrain-feature capability after structural validation.

**Tests**

- unknown course automatic;
- Chambers curated 0.85 dryness;
- Sawgrass automatic default;
- packs-disabled Chambers automatic with no manual dryness;
- packs-disabled mode never calls sidecar loader;
- present valid sidecar applies only to cloned gameplay course;
- corrupt selected pack produces exactly one deduplicated diagnostic;
- malformed identity cannot select a pack;
- no course-name or stable-ID branch exists in automatic adapter;
- normalized records are frozen and path-free.

**Commit**

`feat(sp02a): resolve automatic and curated course presentation`

**Rollback**

Set `BIRDIE_DISABLE_CURATED=1`; automatic normalized package remains valid and the
gateway stays disabled.

### Task 6 — Prepare package and harden Game commit

**Files**

- `lib/resolved-course-package.js` (new)
- `lib/canonical-json.js` (new)
- `lib/game.js`
- `test/resolved-course-package.test.js` (new)
- `test/course-activation.test.js` (new)
- `test/game.test.js`
- `test/robustness.test.js`
- `test/hd-terrain-inject.test.js`

**Behavior**

- Clone and preserve untouched base.
- Resolve HD before any gameplay overlay.
- Build `PreparedCourseCandidate`: presentation, gameplay course, empty
  patches/capabilities, manifests, diagnostics, deterministic content revision, and
  prepared Game state, but no course revision.
- Canonicalize exact UTF-8 bytes per §5.8.
- Precompute complete Game state through an injected `prepareGame` before assignment.
- Keep `Game.setCourse()` as compatible wrapper.

**Tests**

- base deep hash unchanged after success and every injected failure;
- HD resolver observes untouched base;
- overlays affect gameplay clone only;
- presentation-only change updates content revision, not HD fingerprint;
- gameplay and same-key asset-byte changes update content revision;
- authoring reference changes do not update content revision;
- object insertion permutations and source/runtime roots do not update content
  revision;
- semantic array order and normalized value changes do update it;
- negative zero, Unicode NFC, finite-number rejection, and UTF-8 bytes are pinned;
- prepare failure leaves every current Game field unchanged;
- candidate has no course revision and includes prepared Game state;
- commit is assignment-only and invoked once;
- invalid terrain-feature request rejects curated pack, not base activation.

**Commit**

`feat(sp02a): prepare immutable resolved course packages`

**Rollback**

Server may continue calling the backward-compatible `Game.setCourse()` until Task 7
lands.

### Task 7 — Latest-only server activation

**Files**

- `lib/course-activation.js` (new)
- `server.js`
- `lib/hd-readiness.js` only if package metadata requires a compatible extension
- `test/course-activation.test.js`
- `test/course-load-race.test.mjs` (new)
- `test/hd-readiness.test.js`
- `test/visual-capture-config.test.mjs`

**Behavior**

- Allocate generation before acquisition.
- Derive the source key before acquisition; let the coordinator preserve a same-key
  shared fetch and abort only obsolete different-key fetches where supported.
- Gate after acquisition and preparation.
- Allocate revision and create `ResolvedCoursePackage` only after the final stale gate.
- Commit package/Game/HD/revision/timer once through a synchronous non-throwing
  operation.
- Route startup autoload and POST through manager.
- Await autoload success/failure before listening.
- Broadcast revisions/content only after commit.
- Isolate observer/broadcast exceptions after commit.
- Preserve readiness nonce and HD fallback.
- Return typed/redacted failed/superseded responses.

**Tests**

- slow A/fast B;
- A failure then B success;
- B success then late A success;
- concurrent same-identity acquisition coalesces and publishes one cache set;
- with abort-capable transport, A(X) begins and B(X) supersedes A: exactly one fetch
  occurs, the shared fetch is not aborted, A returns superseded, and B commits;
- with abort-capable transport, B(Y) may abort obsolete A(X), and only B commits;
- preparation failure with prior active course;
- Game preparation failure before commit;
- resolved public revision matches active Game/HD/timer revision;
- commit exactly once with no mixed state;
- observer exception after commit cannot roll back or recommit;
- prior timer remains on failure and is replaced on success;
- stale readiness ack remains rejected;
- startup autoload success commits before listen;
- startup autoload failure still listens unloaded with one diagnostic;
- POST cannot race pre-listen bootstrap;
- public responses contain no root path or raw stack.

**Commit**

`feat(sp02a): commit course activation as latest-only transaction`

**Rollback**

Internal activation manager can be bypassed only by reverting this focused commit; do
not restore partial state mutation piecemeal.

### Task 8 — Active asset gateway and packaged root

**Files**

- `lib/course-art-http.js` (new)
- `server.js`
- `main.js`
- `package.json`
- `test/course-art-http.test.js` (new)
- `test/course-art-packaging.test.mjs` (new)
- `test/cache-path.test.js`

**Behavior**

- Serve exact active revision/key through GET/HEAD.
- Add immutable ETag/304.
- Open once, compare file identity, hash/validate exact handle, and stream that handle.
- Recheck containment/type/size/hash at request, including HEAD/304.
- Set `BIRDIE_ART_DIR` for packaged mode.
- Wire deterministic preparation into start/server/pack/dist commands.
- Stage/copy the exact runtime tree through `extraResources`.
- Keep source references and local paths out of package and HTTP.

**Tests**

- exact GET/HEAD;
- conditional 304;
- stale revision and unknown key;
- encoded traversal, Windows reserved names, case-fold collision, and malformed key;
- realpath/junction/symlink escape and swap;
- disallowed/oversized/wrong-hash bytes;
- same-size/same-magic replacement;
- unlink/rename between activation and request;
- stream failure closes handle exactly once;
- route swap after activation;
- `X-Content-Type-Options: nosniff`;
- error body redaction;
- development and packaged fixture roots hash identically;
- package config includes runtime stage and excludes authoring references/Ajv/esbuild;
- clean checkout packaging regenerates ignored staging without dirtying Git;
- packaged smoke validates runtime index/manifest.

**Commit**

`feat(sp02a): serve revisioned active course-art assets`

**Rollback**

Set `BIRDIE_DISABLE_CURATED=1`; gateway and curated selection are disabled together.
Packaging hooks remain safe and deterministic.

### Task 9 — Verification, regression evidence, and handoff

**Files**

- `docs/TODO.md`
- `docs/HANDOFF.md`
- this plan Done Record
- program ledger/handover

**Behavior**

- Run all focused tests and full suite.
- Capture clean baseline at planning/implementation base before code.
- Capture unchanged full three-course baseline after candidate.
- Compare and require pixel equivalence or investigate every changed pixel.
- Run synthetic renderer smoke.
- Run packaged-root fixture and server activation race tests.
- Record preparation latency, asset bytes, and diagnostics.
- Route renderer consumption/ownership to SP-02b.

**Commit**

`docs(sp02a): record contract and activation evidence`

Documentation follows accepted code. Failed review does not mark the unit done.

## 7. Test diagram

```text
request identity
  +-- valid OSM ----------------> source-key cache
  |                                -> test/course-identity.test.js
  |                                -> test/course-cache-identity.test.js
  +-- legacy verified ----------> non-destructive migration
  +-- collision/mismatch -------> typed reject/refetch

base course
  -> HD fingerprint dispatch
       +-- missing version ------> v1 compatibility
       +-- version 2 -----------> stable identity canonical
       +-- unknown -------------> typed procedural fallback
          -> test/hd-fingerprint.test.mjs
          -> test/hd-bundle.test.js

pack lookup
  +-- disabled/absent ----------> automatic, silent
  +-- selected invalid ---------> automatic + one diagnostic
  +-- selected valid -----------> staged runtime pack
  |     +-- required asset miss -> reject pack
  |     +-- optional asset miss -> prune referencing optional features
  |     `-- complete -----------> curated normalized
  +-- terrain feature requested -> capability reject + automatic
     -> test/course-art-pack-schema.test.js
     -> test/course-presentation.test.js

prepare package
  +-- success ------------------> PreparedCourseCandidate (no courseRevision)
  +-- failure ------------------> no current-state mutation
     -> test/resolved-course-package.test.js
     -> test/game.test.js

activation generation
  +-- current success ----------> ResolvedCoursePackage + one commit
  +-- superseded ---------------> typed 409, no mutation
  +-- current failure ----------> previous course remains
  +-- observer failure ---------> committed state retained + typed diagnostic
     -> test/course-activation.test.js
     -> test/course-load-race.test.mjs

asset request
  +-- active revision + key ----> open/hash exact handle -> GET/HEAD/ETag/304
  +-- stale/unknown/path escape -> generic redacted reject
     -> test/course-art-http.test.js
     -> test/course-art-packaging.test.mjs

renderer regression
  -> synthetic smoke
  -> Chambers/Sawgrass/St Andrews fixed baseline
  -> before/after comparison
```

### Required commands

Focused commands are exact once files exist:

```powershell
node --test test/course-identity.test.js test/course-cache-identity.test.js
node --test test/hd-fingerprint.test.mjs test/hd-bundle.test.js test/hd-compiler.test.mjs test/hd-resolve-bundle.test.mjs
node --test test/course-art-pack-schema.test.js test/course-art-staging.test.mjs test/course-presentation.test.js
node --test test/resolved-course-package.test.js test/course-activation.test.js test/course-load-race.test.mjs
node --test test/course-art-http.test.js test/course-art-packaging.test.mjs
npm run check:course-art
npm test
npm run pack
node tools/course-art/packaged-smoke.cjs "<unpacked application path>"
npm run visual:smoke -- --suite baseline --data-dir "<canonical data root>" --require-clean --output-dir ".shots/visual/sp02a/smoke"
npm run visual:capture -- --suite baseline --data-dir "<canonical data root>" --require-clean --output-dir ".shots/visual/sp02a/after"
npm run visual:compare -- --before "<clean SP-02a base capture>" --after "<candidate capture>" --output-dir ".shots/visual/sp02a/compare"
```

### Environment ownership

| Test | Environment |
|---|---|
| Pure identity/schema/presentation/package | Node 22+ CI |
| Race and HTTP contract | Node 22+ CI with temp roots |
| Realpath/junction escape | CI pure case; named Windows host for actual junction |
| Source/runtime/isolated validator | Node 22+ CI with no production `node_modules` dependency |
| Unpacked packaged app/validator/root | Windows CI or named Windows host; mandatory SP-02a proof |
| Synthetic render smoke | hardware if available; typed capability skip otherwise |
| Full visual regression | named RTX 3060 / WebGL 2 host |

Coverage goal: every conditional branch introduced by SP-02a has a named unit or
contract assertion. No untested catch-and-fallback path is accepted.

## 8. Failure modes

| Failure | Required behavior | Visibility | Test |
|---|---|---|---|
| Malformed source identity | Do not select stable cache/pack; typed failure or safe refetch | Actionable code | identity |
| Same-name cache collision | Separate source-key paths | No wrong course | cache identity |
| Legacy name matches but origin does not | Refuse migration; retain legacy bytes | Typed recovery | migration |
| Migration interrupted | No published keyed JSON; legacy untouched | Retryable | injected write |
| Keyed cache embeds wrong source | Refuse/quarantine; never use | Typed error | cache hit |
| Concurrent same-identity fetches | Coalesce one acquisition/publication | Invisible | cache race |
| HD v1 manifest | Resolve with exact old bytes | Silent compatibility | HD |
| V2 source absent/mismatched | Refuse v2 build/activation; request migration | Typed error | HD identity |
| Unsupported fingerprint version | Reject descriptor; procedural fallback | Typed warning | HD |
| Duplicate pack course ID/alias overlap | Reject index deterministically | Build/runtime diagnostic | schema |
| Pack absent | Automatic presentation | Silent | presentation |
| Selected pack corrupt/unsupported | Automatic plus one diagnostic | Concise recoverable | presentation |
| Unknown field in production | Reject selected pack | Same as development | schema |
| Unsupported terrain feature | Reject curated pack, keep automatic course | Typed capability | package |
| Optional asset missing during staging | Prune every optional referencing feature before revision; keep pack | One warning | staging/assets |
| Required feature references optional asset | Reject source pack as cross-field invalid | Build diagnostic | schema |
| Required asset missing/changed | Reject curated pack or request; never serve stale bytes | Typed | assets/HTTP |
| Generated validator imports Ajv/esbuild at runtime | Build/test/package gate fails | Developer-facing | isolated/package smoke |
| Source/runtime staged shape mismatch | Reject stage/runtime pack | Typed | staging/runtime schema |
| Malformed or external-reference GLB | Reject source pack | Build diagnostic | GLB parser |
| Junction/symlink escapes or swaps root | Reject before response | Generic external error | path/file identity |
| Same-size asset bytes replaced | Hash mismatch; never serve old ETag/revision | Generic external error | exact handle |
| Slow A finishes after B | A superseded, B stays active | Old request gets typed 409 | race |
| Package preparation throws | Prior package/game/HD/revision/timer stay intact | Recoverable error | activation |
| `Game` preparation throws | No active Game field changes | Typed core failure | game |
| Observer throws after commit | Keep coherent committed state; diagnose once | Typed warning/error | activation observer |
| Startup autoload fails | Listen unloaded after one typed diagnostic | Recoverable | bootstrap |
| Stale asset URL after switch | Generic 404 | Browser refetches current | HTTP |
| Raw filesystem exception | Redact public record; keep private stack | No path leak | diagnostics |
| Runtime staging differs by machine | Build/test fails | Developer-facing | staging |
| Renderer pixels change | Reject or explain exact non-renderer cause | Review sheet | visual |

Known unresolved Low from SP-01: a shared raw texture may receive idempotent duplicate
dispose calls through the pre-existing multi-material pattern. SP-02a creates no GPU
resource and does not expand into that cleanup. SP-02b's reference-counted registry
must account for it.

## 9. Acceptance

### Automated hard gates

- Exact implementation base and candidate SHAs recorded.
- Worktree clean.
- Every focused command passes.
- Full `npm test` passes with zero failures/skips newly introduced by SP-02a.
- Generated validator byte-current check passes.
- Generated validator has no runtime import, runs without `node_modules`, and passes
  the unpacked packaged smoke.
- Source and runtime pack trees both match their exact closed schemas.
- `git diff --check` passes.
- No `courseDryFor`, `COURSE_DRY`, renderer scene, shader, or UI file changes.
- No automatic adapter course-name or stable-ID special case.
- No public manifest/diagnostic contains an absolute path.
- V1 HD golden hashes and committed manifests remain compatible.
- Source-key collision/migration tests pass.
- Same-identity concurrent acquisition test passes.
- Same-identity supersession with abort-capable transport performs one un-aborted
  fetch, supersedes the older caller, and commits the newer caller.
- V2 source-less/mismatched identity tests pass while v1 compatibility remains green.
- Canonical content bytes are invariant across insertion order, line ending, root
  path, locale, and development/package staging.
- A/B race and prepare-failure atomicity tests pass.
- Prepared candidate versus active resolved package/revision tests pass.
- Startup bootstrap success/failure/listen ordering tests pass.
- GET/HEAD/ETag/304/exact-handle hash/stream/security tests pass.
- GLB embedded-only validation tests pass.
- Development and packaged fixture roots produce the same content hashes.
- Synthetic renderer smoke has no unexpected console/fatal event.
- Hardware baseline is pixel-equivalent to the clean SP-02a base or every change is
  treated as a blocker pending explanation.

### Performance and resource evidence

SP-02a adds no renderer resource. Record:

- base/candidate renderer textures, geometries, programs, and draw calls — expected
  flat;
- median/p95 package preparation time for automatic/no-asset and curated fixture;
- total validated runtime asset bytes and count;
- five alternating server activations with no monotonic open-stream/timer/heap growth;
- no default-on GPU delta claim beyond the unchanged baseline.

No arbitrary activation-latency budget is invented before measurement. A regression
that makes local cached switching visibly slow returns to plan review with the measured
profile.

### Human/behavioral review

- Same-name fixtures never cross-select.
- Corrupt curated pack message states pack, field/stage, cause class, and recovery
  without a machine path.
- Previous course remains playable after injected base/package failure.
- Chambers automatic path contains no manual dryness or legacy sidecar.
- The exact Chambers profile preserves its current `0.85` manual character value for
  later SP-02b consumption.
- SP-02b handoff explicitly blocks deletion of the name map until St Andrews and
  Bandon identities/profiles or reviewed generic derivations are committed.
- No visual improvement claim is made; fixed frames remain unchanged.

### Independent gate

- Independent review confidence at least 75%.
- No unresolved Critical, High, or Medium finding.
- All changed files remain in SP-02a ownership.
- Windows CI green.
- Candidate ancestry or integrated-tree equivalence proven after merge.
- Post-merge full suite rerun on `origin/main`.

## 10. Candidate done record

Complete only after integration:

| Field | Evidence |
|---|---|
| Implementation owner/worktree | `/root/sp01_implementation`; `C:\Users\USER\.config\superpowers\worktrees\Open-Birdie\sp02a-course-presentation-contract`; branch `codex/sp02a-course-presentation-contract` |
| Planning base | `03a1ff73cd135bac2aa7e9d1d331aa1c2852bd76` |
| Implementation base | `2dd82c7e503e3f974a9abebeeba8b9d71ce449ef` |
| Candidate commit | First code candidate `61d9ab78edd1f56e361b7884d203d832483a6c65` and corrected candidate `5d13c1c5ba8de2628dd294f24bcf5a589065407e` were rejected; pass-3 code evidence is `521552466ece23cee6134285fce1ef4d344b3932`; documentation is a code-identical descendant |
| Pull request / merge commit | Pending independent acceptance |
| Focused tests | Five required commands pass 129/129: identity/cache 18, HD 44, schema/staging/presentation 31, package/activation/race 21, asset HTTP/package 15 |
| Full test count | `npm test`: 492 passed, 0 failed, 0 cancelled, 0 skipped |
| Identity/cache migration evidence | Stable node/way/relation IDs, 250 m legacy verification, atomic non-destructive migration, collision isolation, nested/top-level identity agreement, same-ID acquisition coalescing, real cached different-ID cancellation, exact X→Y→X replacement, asynchronous cancellable cross-process publication locking/late-winner recheck, event-loop progress under a fresh foreign lock, coherent artifact set with JSON last, and exact embedded identity pass. Stable-source legacy v3 activation regression is covered; source-less activation remains rejected. |
| HD v1/v2 evidence | V1 golden compatibility and source-less read path pass; v2 stable identity/fingerprint, mismatch and missing-ID typed rejection/diagnostics, unknown-version fallback, compiler, and multi-bundle resolution pass. |
| Validator/staging evidence | `check:course-art` passes one deterministic pack; generated validator is current and dependency-free; source/runtime trees stage byte-identically; optional missing asset is pruned; required/malformed/external-reference assets fail closed. |
| Activation race/rollback evidence | Latest-only same-/different-ID races, prepare/Game failure rollback, coherent Game/HD/revision/timer commit, observer isolation, startup ordering, sanitized client-compatible `error` plus typed diagnostics on 409/500, private cause logging, and source-keyed v3 activation pass. |
| Asset HTTP/package-root evidence | GET/HEAD/ETag/304 perform bounded request-local exact-handle reads, MIME/magic/hash/identity validation, and active-revision re-gating; same-inode/same-size mutation returns redacted 404; activation preparation reads/hashes once and retains zero asset buffers; `npm run pack` passes; staged and unpacked packaged smoke report `{"status":"valid","packCount":1}`; 912-entry asar scan has zero Ajv/esbuild/source-schema/authoring-root matches. |
| Before capture | Clean `2dd82c7` run: `.shots/visual/sp02a/before-identity-retry/baseline-2026-07-28T130251-740Z`; isolated source-identified data hash `d5731d3f75cb6efa7c3be3b5b329805b6af1b06d3d0aad2cb10543b5361e84ac` |
| After capture / comparison | Clean `61d9ab7` run: `.shots/visual/sp02a/after-identity-retry/baseline-2026-07-28T131525-737Z`; `.shots/visual/sp02a/compare-identity`: 24 total, 0 changed, pixel pass true |
| Hardware / renderer | Windows 11 Pro, RTX 3060, driver `32.0.15.9186`, Electron 42.4.0, Chrome 148, WebGL 2 / ANGLE D3D11. Per-course textures/geometries/programs/calls/triangles match exactly; no renderer files changed. |
| Package preparation latency | 100 measured fixture iterations after warmup: automatic/no-asset median/p95 `0.109/0.186 ms`; curated `1.709/2.140 ms`; both have no diagnostics |
| Asset/resource delta | Staged runtime asset count/bytes `0/0`; no GPU resource introduced. Five alternating post-warmup activations: obsolete packages alive `0/4`, current alive, timeouts `0 -> 0`, TCP servers `2 -> 2`, GC heap `+16,712` bytes measurement noise. |
| Independent review | Pass 1 exact code `61d9ab7` / docs `c7520a3`: REJECT 97%, 0C/3H/6M/0L. Pass 2 exact code `5d13c1c` / docs `d8040a5`: REJECT 98%, 0C/1H/3M/1L. Exact pass-3 code `5215524` closes all five pass-2 findings and awaits independent review. |
| Deviations | Plan examples used unsupported `--output-dir`; executed supported `--output`. Canonical user data was not mutated: captures used an isolated byte copy with verified stable sources. One clean-base capture first hit a post-result Electron close timeout, then clean probe/full rerun passed. Two first-candidate synthetic retries also wrote complete valid results with no page/fatal errors but top-level `CHILD_TIMEOUT` because Electron emitted no `close`; no orphan remained. Earlier top-level smoke at `b30d3a3` and the three-course capture are green. The correction delta changes no renderer, curated course profile, or capture fixture path, so the 24-frame result remains renderer-neutral regression evidence rather than a visual claim. Independent review assigns severity; no unrelated harness lifecycle expansion was made. |
| SP-02b handoff | Consume normalized package fields and revisioned assets; own browser generation/abort/stale disposal and shared GPU handles. Do not delete the renderer name map until St Andrews and Bandon have reviewed stable identities/profiles or reviewed generic derivation. |

## 11. Parallelization and commit order

After Task 1 freezes interfaces, the safe order is:

```text
Task 1 -> Task 2 identity/cache
              |
              +----> Task 3 HD v2
              |
              +----> Task 4 source/runtime schema + staging

Task 2 + Task 4 -> Task 5 adapters
Task 3 + Task 5 -> Task 6 prepared candidate/Game state
Task 6 -> Task 7 latest-only active package
Task 7 -> Task 8 HTTP/package integration
Task 8 -> Task 9 evidence
```

One implementation owner should integrate this unit because `lib/course.js`,
`server.js`, package metadata, and tests cross the same transaction boundary. If the
lane delegates internally:

- Task 3 and the pure schema/compiler portion of Task 4 may proceed after Task 2's
  identity contract is committed;
- a pure `course-art-http.js` helper may start after Task 4, but its server/active
  package integration waits for Task 7;
- only the assigned SP-02a owner edits the integration branch;
- `server.js`, `lib/game.js`, `package.json`, and program docs have one owner;
- integration remains in the exact task order above.

No SP-02b renderer work begins until SP-02a is accepted and integrated.

## 12. Engineering review record

| Review | Result | Confidence | Findings |
|---|---|---:|---|
| Current-base census | COMPLETE | — | Stable identity absent; all cache artifacts name-keyed; HD v1 includes display name; activation mutates before commit; `Game.setCourse` can partially assign; no pack/schema/gateway/package root; six source-document contradictions resolved in Section 5.1 |
| Independent plan gate, pass 1 (`dc8814fa754f401bd6164611de960e043064ab79`) | REJECT | 97% | 3 High: package-unsafe generated validator, inconsistent candidate/active/Game transaction types, missing exact staged runtime contract. 10 Medium: optional-asset atomicity, v2 source mismatch, canonical bytes, exact served-byte verification, stage/package hooks, unsafe dependency graph, GLB validation, startup semantics, optional manual profiles, unowned rollback switches. 2 Low: concurrent same-identity disk writes and Windows/header hardening. All recommended corrections are incorporated in the next revision. |
| Independent plan gate, pass 2 (`6c3494d0b0193a54052ab03183e95f6a50fc3c51`) | REJECT | 96% | 0 Critical, 0 High, 1 Medium, 2 Low. Medium: activation-level abort conflicted with same-identity shared acquisition. Low: source-less v1 build/read wording and private active-state ownership were not pinned. This revision assigns abort ownership to the source-keyed coordinator, adds exact same-/different-ID abort tests, limits source-less v1 compatibility to already-built runtime manifests, and defines the private `ActiveCourseState`. |
| Independent plan gate, pass 3 (`f8693c3c2995a674d8f5827682d38a820deb227d`) | ACCEPT | 98% | 0 Critical, 0 High, 0 Medium, 0 Low. Coordinator-owned abort lifecycle, same-/different-ID supersession tests, read-only source-less v1 compatibility, and private `ActiveCourseState` ownership are explicit. Whole-plan architecture, tests, failure modes, packaging, performance evidence, dependency order, and deferred renderer scope were rechecked. |
| Independent candidate review, pass 1 (`61d9ab78edd1f56e361b7884d203d832483a6c65`; docs `c7520a3f569dceb19235f583fb331b44f86598be`) | REJECT | 97% | 0 Critical, 3 High, 6 Medium, 0 Low. High: response bytes could diverge from the verified ETag through a second read; normalized nested identity did not own acquisition; slug-only legacy gameplay could cross same-name stable IDs. Medium: missing client `error`, wrong legacy courses root, no cross-process publication winner, dropped typed v2 missing-ID rejection, unused production cancellation, and double asset read/hash ownership. Corrected by `e95ad4a`, `be8546a`, `91b9de0`, `02eb751`, `e2e9a78`, and `5d13c1c`. |
| Independent candidate review, pass 2 (`5d13c1c5ba8de2628dd294f24bcf5a589065407e`; docs `d8040a559db35da10d6f2e880b1a5d6fbcd2cccd`) | REJECT | 98% | 0 Critical, 1 High, 3 Medium, 1 Low. High: activation-owned asset buffers violated accepted exact-request semantics. Medium: real cached UI loads bypassed coordinator cancellation, X→Y→X could reuse an aborted X promise, and legacy migration used an event-loop-blocking `Atomics.wait` lock. Low: staged temporaries were not cleaned on every late-winner/abort/error path. Corrected by `82e715d` and final contract pin `5215524`. |

Dispatch verdict: **READY / DISPATCH YES AFTER PLAN INTEGRATION**. The plan has no
unresolved Critical, High, Medium, or Low finding. The PIC must merge this accepted
plan and record that exact merge SHA as the implementation base before the isolated
implementation lane starts.
