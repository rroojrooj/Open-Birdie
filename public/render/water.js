// Animated water for course hazards. Each OSM water polygon becomes a flat
// horizontal plane (normal = world +Y), so we can ripple the surface with an
// analytic wave field in world XZ and feed that straight into the standard
// material's normal — no normal-map asset, no tangent-space bookkeeping.
//
// The ripples shimmer the HDRI sky reflection (envMap) the material already
// does, a Fresnel term lifts reflectivity at grazing angles (deep-blue looking
// down, sky-bright at the shore line), and a Blinn-Phong sun term adds the
// moving specular glitter toward the sun. Integrates with fog + post-FX because
// it stays a MeshStandardMaterial in the normal render pass.
import * as THREE from 'three';
import { RENDER_CONFIG } from './config.js';

// GLSL: sum of directional gerstner-ish ripples -> height gradient -> normal.
// Kept gentle (small amplitudes) so the plane reads as calm pond water, not surf.
const WATER_COMMON = `
  uniform float uTime;
  uniform vec3  uSunDir;        // world-space direction TO the sun
  uniform vec3  uDeep;          // deep-water body color
  uniform vec3  uShallow;       // sky-tinted grazing/shore color
  uniform float uChop;          // ripple steepness
  varying vec3  vWorldPos;
  vec3 gWaterWN;                // rippled world normal, reused for specular

  // analytic normal of h(p,t) = sum A_i sin(dir_i . p * f_i + t * s_i).
  // Directions fan out by the golden angle so no two waves align (a few aligned
  // waves read as a mechanical crosshatch); frequencies grow by a non-integer
  // ratio (no harmonic moire), from ~15m swells down to ~1m chop.
  vec3 rippleNormal(vec2 p, float t) {
    vec2 g = vec2(0.0);
    float freq = 0.42, amp = 0.085, ang = 0.0;
    const int N = 8;
    for (int i = 0; i < N; i++) {
      vec2 d = vec2(cos(ang), sin(ang));
      float ph = dot(d, p) * freq + t * (0.6 + freq * 0.45);
      g += amp * freq * d * cos(ph);   // dh/dp = A * f * d * cos(phase)
      ang  += 2.39996;                  // golden angle (radians)
      freq *= 1.48;
      amp  *= 0.76;
    }
    g *= uChop;
    return normalize(vec3(-g.x, 1.0, -g.y));
  }
`;

function addWaterShader(material, windRef, sunDir) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSunDir = { value: sunDir.clone().normalize() };
    shader.uniforms.uDeep = { value: new THREE.Color(0x123a4d) };
    shader.uniforms.uShallow = { value: new THREE.Color(0x7fb0cc) };
    shader.uniforms.uChop = { value: 0.8 };
    windRef.push(shader.uniforms.uTime);

    // --- vertex: carry world position for the wave field ---
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWorldPos;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    // --- fragment: ripple the normal, then add Fresnel rim + sun specular ---
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WATER_COMMON)
      // Override the geometric normal with the rippled one (view space) so the
      // envMap reflection + lighting shimmer. Plane is axis-aligned flat, so the
      // world ripple normal converts to view space with just the view rotation.
      // Override the view-space normal with the rippled one. Downstream,
      // <lights_fragment_begin> sets geometryNormal = normal (this material has
      // no normalMap chunk to clobber it), so the envMap reflection + lighting
      // pick up the ripples. Plane is axis-aligned flat, so the world ripple
      // normal converts to view space with just the view rotation.
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        gWaterWN = rippleNormal(vWorldPos.xz, uTime);
        normal = normalize((viewMatrix * vec4(gWaterWN, 0.0)).xyz);`)
      .replace('#include <opaque_fragment>', `
        {
          vec3 V = normalize(cameraPosition - vWorldPos);
          float fres = pow(clamp(1.0 - max(dot(V, gWaterWN), 0.0), 0.0, 1.0), 3.0);
          // body color: deep + less reflective looking straight down, sky-tinted
          // and fully reflective at grazing
          outgoingLight = mix(outgoingLight * 0.7 + uDeep * 0.4, outgoingLight + uShallow * 0.5, fres);
          // moving sun glitter (Blinn-Phong toward the sun)
          vec3 H = normalize(uSunDir + V);
          float s = pow(max(dot(gWaterWN, H), 0.0), 220.0);
          outgoingLight += vec3(1.0, 0.96, 0.86) * s * 1.6;
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'water-anim';
}

// surfaces: geo.surfaces; hAt(x,y)->z; V(x,y,z)->Vector3; sunDir: world Vector3.
// Returns { meshes, waterUpdate }. waterUpdate(t) scrolls the ripples.
export function buildWater(surfaces, hAt, sunDir) {
  const meshes = [];
  const windRef = [];
  const mat = new THREE.MeshStandardMaterial({
    color: 0x21566e, roughness: 0.12, metalness: 0.0,
    envMapIntensity: 1.25, transparent: true, opacity: 0.9,
  });
  addWaterShader(mat, windRef, sunDir);

  for (const s of surfaces) {
    if (s.kind !== 'water' || !s.poly || s.poly.length < 3) continue;
    const shape = new THREE.Shape(s.poly.map(([x, y]) => new THREE.Vector2(x, -y)));
    const g2 = new THREE.ShapeGeometry(shape);
    g2.rotateX(-Math.PI / 2); // lay flat, y up
    let level = Infinity;
    for (const [x, y] of s.poly) level = Math.min(level, hAt(x, y));
    const m = new THREE.Mesh(g2, mat);
    m.position.y = level - 0.06;
    m.receiveShadow = true;
    meshes.push(m);
  }
  return { meshes, waterUpdate: (t) => { for (const u of windRef) u.value = t; } };
}
