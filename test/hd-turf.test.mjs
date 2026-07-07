import test from 'node:test';
import assert from 'node:assert/strict';
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
  for (const u of ['uDetail', 'uMask', 'uBunker', 'uSand', 'uExt', 'uStripeM', 'uCourseDry']) assert.ok(s.uniforms[u], `missing ${u}`);
  assert.equal(s.uniforms.uCourseDry.value, 0, 'courseDry defaults to 0 (lush)');
  assert.ok(!s.uniforms.uMacro, 'no macro uniform without macro');
  assert.equal(mat.customProgramCacheKey(), 'turf-grain-v32');
  // v25: the green gate rides uMask.g (packed channel) in BOTH variants —
  // the roughness sheen samples it directly, the map block via the mk swizzle
  assert.match(s.fragmentShader, /texture2D\(uMask, vMapUv\)\.g/);
  assert.match(s.fragmentShader, /roughnessFactor = mix\(roughnessFactor/);
  assert.match(s.fragmentShader, /float g = mk\.g/);
  // v27: the non-macro variant still defines `cls` (as a zero vec4) so the sand
  // union line `max(texture2D(uBunker...).r, cls.b...)` compiles in BOTH variants.
  assert.match(s.fragmentShader, /vec4 cls = vec4\(0\.0\)/);
  assert.match(s.fragmentShader, /max\(texture2D\(uBunker[^)]*\)\.r, cls\.b/);
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
  assert.equal(mat.customProgramCacheKey(), 'turf-grain-v32-macro');
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
  // …and the sand gate UNIONS NDVI-detected sand (cls.b) into the tiled-sand path.
  assert.match(s.fragmentShader, /max\(texture2D\(uBunker[^)]*\)\.r, cls\.b/);
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
