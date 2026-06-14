// Terrain turf material. Keeps the painted splat (per-surface zones + mow stripes)
// as the base color, but overlays a tiled CC0 PBR grass set (real normal +
// roughness + blade-detail albedo) so the turf has real blade texture and light
// response instead of reading as flat plastic.
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

export function makeTurfMaterial(splatTex, bounds, aniso) {
  const tileM = 2.0; // grass texture repeats ~every 2m across the course
  const repX = (bounds.maxX - bounds.minX) / tileM;
  const repY = (bounds.maxY - bounds.minY) / tileM;

  const normalMap = tiled(ASSETS.turf.normal, false, repX, repY, aniso);
  const roughnessMap = tiled(ASSETS.turf.rough, false, repX, repY, aniso);
  const detail = tiled(ASSETS.turf.color, true, repX, repY, aniso);

  const mat = new THREE.MeshStandardMaterial({
    map: splatTex,
    normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap, roughness: 1.0, metalness: 0,
  });

  // Overlay the tiled grass blade-detail (luminance only, so it adds texture
  // without tinting non-grass zones like sand) onto the splat base color.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.uniforms.uDetailRepeat = { value: new THREE.Vector2(repX, repY) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nuniform vec2 uDetailRepeat;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 gd = texture2D(uDetail, vMapUv * uDetailRepeat).rgb;
          float dl = dot(gd, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb *= (0.7 + 0.62 * dl); // blade light/dark, hue preserved
        }`);
  };
  mat.customProgramCacheKey = () => 'turf-detail';
  return mat;
}
