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
          // Manicured rebalance (Phase 2): the loud mid-scale grain read as blotch/wear
          // and BURIED the mow stripes — the opposite of manicured. Tame fine+broad,
          // keep the large zone (it survives the orbit-cam mip-collapse and carries the
          // lush/dry character below). Clean base + bold stripes = the "pro sim" read.
          grass *= 1.0 + 0.40 * fine + 0.24 * broad + 0.36 * zone; // brightness at every scale (zone tamed — was blooming lime)
          // big regions also shift the grass CHARACTER — lush deep-green <-> dry
          // yellow-green — so different parts of the course read as different grass,
          // not one uniform tone stamped edge to edge.
          grass *= mix(vec3(0.91, 1.01, 0.89), vec3(1.10, 1.01, 0.74),
                       clamp(zone * 1.7 + 0.5, 0.0, 1.0));
          grass.r *= 1.0 + 0.10 * broad;                        // finer warm/cool drift on top
          grass.b *= 1.0 - 0.07 * broad;
          // Mowing stripes — the dominant "manicured" signal, fairway/green only.
          // Softer smoothstep ramps give the mower-sheen gradient (not hard bars). A
          // BOLD primary set reads as light/dark bands from the orbit camera; a fainter,
          // wider cross set keeps the pattern alive when you sight straight down the
          // primary axis (a single direction vanishes when you look along it).
          float band = sin((wx * 0.82 + wy * 0.57) * (3.14159265 / uStripeM));
          float stripe = smoothstep(-0.42, 0.42, band) * 2.0 - 1.0;
          float band2 = sin((wx * -0.55 + wy * 0.84) * (3.14159265 / (uStripeM * 1.7)));
          float stripe2 = smoothstep(-0.5, 0.5, band2) * 2.0 - 1.0;
          grass *= 1.0 + (0.27 * stripe + 0.12 * stripe2) * m;
          // Procedural sun-play — directional shading from a low-frequency undulation
          // field so the sun visibly rakes across gentle rolls instead of lighting a
          // flat sheet. The DIRECTIONAL gradient (one flank of a roll lit, the other
          // shaded) is what reads as a lit 3D surface; the isotropic grain above only
          // reads as texture. Faked in albedo — cheap, GTAO-safe, turf normal is ~flat.
          vec2 sp = vec2(wx, wy) * 0.085;                  // ~12m roll wavelength (survives distance)
          float gx = tFbm(sp + vec2(0.07, 0.0)) - tFbm(sp - vec2(0.07, 0.0));
          float gy = tFbm(sp + vec2(0.0, 0.07)) - tFbm(sp - vec2(0.0, 0.07));
          vec2 sunDir = normalize(vec2(0.55, -0.84));      // HDRI sun's horizontal bearing
          float rake = clamp((gx * sunDir.x + gy * sunDir.y) * 7.0, -0.6, 0.6);
          grass *= 1.0 + 0.22 * rake;                      // sun-side bright, shade-side dark
          grass *= vec3(0.96, 1.0, 0.97);          // deepen the zone-green a touch
          // sand path: real tiled sand, brightened toward bright bunker white
          vec3 sand = texture2D(uSand, vMapUv * uDetailRepeat).rgb;
          sand = mix(sand, vec3(1.0), 0.12) * 1.28;
          float bm = texture2D(uBunker, vMapUv).r;
          diffuseColor.rgb = mix(grass, sand, bm);
        }
        #endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // Soften roughness on mown surfaces so a gentle specular lobe exists for the
        // sheen to roll through — subtle, to stay clear of the plasticky/wet glow we
        // de-glowed earlier. Mask recomputed here (the m in map_fragment is out of scope).
        {
          float rmm = texture2D(uMask, vMapUv).r;
          // Distance-gate the sheen: NEAR turf stays MATTE (real close-up grass scatters
          // diffusely — a spec lobe right under the camera read as wet vinyl). Only the
          // far field gets a subtle lobe. specFar: 0 near -> 1 far.
          float specFar = smoothstep(14.0, 45.0, length(vViewPosition));
          roughnessFactor = mix(roughnessFactor, roughnessFactor * mix(1.0, 0.88, specFar), rmm);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // Specular sheen: tilt the shading normal by a low-frequency undulation field so
        // the sun glint + sky reflection ROLL across the turf as the camera moves (the
        // wet-lush pro-sim sheen). World XZ from the splat UV; nudge the view-space
        // normal toward the undulation downslope. vMapUv is defined (USE_MAP) so this
        // stays GTAO-safe; the tilt is gentle so distant turf doesn't shimmer.
        {
          float snwx = vMapUv.x * uExt.x, snwy = vMapUv.y * uExt.y;
          // SMOOTH single-octave noise (not fbm): broad rolls only, no fine facets —
          // fine facets + a sharp specular lobe are what glitter without TAA. Broad
          // rolls give soft sheen BANDS on the flanks, so we can afford a lower
          // roughness (below) for a sheen that actually reads.
          vec2 snp = vec2(snwx, snwy) * 0.045;   // ~22m smooth rolls
          float sgx = tNoise(snp + vec2(0.12, 0.0)) - tNoise(snp - vec2(0.12, 0.0));
          float sgy = tNoise(snp + vec2(0.0, 0.12)) - tNoise(snp - vec2(0.0, 0.12));
          vec3 tiltV = (viewMatrix * vec4(-sgx, 0.0, -sgy, 0.0)).xyz;
          normal = normalize(normal + tiltV * 1.0); // visible sheen w/o dramatic wide pooling
        }`);
  };
  mat.customProgramCacheKey = () => 'turf-grain-v15';
  // textures injected via onBeforeCompile (+ the canvas masks) aren't reachable from
  // the standard material slots, so register them for disposal on course reload.
  mat.userData.disposeTextures = [detail, sand, maskTex, bunkerMaskTex];
  return mat;
}
