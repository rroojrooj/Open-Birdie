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
    shader.uniforms.uStripeM = { value: 7.0 }; // mow-band width (m) — a touch wider reads better from the orbit cam
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetail; uniform vec2 uDetailRepeat;
        uniform sampler2D uMask; uniform sampler2D uBunker; uniform sampler2D uSand;
        uniform vec2 uExt; uniform float uStripeM;
        // Procedural turf grain — evaluated from world XZ so it stays crisp at ANY
        // zoom. A tiled grass photo mip-blurs to a flat average from the elevated
        // orbit camera (the "Minecraft" smoothness); world-space value noise doesn't.
        float tHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tNoise(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          float a = tHash(i), b = tHash(i + vec2(1.0, 0.0));
          float c = tHash(i + vec2(0.0, 1.0)), d = tHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float tFbm(vec2 p){
          float s = 0.0, a = 0.5;
          for (int k = 0; k < 4; k++){ s += a * tNoise(p); p *= 2.03; a *= 0.5; }
          return s;
        }`)
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
          // procedural grain: fine "tooth" (~0.5-4m) + broad patches (~8-20m), so the
          // turf reads as real grass at the orbit camera instead of a flat plastic
          // sheet. Strong on purpose — this is the fix for the "Minecraft" look.
          // Multi-scale variation so the field is never the same twice (real grass
          // isn't). fbm clusters near its mean, so use a big gain (re-center ~0.47).
          float fine  = tFbm(vec2(wx, wy) * 0.40) - 0.47;        // ~0.7-3m blade grain
          float broad = tFbm(vec2(wy, wx) * 0.10 + 11.3) - 0.47; // ~8-15m growth/wear patches
          float zone  = tFbm(vec2(wx, wy) * 0.026 + 3.7) - 0.47; // ~30-80m big regions
          grass *= 1.0 + 0.55 * fine + 0.40 * broad + 0.45 * zone; // brightness at every scale
          // big regions also shift the grass CHARACTER — lush deep-green <-> dry
          // yellow-green — so different parts of the course read as different grass,
          // not one uniform tone stamped edge to edge.
          grass *= mix(vec3(0.90, 1.05, 0.88), vec3(1.12, 1.02, 0.74),
                       clamp(zone * 1.7 + 0.5, 0.0, 1.0));
          grass.r *= 1.0 + 0.10 * broad;                        // finer warm/cool drift on top
          grass.b *= 1.0 - 0.07 * broad;
          // cross-cut mow stripes (bold enough to read from above), fairway/green only
          float band = sin((wx * 0.82 + wy * 0.57) * (3.14159265 / uStripeM));
          float stripe = smoothstep(-0.2, 0.2, band) * 2.0 - 1.0;
          float band2 = sin((wx * -0.55 + wy * 0.84) * (3.14159265 / (uStripeM * 1.7)));
          float stripe2 = smoothstep(-0.25, 0.25, band2) * 2.0 - 1.0;
          // balanced cross-hatch: the two stripe sets are ~perpendicular, so whichever
          // way you face down a hole, at least one set crosses your view and reads
          // (a fixed single direction vanishes when you look along it). Checkerboard
          // mow is also a real pattern.
          grass *= 1.0 + (0.18 * stripe + 0.16 * stripe2) * m;
          grass *= vec3(0.96, 1.0, 0.97);          // deepen the zone-green a touch
          // sand path: real tiled sand, brightened toward bright bunker white
          vec3 sand = texture2D(uSand, vMapUv * uDetailRepeat).rgb;
          sand = mix(sand, vec3(1.0), 0.12) * 1.28;
          float bm = texture2D(uBunker, vMapUv).r;
          diffuseColor.rgb = mix(grass, sand, bm);
        }
        #endif`);
  };
  mat.customProgramCacheKey = () => 'turf-grain-v8';
  // textures injected via onBeforeCompile (+ the canvas masks) aren't reachable from
  // the standard material slots, so register them for disposal on course reload.
  mat.userData.disposeTextures = [detail, sand, maskTex, bunkerMaskTex];
  return mat;
}
