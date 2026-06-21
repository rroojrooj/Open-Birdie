// Terrain turf material. Keeps the painted splat (per-surface zones) as the base
// color, overlays a tiled CC0 PBR grass set (real normal + roughness + blade-detail
// albedo), adds shader mowing stripes gated to a fairway/green mask, and swaps in
// bright CC0 sand on a bunker mask — all on the single terrain mesh.
import * as THREE from 'three';
import { ASSETS } from './assets.js';

const loader = new THREE.TextureLoader();
function tiled(url, srgb, repX, repY, aniso) {
  const t = loader.load(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.anisotropy = aniso;
  return t;
}

// Dedicated sand material for crisp bunker meshes (Tier 1). A plain
// MeshStandardMaterial — no onBeforeCompile — so it stays GTAO-safe and cheap.
// Uses the full CC0 sand PBR set (color + normal + roughness), brightened toward
// bunker-white. polygonOffset so the bunker mesh wins over the base + green collar.
export function makeSandMaterial(bounds, aniso) {
  const extX = bounds.maxX - bounds.minX, extY = bounds.maxY - bounds.minY;
  const tileM = 2.0, repX = extX / tileM, repY = extY / tileM;
  const map = tiled(ASSETS.turf.sand, true, repX, repY, aniso);
  const normalMap = tiled(ASSETS.turf.sandNormal, false, repX, repY, aniso);
  const roughnessMap = tiled(ASSETS.turf.sandRough, false, repX, repY, aniso);
  const mat = new THREE.MeshStandardMaterial({
    map, normalMap, normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap, roughness: 1.0, metalness: 0,
    envMapIntensity: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1.2, polygonOffsetUnits: -1.2,
  });
  mat.color = new THREE.Color(1.3, 1.24, 1.08); // brighten + warm toward bright bunker sand
  mat.userData.disposeTextures = [map, normalMap, roughnessMap];
  return mat;
}

export function makeTurfMaterial(splatTex, maskTex, bunkerMaskTex, bounds, aniso) {
  const extX = bounds.maxX - bounds.minX, extY = bounds.maxY - bounds.minY;
  const tileM = 2.0; // grass texture repeats ~every 2m
  const repX = extX / tileM, repY = extY / tileM;

  const normalMap = tiled(ASSETS.turf.normal, false, repX, repY, aniso);
  const roughnessMap = tiled(ASSETS.turf.rough, false, repX, repY, aniso);
  const detail = tiled(ASSETS.turf.color, true, repX, repY, aniso);
  const sand = tiled(ASSETS.turf.sand, true, repX, repY, aniso);
  maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
  bunkerMaskTex.wrapS = bunkerMaskTex.wrapT = THREE.ClampToEdgeWrapping;

  const mat = new THREE.MeshStandardMaterial({
    map: splatTex,
    normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap, roughness: 1.0, metalness: 0,
    envMapIntensity: 0.55, // cut the grazing-angle sky sheen that read cool/wet
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.uniforms.uDetailRepeat = { value: new THREE.Vector2(repX, repY) };
    shader.uniforms.uMask = { value: maskTex };
    shader.uniforms.uBunker = { value: bunkerMaskTex };
    shader.uniforms.uSand = { value: sand };
    shader.uniforms.uExt = { value: new THREE.Vector2(extX, extY) };
    shader.uniforms.uStripeM = { value: 6.0 };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetail; uniform vec2 uDetailRepeat;
        uniform sampler2D uMask; uniform sampler2D uBunker; uniform sampler2D uSand;
        uniform vec2 uExt; uniform float uStripeM;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
        {
          // grass path: splat zone color modulated by tiled blade detail + mow stripes
          vec3 gd = texture2D(uDetail, vMapUv * uDetailRepeat).rgb;
          float dl = dot(gd, vec3(0.299, 0.587, 0.114));
          vec3 grass = diffuseColor.rgb * (0.72 + 0.48 * dl);
          // inject a little of the blade's own chroma so a zone isn't one flat tint
          // (green/yellow flecks); clamped so dark blade pixels can't blow up the hue
          grass *= mix(vec3(1.0), clamp(gd / max(dl, 0.1), 0.6, 1.5), 0.16);
          float m = texture2D(uMask, vMapUv).r;
          float wx = vMapUv.x * uExt.x, wy = vMapUv.y * uExt.y;
          // cross-cut mow: two stripe directions give the checker sheen of a real cut
          float band = sin((wx * 0.82 + wy * 0.57) * (3.14159265 / uStripeM));
          float stripe = smoothstep(-0.15, 0.15, band) * 2.0 - 1.0;
          float band2 = sin((wx * -0.55 + wy * 0.84) * (3.14159265 / (uStripeM * 1.7)));
          float stripe2 = smoothstep(-0.2, 0.2, band2) * 2.0 - 1.0;
          grass *= 1.0 + (0.15 * stripe + 0.06 * stripe2) * m;
          // multi-scale tonal mottling so turf isn't a flat carpet:
          //  large swells (~50-120m) for broad shading...
          float lv = (sin(wx * 0.13 + wy * 0.07) * 0.5
                    + sin(wx * 0.06 - wy * 0.11) * 0.32
                    + sin((wx * 0.9 - wy * 1.3) * 0.05) * 0.22) * 0.45;
          //  ...plus mid clumps (~12-20m) for the patchy growth real turf has
          float mv = sin(wx * 0.46 + wy * 0.28) * sin(wy * 0.39 - wx * 0.21);
          grass *= 1.0 + 0.15 * lv + 0.08 * mv;   // brightness patches
          grass.r *= 1.0 + 0.06 * lv + 0.03 * mv; // warmer/yellower clumps
          grass.b *= 1.0 - 0.04 * lv;
          grass *= vec3(0.96, 1.0, 0.97);          // deepen the cartoon zone-green a touch
          // sand path: real tiled sand, brightened toward bright bunker white
          vec3 sand = texture2D(uSand, vMapUv * uDetailRepeat).rgb;
          sand = mix(sand, vec3(1.0), 0.12) * 1.28;
          float bm = texture2D(uBunker, vMapUv).r;
          diffuseColor.rgb = mix(grass, sand, bm);
        }
        #endif`);
  };
  mat.customProgramCacheKey = () => 'turf-stripe-sand-v3';
  // textures injected via onBeforeCompile (+ the canvas masks) aren't reachable from
  // the standard material slots, so register them for disposal on course reload.
  mat.userData.disposeTextures = [detail, sand, maskTex, bunkerMaskTex];
  return mat;
}
