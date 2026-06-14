// Terrain turf material. Keeps the painted splat (per-surface zones) as the base
// color, overlays a tiled CC0 PBR grass set (real normal + roughness + blade-detail
// albedo) so the turf reads as real grass, and adds shader-based mowing stripes that
// only apply on mown surfaces (fairway/green/tee) via a mask — so they survive the
// grass detail instead of being washed out like painted stripes were.
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

export function makeTurfMaterial(splatTex, maskTex, bounds, aniso) {
  const extX = bounds.maxX - bounds.minX, extY = bounds.maxY - bounds.minY;
  const tileM = 2.0; // grass texture repeats ~every 2m
  const repX = extX / tileM, repY = extY / tileM;

  const normalMap = tiled(ASSETS.turf.normal, false, repX, repY, aniso);
  const roughnessMap = tiled(ASSETS.turf.rough, false, repX, repY, aniso);
  const detail = tiled(ASSETS.turf.color, true, repX, repY, aniso);
  maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;

  const mat = new THREE.MeshStandardMaterial({
    map: splatTex,
    normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap, roughness: 1.0, metalness: 0,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.uniforms.uDetailRepeat = { value: new THREE.Vector2(repX, repY) };
    shader.uniforms.uMask = { value: maskTex };
    shader.uniforms.uExt = { value: new THREE.Vector2(extX, extY) };
    shader.uniforms.uStripeM = { value: 6.0 }; // stripe width in meters
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetail; uniform vec2 uDetailRepeat;
        uniform sampler2D uMask; uniform vec2 uExt; uniform float uStripeM;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // tiled grass blade detail (luminance only, preserves zone hue)
          vec3 gd = texture2D(uDetail, vMapUv * uDetailRepeat).rgb;
          float dl = dot(gd, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb *= (0.74 + 0.5 * dl);
          // mowing stripes: alternating brightness bands in world meters, only on
          // mown surfaces (mask), applied after detail so they actually read.
          float m = texture2D(uMask, vMapUv).r;
          float wx = vMapUv.x * uExt.x, wy = vMapUv.y * uExt.y;
          float band = sin((wx * 0.82 + wy * 0.57) * (3.14159265 / uStripeM));
          float stripe = smoothstep(-0.15, 0.15, band) * 2.0 - 1.0; // ~square ±1
          diffuseColor.rgb *= 1.0 + 0.14 * stripe * m;
        }`);
  };
  mat.customProgramCacheKey = () => 'turf-stripe';
  return mat;
}
