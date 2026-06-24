# HD Compiler Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a Windows-safe, test-first compiler contract for manifests, paths, errors, fingerprints, immutable bundles, and offline fixtures.

**Architecture:** Compiler code is ESM under `tools/hd-course/`; runtime validation stays dependency-light CommonJS under `lib/`. Immutable versioned bundle directories are published by atomically swapping `active.json`, so a failed Windows build cannot destroy the last known-good bundle.

**Tech Stack:** Node.js 22+, Node test runner, Ajv 8.20, GeoTIFF.js 3.0.5, Proj4js 2.20.9, Sharp (current stable). `lib/hd-bundle.js` parses image headers by hand (no PNGJS).

> **Implementation status (2026-06-23): Plan 1 is implemented** on branch
> `claude/suspicious-pike-b4f09a` (commits `b4ab85d`…`9ead73f`), 54 offline tests green.
> **Amendments to the steps below:** the Node floor is **22**, not 18.17. Node 18 is EOL (Apr 2025),
> and the `node --test` quoted-glob in the `npm test` script only expands on Node ≥21 — so the
> original "prove the quoted glob on 18.17" CI gate could never pass. Pinning to Node 22 (the dev
> machine) closes that landmine and unlocks current Sharp (no longer pinned to 0.34.5). Image
> headers are hand-rolled (no PNGJS). The Bandon manifest ships `discovered.state:"pending"` and a
> synthetic resolved fixture exercises the resolved branch; bundle fixtures are generated in-test
> via Sharp rather than committed as binaries. Full execution record:
> `~/.claude/plans/plan-if-not-have-polished-parasol.md`.

---

## File map

- Create `tools/hd-course/errors.mjs` — stage-coded compiler errors and URL redaction.
- Create `tools/hd-course/paths.mjs` — bounded data/cache/staging paths.
- Create `tools/hd-course/http.mjs` — allow-listed, bounded HTTP helper.
- Create `tools/hd-course/config.mjs` — build-manifest loading and validation.
- Create `tools/hd-course/course-source.mjs` — cached-course resolution/fingerprint.
- Create `tools/hd-course/schemas/build-manifest.schema.json` — compiler input schema.
- Create `tools/hd-course/manifests/bandon-dunes-hole-01.json` — pinned prototype intent.
- Create `lib/hd-bundle.js` — final bundle schema/constants/validation/asset resolution.
- Create `test/fixtures/hd-course/` — tiny offline course/bundle inputs only.
- Create `test/hd-errors.test.mjs`, `test/hd-paths.test.mjs`, `test/hd-manifest.test.mjs`, `test/hd-fingerprint.test.mjs`, `test/hd-bundle.test.js`, `test/hd-publisher.test.mjs`.
- Modify `package.json`, `package-lock.json`, `.gitignore`.
- Create `.github/workflows/test-windows.yml` — exact Node 18.17 Windows compatibility gate.

### Task 1: Prove the compiler-only toolchain on Node 18/Windows

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `test/hd-toolchain.test.mjs`
- Create: `.github/workflows/test-windows.yml`

- [ ] **Step 1: Write the failing toolchain test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('compiler dependencies load on the supported Node runtime', async () => {
  const [{ fromArrayBuffer }, proj4, sharp, Ajv] = await Promise.all([
    import('geotiff'), import('proj4'), import('sharp'), import('ajv'),
  ]);
  assert.equal(typeof fromArrayBuffer, 'function');
  assert.equal(typeof proj4.default, 'function');
  assert.equal(typeof sharp.default, 'function');
  assert.equal(typeof Ajv.default, 'function');
});
```

- [ ] **Step 2: Run it and verify dependency failure**

Run: `node --test test/hd-toolchain.test.mjs`

Expected: FAIL with a missing `geotiff`, `proj4`, `sharp`, or `ajv` package.

- [ ] **Step 3: Install pinned Node-18-compatible compiler dependencies**

Run:

```powershell
npm install --save-dev geotiff@3.0.5 proj4@2.20.9 sharp@0.34.5 ajv@8.20.0
```

Do not install Sharp 0.35.x; it requires Node 20.9+ while this project supports Node 18.
Keep all four packages in `devDependencies`; packaged runtime files must not import them.
Raise the declared engine floor from `>=18` to `>=18.17.0`, matching Sharp 0.34.5.

Add a Windows CI job using `actions/setup-node` with exact `18.17.0`, then `npm ci` and
`npm test`. This proves dependency installation and the quoted Windows glob command on the
actual minimum runtime instead of whichever Node happens to be installed locally.

- [ ] **Step 4: Run the focused and full suites**

Run: `node --test test/hd-toolchain.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json .github/workflows/test-windows.yml test/hd-toolchain.test.mjs
git commit -m "build: add HD compiler toolchain"
```

### Task 2: Add strict errors, safe paths, and bounded HTTP

**Files:**

- Create: `tools/hd-course/errors.mjs`
- Create: `tools/hd-course/paths.mjs`
- Create: `tools/hd-course/http.mjs`
- Create: `test/hd-errors.test.mjs`
- Create: `test/hd-paths.test.mjs`
- Create: `test/hd-http.test.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write failure-first tests**

