import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { makeTurfMaterial } from '../public/render/turf.js';

// TextureLoader.load needs a DOM Image; stub it so the material builds headless.
THREE.TextureLoader.prototype.load = function load() { return new THREE.Texture(); };

const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const tex = () => new THREE.Texture();
const fakeShader = () => ({
  uniforms: {},
  fragmentShader: '#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>',
});

test('legacy turf material (options object): same uniforms, no macro', () => {
  const mat = makeTurfMaterial({ baseMap: tex(), mownMask: tex(), bunkerMask: tex(), bounds, anisotropy: 4 });
  const s = fakeShader();
  mat.onBeforeCompile(s);
  for (const u of ['uDetail', 'uMask', 'uBunker', 'uSand', 'uExt', 'uStripeM', 'uCourseDry', 'uMaskRaw', 'uPalGreenA']) assert.ok(s.uniforms[u], `missing ${u}`);
  assert.equal(s.uniforms.uCourseDry.value, 0, 'courseDry defaults to 0 (lush)');
  assert.ok(!s.uniforms.uMacro, 'no macro uniform without macro');
  assert.equal(mat.customProgramCacheKey(), 'turf-grain-v36-precedence');
  // P2a-T3: an OSM-vicinity signal (dilated raw mask) is computed for classmap reconciliation.
  assert.match(s.fragmentShader, /float osmNear = max\(/);
  // P2a: crisp edges composited from the RAW mask via fwidth AA. Green (.g) gets a full
  // base-colour override; the mown/fairway (.r) crisp mask drives the STRIPE edge.
  assert.match(s.fragmentShader, /vec4 mkRaw = texture2D\(uMaskRaw, vMapUv\)/);
  assert.match(s.fragmentShader, /float gCrisp = smoothstep\(0\.5 - gAA, 0\.5 \+ gAA, gRaw\)/);
  assert.match(s.fragmentShader, /float mCrisp = smoothstep\(0\.5 - mAA, 0\.5 \+ mAA, mRaw\)/);
  assert.match(s.fragmentShader, /float gRaw = mkRaw\.g, mRaw = mkRaw\.r, bRaw = mkRaw\.b/);
  assert.match(s.fragmentShader, /float bCrisp = smoothstep\(0\.5 - bAA, 0\.5 \+ bAA, bRaw\)/);
  assert.doesNotMatch(s.fragmentShader, /float bRaw = texture2D\(uBunker/);
  // P2a Task 2: base-colour stack rough(splat) -> collar apron -> putting surface.
  assert.match(s.fragmentShader, /vec3 baseCol = mix\(diffuseColor\.rgb, collarCol, collarBand\)/);
  assert.match(s.fragmentShader, /mix\(baseCol, uPalGreenA, gCrisp\)/);
  // the collar apron rides collarBand (crisp inner via 1-gCrisp, distance-faded)
  assert.match(s.fragmentShader, /float collarBand = clamp\(gDil, 0\.0, 1\.0\) \* \(1\.0 - gCrisp\)/);
  // stripes gate on the crisp mown edge (unioned with NDVI coverage)
  assert.match(s.fragmentShader, /max\(mCrisp, cls\.r\)/);
  // v25: the green gate rides uMask.g (packed channel) in BOTH variants —
  // the roughness sheen samples it directly, the map block via the mk swizzle
  assert.match(s.fragmentShader, /texture2D\(uMask, vMapUv\)\.g/);
  assert.match(s.fragmentShader, /roughnessFactor = mix\(roughnessFactor/);
  assert.match(s.fragmentShader, /float g = mk\.g/);
  // v27: the non-macro variant still defines `cls` (as a zero vec4) so the sand
  // union line `max(bCrisp, cls.b...)` compiles in BOTH variants.
  assert.match(s.fragmentShader, /vec4 cls = vec4\(0\.0\)/);
  // P2a: the OSM bunker edge is crisped with fwidth (bCrisp) then unioned with NDVI sand.
  assert.match(s.fragmentShader, /float bCrisp = smoothstep\(0\.5 - bAA, 0\.5 \+ bAA, bRaw\)/);
  assert.match(s.fragmentShader, /float bm = max\(bCrisp, cls\.b/);
});

test('macro turf material: adds aerial tint uniforms + a distinct program', () => {
  const macro = {
    albedo: tex(), surfaces: tex(), coverage: tex(), low: tex(), avg: new THREE.Vector3(0.2, 0.25, 0.2),
    bounds: { minX: 10, minY: 10, maxX: 40, maxY: 40 }, closeWeight: 0.2, farWeight: 0.6, photoFar: 0.65,
  };
  const mat = makeTurfMaterial({ baseMap: tex(), mownMask: tex(), bunkerMask: tex(), bounds, anisotropy: 4, macro });
  const s = fakeShader();
  mat.onBeforeCompile(s);
  for (const u of ['uMacro', 'uMacroSurfaces', 'uMacroCoverage', 'uMacroLow', 'uMacroAvg', 'uMacroPhotoFar',
    'uMacroMin', 'uMacroSize', 'uMacroWeights', 'uCourseMin']) assert.ok(s.uniforms[u], `missing ${u}`);
  assert.equal(s.uniforms.uMacroLow.value, macro.low);
  assert.equal(s.uniforms.uMacroAvg.value, macro.avg);
  assert.equal(s.uniforms.uMacroPhotoFar.value, 0.65);
  assert.equal(mat.customProgramCacheKey(), 'turf-grain-v36-precedence-macro');
  // P2a-T3: the feathered NDVI classmap is suppressed where OSM authored the boundary
  // (osmNear) BEFORE the mown union, so the crisp OSM edge owns it (kills the double edge).
  assert.match(s.fragmentShader, /max\(max\(mkRaw\.r, mkRaw\.b\)/);
  assert.match(s.fragmentShader, /cls\.r \*= 1\.0 - osmNear/);
  assert.match(s.fragmentShader, /cls\.b \*= 1\.0 - osmNear/);
  assert.ok(s.fragmentShader.indexOf('cls.r *= 1.0 - osmNear') < s.fragmentShader.indexOf('m = max(m, cls.r)'),
    'NDVI suppression must precede the mown union');
  assert.ok(s.fragmentShader.indexOf('cls.b *= 1.0 - osmNear') < s.fragmentShader.indexOf('float bm = max(bCrisp, cls.b'),
    'NDVI suppression must precede the bunker union');
  // the tint must be SAMPLED (a declaration alone would pass a bare /uMacroLow/ match)
  assert.match(s.fragmentShader, /texture2D\(\s*uMacroLow/);
  // v27: the NDVI class-map (uMacroSurfaces) was declared-but-unsampled — it must now
  // be SAMPLED (in aerial-bounds space, clsUv) to drive the mown + sand unions.
  assert.match(s.fragmentShader, /texture2D\(\s*uMacroSurfaces/);
  // the mown gate is WIDENED by NDVI-detected fairway (cls.r) BEFORE the stripe block…
  assert.match(s.fragmentShader, /m = max\(m, cls\.r\)/);
  // ORDERING GUARD (the feature's #1 risk): the mown union MUST precede the stripe block,
  // else stripes never key off the widened m and NDVI fairway gets no stripes — a
  // mis-order would pass every other assertion. Pin it by source position.
  assert.ok(s.fragmentShader.indexOf('m = max(m, cls.r)') < s.fragmentShader.indexOf('float band = sin('),
    'NDVI mown-union must appear before the stripe block');
  // …and the sand gate UNIONS NDVI-detected sand (cls.b) with the crisp OSM bunker edge.
  assert.match(s.fragmentShader, /float bm = max\(bCrisp, cls\.b/);
  // the v23 photo-REPLACEMENT blend is gone — a bad merge restoring it must fail here
  assert.doesNotMatch(s.fragmentShader, /grass = mix\(grass, photo, mw\)/);
});

test('P1b: courseDry passes through to the uCourseDry uniform (drives warm-mix/stripes/far-photo)', () => {
  const mat = makeTurfMaterial({ baseMap: tex(), mownMask: tex(), bunkerMask: tex(), bounds, anisotropy: 4, courseDry: 0.8 });
  const s = fakeShader();
  mat.onBeforeCompile(s);
  assert.equal(s.uniforms.uCourseDry.value, 0.8);
  assert.match(s.fragmentShader, /uCourseDry/);
});

test('macro without low/avg (HD-bundle shape) still wires tint uniforms', () => {
  const macro = { albedo: tex(), surfaces: tex(), coverage: tex(), bounds, closeWeight: 0.2, farWeight: 0.6 };
  const mat = makeTurfMaterial({ baseMap: tex(), mownMask: tex(), bunkerMask: tex(), bounds, anisotropy: 4, macro });
  const s = fakeShader();
  mat.onBeforeCompile(s);
  assert.ok(s.uniforms.uMacroLow.value, 'uMacroLow falls back to the albedo');
  assert.equal(s.uniforms.uMacroLow.value, macro.albedo);
  assert.ok(s.uniforms.uMacroAvg.value && typeof s.uniforms.uMacroAvg.value.x === 'number', 'uMacroAvg falls back to a Vector3');
  assert.equal(s.uniforms.uMacroPhotoFar.value, 0.88, 'photoFar default');
});

test('macro textures are NOT in turf disposeTextures (owned by the bundle loader)', () => {
  const macro = { albedo: tex(), surfaces: tex(), coverage: tex(), low: tex(), avg: new THREE.Vector3(1, 1, 1), bounds, closeWeight: 0.2, farWeight: 0.6 };
  const mat = makeTurfMaterial({ baseMap: tex(), mownMask: tex(), bunkerMask: tex(), bounds, anisotropy: 4, macro });
  const disp = mat.userData.disposeTextures || [];
  assert.ok(!disp.includes(macro.albedo) && !disp.includes(macro.surfaces) && !disp.includes(macro.coverage) && !disp.includes(macro.low));
});

test('raw RGB surface mask is wired in production and disposed exactly once', () => {
  const raw = tex();
  const mat = makeTurfMaterial({
    baseMap: tex(), mownMask: tex(), bunkerMask: tex(), surfaceMaskRaw: raw, bounds, anisotropy: 4,
  });
  assert.equal(mat.userData.disposeTextures.filter((texture) => texture === raw).length, 1);

  const sceneSource = fs.readFileSync(new URL('../public/render/scene.js', import.meta.url), 'utf8');
  assert.match(sceneSource, /surfaceMaskRaw:\s*maskRawTex/);
  assert.match(sceneSource, /\['fairway', 'tee', 'green', 'bunker'\], RAW_SURFACE_COLORS, 0, true/);
});
