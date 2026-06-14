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
          vec3 grass = diffuseColor.rgb * (0.74 + 0.5 * dl);
          float m = texture2D(uMask, vMapUv).r;
          float wx = vMapUv.x * uExt.x, wy = vMapUv.y * uExt.y;
          float band = sin((wx * 0.82 + wy * 0.57) * (3.14159265 / uStripeM));
          float stripe = smoothstep(-0.15, 0.15, band) * 2.0 - 1.0;
          grass *= 1.0 + 0.14 * stripe * m;
          // sand path: real tiled sand, brightened toward bright bunker white
          vec3 sand = texture2D(uSand, vMapUv * uDetailRepeat).rgb;
          sand = mix(sand, vec3(1.0), 0.12) * 1.28;
          float bm = texture2D(uBunker, vMapUv).r;
          diffuseColor.rgb = mix(grass, sand, bm);
        }
        #endif`);
  };
  mat.customProgramCacheKey = () => 'turf-stripe-sand';
  return mat;
}
