# HD Provider Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile a validated Bandon Dunes Hole 1 bundle from strict 3DEP terrain and pinned same-date NAIP COG windows without downloading entire source rasters.

**Architecture:** Provider adapters are strict and injectable; pure raster stages consume normalized in-memory contracts. The checked-in build manifest pins source identity and parameters, while generated provenance records current response metadata and tool versions.

**Tech Stack:** Node.js 22+, GeoTIFF.js, Proj4js, Sharp (current stable), PNGJS, USGS 3DEP ImageServer, Planetary Computer NAIP STAC/COG.

> **Implementation status (2026-06-24): the OFFLINE portion of Plan 2 is implemented** on branch
> `claude/suspicious-pike-b4f09a` (commits `07e2217`…`5581744`), 52 new offline tests, full suite
> 151/151 green. **Amendments:** Node floor is **22** (not 18) per the Plan 1 decision; the existing
> `test/lidar.test.js` is unchanged and green (gameplay's best-effort `fetchPatch` preserved). The
> **live discovery + real Bandon build is deliberately deferred** as an opt-in capstone — the
> committed manifest stays `discovered:"pending"`; the offline e2e injects fixture providers and
> forces `global.fetch` to throw. Encoder output is reconciled byte-for-byte against the Plan 1
> `lib/hd-bundle.js` validator. Full execution record:
> `~/.claude/plans/plan-if-not-have-polished-parasol.md`.

---

**Prerequisite:** Complete `2026-06-23-hd-compiler-foundation.md`.

## File map

- Create `tools/hd-course/coordinates.mjs`, `bounds.mjs` — coordinate transforms/grid bounds.
- Create `tools/hd-course/three-dep.mjs`, `terrain.mjs` — strict DEM acquisition/resampling.
- Create `tools/hd-course/naip.mjs`, `cog-source.mjs`, `imagery.mjs` — pinned COG range reads/reprojection/compositing.
- Create `tools/hd-course/masks.mjs`, `normalize.mjs`, `encode.mjs` — semantic outputs.
- Create `tools/hd-course/compiler.mjs`, `cli.mjs`, `report.mjs` — stage orchestration.
- Create `tools/smoke-hd-providers.mjs`, `tools/validate-hd-bundle.js`.
- Create `test/hd-coordinates.test.mjs`, `hd-bounds.test.mjs`, `hd-3dep-provider.test.mjs`, `hd-terrain-compiler.test.mjs`, `hd-naip-provider.test.mjs`, `hd-imagery.test.mjs`, `hd-masks.test.mjs`, `hd-encoding.test.mjs`, `hd-compiler.test.mjs`.
- Modify `package.json`, `lib/lidar.js`, `test/lidar.test.js`, `ASSETS.md`.

### Task 1: Implement shared coordinates, bounds, and grid contracts

**Files:**

- Create: `tools/hd-course/coordinates.mjs`
- Create: `tools/hd-course/bounds.mjs`
- Create: `test/hd-coordinates.test.mjs`
- Create: `test/hd-bounds.test.mjs`

- [ ] **Step 1: Write coordinate/bounds tests**

Test local→WGS84→local round trips at all Hole 1 corners within 0.05 m, WGS84→EPSG:26910
against pinned reference points, 150 m padding, outward grid snapping, north-up Y orientation,
finite inputs, antimeridian rejection, and configured dimension/pixel caps. Final HD bounds
must snap to both the 1 m HD grid and the loaded coarse grid’s cell lines (currently 5 m), so
runtime can remove whole coarse cells with an exact shared boundary and zero area overlap.

```js
const local = { x: 155.02, y: 258.26 };
const ll = localToWgs84(local, bandonOrigin);
const roundTrip = wgs84ToLocal(ll, bandonOrigin);
assert.ok(Math.hypot(roundTrip.x - local.x, roundTrip.y - local.y) < 0.05);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test test/hd-coordinates.test.mjs test/hd-bounds.test.mjs`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement the pure contracts**

Register only required/recognized CRSs. Bandon NAIP is EPSG:26910:

```js
proj4.defs('EPSG:26910', '+proj=utm +zone=10 +datum=NAD83 +units=m +no_defs');
```

The output grid is pinned in local metres. Do not assume its axes equal UTM; imagery is
reprojected per output sample. Persist exact snapped bounds in the reviewed build manifest.

- [ ] **Step 4: Run tests**

Run: `node --test test/hd-coordinates.test.mjs test/hd-bounds.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tools/hd-course/coordinates.mjs tools/hd-course/bounds.mjs test/hd-coordinates.test.mjs test/hd-bounds.test.mjs tools/hd-course/manifests/bandon-dunes-hole-01.json
git commit -m "feat(hd): define prototype coordinate grids"
```

### Task 2: Add strict 3DEP acquisition without breaking best-effort gameplay

**Files:**

- Create: `tools/hd-course/three-dep.mjs`
- Create: `tools/hd-course/terrain.mjs`
- Create: `test/hd-3dep-provider.test.mjs`
- Create: `test/hd-terrain-compiler.test.mjs`
- Modify: `lib/lidar.js`
- Modify: `test/lidar.test.js`

- [ ] **Step 1: Write strict provider tests**

Inject fake fetch responses and cover: HTTP/ArcGIS errors, timeout, truncated and oversized
BSQ, metadata dimension/extent mismatch, all/excessive NoData, NaN/Infinity, implausible
height/gradient, and exact little-endian decode. Prove existing `fetchPatch()` still returns
`null` on an optional runtime failure while the new strict API throws.

```js
await assert.rejects(
  () => fetchPatchStrict(bbox, { fetchImpl: truncatedFetch }),
  (e) => e.code === 'HD_3DEP_TRUNCATED' && e.stage === 'download-elevation'
);
assert.equal(await fetchPatch(bbox, { fetchImpl: truncatedFetch }), null);
```

- [ ] **Step 2: Verify focused tests fail**

Run: `node --test test/lidar.test.js test/hd-3dep-provider.test.mjs test/hd-terrain-compiler.test.mjs`

Expected: FAIL because strict APIs are missing.

- [ ] **Step 3: Refactor one strict implementation with optional wrapper**

`lib/lidar.js` exports `fetchPatchStrict` and keeps `fetchPatch` as a small catch-and-null
wrapper. The compiler adapter translates errors to `HdCompileError` and records:

- request extent/size/spacing;
- service/version metadata;
- valid/NoData ratios;
- returned extent/dimensions;
- min/max/gradient statistics; and
- authoritative native source resolution if available, otherwise explicit `unknown` plus a
  warning that requested 1 m output may be upsampled.

`terrain.mjs` resamples to the local 1 m grid, uses the cached coarse terrain only for small
allowed gaps, and bakes one edge-blend ring. It writes relative heights; it does not apply a
second runtime feather.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/lidar.test.js test/hd-3dep-provider.test.mjs test/hd-terrain-compiler.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/lidar.js tools/hd-course/three-dep.mjs tools/hd-course/terrain.mjs test/lidar.test.js test/hd-3dep-provider.test.mjs test/hd-terrain-compiler.test.mjs
git commit -m "feat(hd): compile strict full-hole 3DEP terrain"
```

### Task 3: Read only pinned NAIP COG windows

**Files:**

- Create: `tools/hd-course/naip.mjs`
- Create: `tools/hd-course/cog-source.mjs`
- Create: `test/hd-naip-provider.test.mjs`
- Create: `test/fixtures/hd-course/naip-search.json`

- [ ] **Step 1: Write STAC selection and COG range tests**

Use a local HTTP test server/synthetic GeoTIFF to assert actual `Range` requests. Reject a
server that ignores Range and starts a full response. Test deterministic results under API
reordering, mixed-date rejection, missing item/asset/CRS/GSD, incomplete union coverage,
redirect to unapproved hosts, canonical provenance without SAS query strings, and drift in
the manifest-pinned unsigned asset URL/content length/ETag. Instrument the test server and
assert no more than two range requests are in flight across both COGs at any moment.

```js
assert.deepEqual(selected.map((x) => x.id), [
  'or_m_4312453_ne_10_030_20220623',
  'or_m_4312453_se_10_030_20220623',
]);
assert.ok(bytesFetched < 8 * 1024 * 1024, 'fixture COG must be read by range');
```

- [ ] **Step 2: Verify focused tests fail**

Run: `node --test test/hd-naip-provider.test.mjs`

Expected: FAIL because NAIP/COG modules are missing.

- [ ] **Step 3: Implement pinned-source validation and range source**

Public contracts:

```js
export async function searchNaipCandidates({ bbox, fetchImpl }) { /* STAC metadata */ }
export function selectPinnedAcquisition(features, manifest) { /* exact IDs/date/GSD/CRS */ }
export async function openPinnedCog(source, {
  fetchImpl, byteBudget, rangeSemaphore,
}) { /* range-only; every internal fetch acquires the shared semaphore */ }
```

The current NE source is approximately 1.4 GB. Any full-object download is a hard failure.
Use GeoTIFF.js window/range reads and record ETag/Last-Modified when available.
Before reading, require the canonical unsigned asset URL, content length, and ETag to match
the checked-in manifest. Current public Azure blobs need no SAS token; reject authorization
failure instead of persisting a short-lived signed URL.
Use one shared semaphore with default/max `2` around the custom GeoTIFF range client, not
merely around top-level item opens, so library-driven block reads are also bounded.

- [ ] **Step 4: Run tests**

Run: `node --test test/hd-naip-provider.test.mjs`

Expected: PASS with the test server proving range behavior.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tools/hd-course/naip.mjs tools/hd-course/cog-source.mjs test/hd-naip-provider.test.mjs test/fixtures/hd-course/naip-search.json
git commit -m "feat(hd): read pinned NAIP COG windows"
```

### Task 4: Reproject imagery and generate deterministic semantic textures

**Files:**

- Create: `tools/hd-course/imagery.mjs`
- Create: `tools/hd-course/masks.mjs`
- Create: `tools/hd-course/normalize.mjs`
- Create: `tools/hd-course/encode.mjs`
- Create: `test/hd-imagery.test.mjs`
- Create: `test/hd-masks.test.mjs`
- Create: `test/hd-encoding.test.mjs`

- [ ] **Step 1: Write raster tests with unmistakable corner colors**

Use synthetic source rasters whose NW/NE/SW/SE pixels are red/green/blue/yellow to detect
mirrored Y, rotated grids, and wrong overlap order. Test per-output-pixel local→WGS84→UTM
sampling, bilinear RGB, two-source seams, gap rejection, deterministic LUT normalization,
and decoded output dimensions.

Mask tests assert the schema-v1 packing:

```text
surfaces.png: R=fairway, G=green, B=tee, A=bunker
coverage.png: R=imagery validity, G=water, B=0, A=255
```

Supersample polygon edges 4× before downsampling. Rough is implicit where no surface wins.

- [ ] **Step 2: Verify tests fail**

Run: `node --test test/hd-imagery.test.mjs test/hd-masks.test.mjs test/hd-encoding.test.mjs`

Expected: FAIL because raster modules are missing.

- [ ] **Step 3: Implement imagery/masks/encoding**

Apply a pinned 256-entry-per-channel normalization LUT only; no AI enhancement or adaptive
auto-grade. Encode:

- `terrain.f32` via explicit `Buffer.writeFloatLE`;
- `orthophoto.webp` through Sharp with pinned quality/effort/chroma settings;
- `surfaces.png` and `coverage.png` through PNGJS.

Record Node, GeoTIFF.js, Proj4js, Sharp, and libvips versions. WebP byte hashes are platform-
specific evidence; logical decoded pixels/dimensions and recorded tool versions define
reproducibility. Runtime generates mipmaps after decode.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/hd-imagery.test.mjs test/hd-masks.test.mjs test/hd-encoding.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tools/hd-course/imagery.mjs tools/hd-course/masks.mjs tools/hd-course/normalize.mjs tools/hd-course/encode.mjs test/hd-imagery.test.mjs test/hd-masks.test.mjs test/hd-encoding.test.mjs
git commit -m "feat(hd): encode reprojected hole imagery and masks"
```

### Task 5: Orchestrate, validate, and publish one complete bundle

**Files:**

- Create: `tools/hd-course/compiler.mjs`
- Create: `tools/hd-course/cli.mjs`
- Create: `tools/hd-course/report.mjs`
- Create: `tools/smoke-hd-providers.mjs`
- Create: `tools/validate-hd-bundle.js`
- Create: `test/hd-compiler.test.mjs`
- Modify: `package.json`
- Modify: `ASSETS.md`

- [ ] **Step 1: Write an offline end-to-end compiler test**

Force `global.fetch` to throw and inject fixture providers. Compile twice into separate temp
roots; validate both; compare canonical manifests, decoded raster values, and hashes on the
same toolchain. Inject a failure at every named stage and assert no `active.json` change.

- [ ] **Step 2: Verify it fails**

Run: `node --test test/hd-compiler.test.mjs`

Expected: FAIL because CLI/compiler/report modules are missing.

- [ ] **Step 3: Implement stage orchestration and scripts**

Named stages are `resolve-course`, `compute-bounds`, `discover-elevation`, `download-elevation`,
`discover-imagery`, `download-imagery`, `reproject`, `rasterize-masks`, `encode`, `validate`,
and `publish`. Each report entry includes duration/input/output bytes.

Add scripts:

```json
{
  "build:hd-hole": "node tools/hd-course/cli.mjs build",
  "validate:hd-bundle": "node tools/validate-hd-bundle.js",
  "smoke:hd-providers": "node tools/smoke-hd-providers.mjs"
}
```

Add OSM ODbL, NAIP public-domain, USGS public-domain, and generated-bundle provenance rules
to `ASSETS.md`.

- [ ] **Step 4: Run offline verification**

Run:

```powershell
node --test "test/hd-*.test.js" "test/hd-*.test.mjs"
npm test
```

Expected: PASS without network.

- [ ] **Step 5: Run explicit live smoke and Bandon build**

Prerequisite: cache Bandon through the app or run the existing course-load tool.

Run:

```powershell
npm run smoke:hd-providers -- --manifest tools/hd-course/manifests/bandon-dunes-hole-01.json
npm run build:hd-hole -- --manifest tools/hd-course/manifests/bandon-dunes-hole-01.json
npm run validate:hd-bundle -- --course bandon-dunes
```

Expected:

- both pinned 2022 NAIP items are found;
- COG access remains within configured range-byte budgets;
- 3DEP coverage/quality statistics are reported;
- `active.json` references one validated immutable bundle;
- no raw source download appears in the final bundle; and
- measured bundle/workspace sizes are printed.

- [ ] **Step 6: Commit source code/config/docs only**

```powershell
git add package.json package-lock.json ASSETS.md tools/hd-course tools/smoke-hd-providers.mjs tools/validate-hd-bundle.js test/hd-compiler.test.mjs
git commit -m "feat(hd): compile Bandon Hole 1 bundle"
```

Do not stage `data/hd-build-cache/` or `data/hd-courses/`.

## Plan 2 completion gate

- [ ] Strict source errors identify the failed stage and real provider cause.
- [ ] No entire NAIP COG is downloaded.
- [ ] Same-date two-item coverage is complete and deterministic.
- [ ] Terrain/image/masks share exact local bounds and orientation.
- [ ] Source resolution uncertainty is explicit rather than presented as native 1 m LiDAR.
- [ ] Bundle publication/validation passes and actual sizes are recorded.
- [ ] `npm test` passes offline.
