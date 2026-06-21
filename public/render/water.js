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
import { Reflector } from 'three/addons/objects/Reflector.js';
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

// Foam uniform declarations (only injected when the depth pre-pass is enabled).
const FOAM_COMMON = `
  uniform sampler2D uDepthTex; uniform vec2 uResolution;
  uniform float uCamNear, uCamFar, uFoamDepth; uniform vec3 uFoamColor;
  // perspectiveDepthToViewZ lives in three's <packing> chunk, which the standard
  // fragment shader does NOT include — so define it here. Returns negative view Z.
  float foamViewZ(float d, float n, float f) { return (n * f) / (d * (f - n) - f); }`;

function addWaterShader(material, windRef, sunDir, foam) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSunDir = { value: sunDir.clone().normalize() };
    shader.uniforms.uDeep = { value: new THREE.Color(0x123a4d) };
    shader.uniforms.uShallow = { value: new THREE.Color(0x7fb0cc) };
    shader.uniforms.uChop = { value: 0.8 };
    windRef.push(shader.uniforms.uTime);
    if (foam) {
      shader.uniforms.uDepthTex = { value: foam.depthTex };
      shader.uniforms.uResolution = { value: foam.resolution || new THREE.Vector2(1, 1) };
      shader.uniforms.uCamNear = { value: foam.near };
      shader.uniforms.uCamFar = { value: foam.far };
      shader.uniforms.uFoamColor = { value: new THREE.Color(0xeaf4f7) };
      shader.uniforms.uFoamDepth = { value: 10.0 }; // nearshore shallow band (m) — wide so it reads
      foam.u.push(shader.uniforms);
    }

    // --- vertex: carry world position for the wave field ---
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWorldPos;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    // body color (deep looking down -> sky-tinted at grazing) + moving sun glitter
    const specBlock = `
        {
          vec3 V = normalize(cameraPosition - vWorldPos);
          float fres = pow(clamp(1.0 - max(dot(V, gWaterWN), 0.0), 0.0, 1.0), 3.0);
          outgoingLight = mix(outgoingLight * 0.7 + uDeep * 0.4, outgoingLight + uShallow * 0.5, fres);
          vec3 H = normalize(uSunDir + V);
          float spc = pow(max(dot(gWaterWN, H), 0.0), 220.0);
          outgoingLight += vec3(1.0, 0.96, 0.86) * spc * 1.6;
        }`;
    // shoreline foam: whiten where terrain sits just under the surface. vViewPosition.z
    // is this fragment's positive eye depth (meshphysical sets vViewPosition=-mvPosition);
    // perspectiveDepthToViewZ (via <common>) linearizes the sampled scene depth.
    const foamBlock = foam ? `
        {
          vec2 sUv = gl_FragCoord.xy / uResolution;
          float sceneEye = -foamViewZ(texture2D(uDepthTex, sUv).x, uCamNear, uCamFar);
          float diff = sceneEye - vViewPosition.z;               // terrain depth below surface
          float foam = (1.0 - smoothstep(0.0, uFoamDepth, diff)) * step(0.0, diff);
          foam *= mix(0.65, 1.0, 0.5 + 0.5 * sin(vWorldPos.x * 1.7 + vWorldPos.z * 1.3 - uTime * 1.5));
          foam = clamp(foam, 0.0, 1.0);
          outgoingLight = mix(outgoingLight, uFoamColor, foam);
          diffuseColor.a = mix(diffuseColor.a, 1.0, foam * 0.6);
        }` : '';

    // --- fragment: ripple the normal (view space), then body + glitter + foam ---
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WATER_COMMON + (foam ? FOAM_COMMON : ''))
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        gWaterWN = rippleNormal(vWorldPos.xz, uTime);
        normal = normalize((viewMatrix * vec4(gWaterWN, 0.0)).xyz);`)
      .replace('#include <opaque_fragment>', specBlock + foamBlock + '\n        #include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => (foam ? 'water-anim-foam' : 'water-anim');
}

// surfaces: geo.surfaces; hAt(x,y)->z; sunDir: world Vector3; foamEnabled: bool.
// Returns { meshes, waterMeshes, waterUpdate, setFoamDepth }.
export function buildWater(surfaces, hAt, sunDir, foamEnabled) {
  const meshes = [];
  const windRef = [];
  const foam = foamEnabled ? { depthTex: null, resolution: null, near: 0.3, far: 12000, u: [] } : null;
  const reflect = RENDER_CONFIG.waterReflect;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x21566e, roughness: 0.12, metalness: 0.0,
    envMapIntensity: 1.25, transparent: true,
    opacity: reflect ? 0.58 : 0.9, // translucent so the planar reflection shows through
  });
  addWaterShader(mat, windRef, sunDir, foam);

  for (const s of surfaces) {
    if (s.kind !== 'water' || !s.poly || s.poly.length < 3) continue;
    const shape = new THREE.Shape(s.poly.map(([x, y]) => new THREE.Vector2(x, -y)));
    const g2 = new THREE.ShapeGeometry(shape);
    g2.rotateX(-Math.PI / 2); // lay flat, y up
    let level = Infinity;
    for (const [x, y] of s.poly) level = Math.min(level, hAt(x, y));
    // Per-pond planar reflection at the pond's own level, so trees/banks mirror in
    // the water. Frustum-culled, so only the in-view hole's pond(s) cost a scene
    // re-render (cheaper in practice than a single mis-levelled whole-course plane).
    // The animated water sits just above as a translucent ripple/tint/foam overlay.
    if (reflect) {
      const refl = new Reflector(g2.clone(), {
        textureWidth: 1024, textureHeight: 1024, color: 0x6f868f, clipBias: 0.01,
      });
      refl.position.y = level - 0.05;
      refl.renderOrder = -1;
      refl.userData.isWaterReflector = true; // for disposal on course reload
      meshes.push(refl);
    }
    const m = new THREE.Mesh(g2, mat);
    m.position.y = level - (reflect ? 0.035 : 0.06); // just above the reflector
    m.receiveShadow = true;
    meshes.push(m);
  }

  // Wire the depth texture/resolution after the helper exists. Called before the
  // first render, so onBeforeCompile reads these; the texture/Vector2 are shared
  // refs whose size/content the helper updates on resize, so this is set once.
  const setFoamDepth = (depthTex, resolution, near, far) => {
    if (!foam) return;
    foam.depthTex = depthTex; foam.resolution = resolution; foam.near = near; foam.far = far;
    for (const u of foam.u) { u.uDepthTex.value = depthTex; u.uResolution.value = resolution; u.uCamNear.value = near; u.uCamFar.value = far; }
  };
  return { meshes, waterMeshes: meshes, waterUpdate: (t) => { for (const u of windRef) u.value = t; }, setFoamDepth };
}