Cover:

```js
assert.equal(redactUrl('https://x.test/a?token=secret&x=1'), 'https://x.test/a?token=REDACTED&x=1');
assert.throws(() => safeLeaf('../terrain.f32'), /HD_PATH_TRAVERSAL/);
assert.throws(() => safeLeaf('C:\\temp\\terrain.f32'), /HD_PATH_TRAVERSAL/);
assert.throws(() => safeLeaf('\\\\server\\share\\x'), /HD_PATH_TRAVERSAL/);
```

Also test NUL bytes, mixed separators, sibling-prefix escapes, symlink/reparse escapes,
redirects to HTTP/private hosts, oversized bodies, ignored range responses, timeouts, and
redaction of `sig`, `token`, `api_key`, `credential`, and `signature` query values.

- [ ] **Step 2: Verify focused tests fail**

Run:

```powershell
node --test test/hd-errors.test.mjs test/hd-paths.test.mjs test/hd-http.test.mjs
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the minimum public contracts**

```js
export class HdCompileError extends Error {
  constructor(stage, code, context = {}, cause) {
    super(`${stage}: ${code}${cause?.message ? `: ${cause.message}` : ''}`, { cause });
    this.name = 'HdCompileError';
    this.stage = stage;
    this.code = code;
    this.context = sanitizeContext(context);
  }
}

export async function fetchBounded(url, {
  fetchImpl = fetch, allowedHosts, timeoutMs = 20_000,
  maxBytes, range, retries = 3,
} = {}) { /* strict implementation */ }
```

HTTP retries apply only to network failures and 429/502/503/504. A server returning `200`
to a required COG range request is rejected before a multi-gigabyte body is consumed.

Add to `.gitignore`:

```gitignore
data/hd-build-cache/
data/hd-courses/
```

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/hd-errors.test.mjs test/hd-paths.test.mjs test/hd-http.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add .gitignore tools/hd-course/errors.mjs tools/hd-course/paths.mjs tools/hd-course/http.mjs test/hd-errors.test.mjs test/hd-paths.test.mjs test/hd-http.test.mjs
git commit -m "feat(hd): add strict compiler boundaries"
```

### Task 3: Define build manifests and the canonical course fingerprint

**Files:**

- Create: `tools/hd-course/schemas/build-manifest.schema.json`
- Create: `tools/hd-course/config.mjs`
- Create: `tools/hd-course/course-source.mjs`
- Create: `tools/hd-course/manifests/bandon-dunes-hole-01.json`
- Create: `test/fixtures/hd-course/course.json`
- Create: `test/hd-manifest.test.mjs`
- Create: `test/hd-fingerprint.test.mjs`

- [ ] **Step 1: Write manifest/fingerprint tests**

The fingerprint input is canonical JSON containing cache version, name, origin, boundary,
holes, relevant surfaces/trees/woods, and the coarse elevation grid including heights. It
excludes generated high-resolution patches because those are replaced by the HD bundle.

```js
const a = canonicalCourseFingerprint(course);
const reordered = { ...course, surfaces: [...course.surfaces].reverse() };
assert.equal(canonicalCourseFingerprint(reordered), a);
assert.notEqual(canonicalCourseFingerprint({ ...course, origin: { ...course.origin, lat: 1 } }), a);
```

Test manifest byte limits, unknown keys, non-finite values, invalid bounds, excessive output
dimensions, unsupported CRS/resolution, and fingerprint mismatch.

- [ ] **Step 2: Verify tests fail**

Run: `node --test test/hd-manifest.test.mjs test/hd-fingerprint.test.mjs`

Expected: FAIL because schema/config/source modules are missing.

- [ ] **Step 3: Implement schema/config/source resolution**

The checked-in Bandon manifest pins:

- exact course cache identity and canonical fingerprint;
- hole ref `1` and 150 m padding;
- snapped local bounds, filled after the first reviewed discovery command;
- target terrain spacing `1.0` m and imagery GSD `0.3` m;
- NAIP date `2022-06-23` and item IDs
  `or_m_4312453_ne_10_030_20220623` and
  `or_m_4312453_se_10_030_20220623`;
