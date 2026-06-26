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
  for (const u of ['uDetail', 'uMask', 'uBunker', 'uSand', 'uExt', 'uStripeM']) assert.ok(s.uniforms[u], `missing ${u}`);
  assert.ok(!s.uniforms.uMacro, 'no macro uniform without macro');
  assert.equal(mat.customProgramCacheKey(), 'turf-grain-v22');
});

test('macro turf material: adds aerial uniforms + a distinct program', () => {
  const macro = { albedo: tex(), surfaces: tex(), coverage: tex(), bounds: { minX: 10, minY: 10, maxX: 40, maxY: 40 }, closeWeight: 0.2, farWeight: 0.6 };
  const mat = makeTurfMaterial({ baseMap: tex(), mownMask: tex(), bunkerMask: tex(), bounds, anisotropy: 4, macro });
  const s = fakeShader();
  mat.onBeforeCompile(s);
  for (const u of ['uMacro', 'uMacroSurfaces', 'uMacroCoverage', 'uMacroMin', 'uMacroSize', 'uMacroWeights']) assert.ok(s.uniforms[u], `missing ${u}`);
  assert.notEqual(mat.customProgramCacheKey(), 'turf-grain-v22');
  assert.match(s.fragmentShader, /uMacro/);
});

test('macro textures are NOT in turf disposeTextures (owned by the bundle loader)', () => {
  const macro = { albedo: tex(), surfaces: tex(), coverage: tex(), bounds, closeWeight: 0.2, farWeight: 0.6 };
  const mat = makeTurfMaterial({ baseMap: tex(), mownMask: tex(), bunkerMask: tex(), bounds, anisotropy: 4, macro });
  const disp = mat.userData.disposeTextures || [];
  assert.ok(!disp.includes(macro.albedo) && !disp.includes(macro.surfaces) && !disp.includes(macro.coverage));
});