- each unsigned canonical COG asset URL, expected content length, and expected stable ETag;
- maximum pixels/download/cache/bundle limits;
- 3DEP and Planetary Computer endpoints; and
- deterministic normalization/encoding parameters.

Do not pin SAS tokens or signed URLs. The current Azure NAIP blobs are public; a 403 is a
hard source failure rather than permission to introduce an unreviewed signing flow.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/hd-manifest.test.mjs test/hd-fingerprint.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tools/hd-course/schemas/build-manifest.schema.json tools/hd-course/config.mjs tools/hd-course/course-source.mjs tools/hd-course/manifests/bandon-dunes-hole-01.json test/fixtures/hd-course/course.json test/hd-manifest.test.mjs test/hd-fingerprint.test.mjs
git commit -m "feat(hd): define reproducible build manifests"
```

### Task 4: Define and validate the runtime bundle contract

**Files:**

- Create: `lib/hd-bundle.js`
- Create: `test/hd-bundle.test.js`
- Create: `test/fixtures/hd-course/valid-bundle/manifest.json`
- Create: `test/fixtures/hd-course/valid-bundle/provenance.json`

- [ ] **Step 1: Write strict validator tests**

Required exports:

```js
const {
  HD_SCHEMA_VERSION, SURFACE_CHANNELS, courseFingerprint,
  validateManifest, decodeTerrainF32, validateBundleDirectory,
  resolveAssetPath,
} = require('../lib/hd-bundle');
```

Test exact Float32 byte length, little-endian decode, finite heights, bounds/dimension
limits, overflow-safe size math, SHA-256/size mismatch, image magic/dimensions, unexpected
files, symlinks, duplicate matching bundles, base-grid mismatch, and channel contract:

```js
assert.deepEqual(SURFACE_CHANNELS, {
  surfaces: { r: 'fairway', g: 'green', b: 'tee', a: 'bunker' },
  coverage: { r: 'validity', g: 'water' },
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --test test/hd-bundle.test.js`

Expected: FAIL because `lib/hd-bundle.js` is missing.

- [ ] **Step 3: Implement the dependency-light CommonJS validator**

Do not import Ajv, Sharp, GeoTIFF.js, or Proj4js from `lib/hd-bundle.js`. Runtime validation
uses explicit schema-v1 checks, Node core crypto/fs/path, PNG/WebP header parsing, and hard
limits. It returns typed status objects rather than swallowing invalid bundles:

```js
{ status: 'absent' }
{ status: 'rejected', code: 'HD_HASH_MISMATCH', message: '...' }
{ status: 'valid', descriptor }
```

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/hd-bundle.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/hd-bundle.js test/hd-bundle.test.js test/fixtures/hd-course/valid-bundle
git commit -m "feat(hd): validate versioned hole bundles"
```

### Task 5: Publish immutable bundles through an active pointer

**Files:**

- Create: `tools/hd-course/publisher.mjs`
- Create: `test/hd-publisher.test.mjs`

- [ ] **Step 1: Write failure/rollback tests**

The test builds bundle `A`, activates it, attempts invalid bundle `B`, and proves `A` remains
active. It also leaves an interrupted temporary pointer and verifies startup recovery.

Expected layout:

```text
data/hd-courses/bandon-dunes/
  active.json
  bundles/<manifest-sha256>/...
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test test/hd-publisher.test.mjs`

Expected: FAIL because publisher is missing.

- [ ] **Step 3: Implement versioned publication**

```js
export async function publishBundle({ stagedDir, courseDir, validate }) {
  const descriptor = await validate(stagedDir);
  const bundleId = descriptor.manifestSha256;
  // Move complete immutable dir into bundles/<bundleId>, fsync files/dir where supported,
  // write active.json.tmp, fsync, rename active.json.tmp -> active.json.
  return { bundleId, descriptor };
}
```

Never replace a populated live directory. Clean only abandoned staging directories owned by
the current tool and older unreferenced bundles after successful activation.

- [ ] **Step 4: Run foundation verification**

Run:

```powershell
node --test "test/hd-*.test.js" "test/hd-*.test.mjs"
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tools/hd-course/publisher.mjs test/hd-publisher.test.mjs
git commit -m "feat(hd): publish bundles transactionally"
```

## Plan 1 completion gate

- [ ] Compiler dependencies install under the declared Node 18 floor on Windows x64.
- [ ] Windows CI passes on exact Node 18.17.0, including the quoted `npm test` globs.
- [ ] Normal tests make no network requests.
- [ ] Errors expose real stages/causes without credential leakage.
- [ ] Manifest and filesystem limits fail closed.
- [ ] Fingerprint changes when the coarse terrain or relevant OSM input changes.
- [ ] A failed publication leaves the previous `active.json` usable.
- [ ] `npm test` passes before Plans 2/3 begin.
