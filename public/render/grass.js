// Instanced fescue/rough grass — tapered geometry blades (green base -> golden tip)
// scattered on the rough, with a vertex-shader wind. The wispy long grass that
// frames a hole. Geometry blades (no alpha texture), GPU-instanced.
import * as THREE from 'three';
import { RENDER_CONFIG } from './config.js';

function mul32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One blade: a tapered strip, base at y=0, 1 unit tall (scaled per instance).
// Vertex color runs base -> tip. Defaults = the golden fescue; opts let the
// fairway variant pass short-green colors, a wider base, and fewer segments.
function bladeGeometry(opts = {}) {
  const segs = opts.segs ?? 3, h = 1.0, baseW = opts.baseWidth ?? 0.024;
  const pos = [], col = [], idx = [];
  const base = new THREE.Color(opts.colorBase ?? 0x53703a), tip = new THREE.Color(opts.colorTip ?? 0xc2b06a), c = new THREE.Color();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, y = t * h, w = baseW * (1 - 0.85 * t);
    pos.push(-w, y, 0, w, y, 0);
    c.copy(base).lerp(tip, t * t);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Vertex-shader wind sway + optional camera-distance fade. The fade collapses each
// blade to zero size past a camera radius (length of its view-space origin), so a static
// instanced field reads as a camera-anchored FOREGROUND patch — blades exist only where
// they actually resolve at the orbit camera, and cost ~nothing (no fragments) elsewhere.
function addBladeShader(material, refs, opts = {}) {
  const wind = opts.wind !== false;
  const fade = opts.fade || null;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    refs.push(shader.uniforms.uTime);
    let header = '#include <common>\nuniform float uTime;';
    if (fade) { header += '\nuniform vec2 uFade;'; shader.uniforms.uFade = { value: new THREE.Vector2(fade.near, fade.far) }; }
    let body = '#include <begin_vertex>';
    if (fade) body += `
        {
          vec4 ivp = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float fk = 1.0 - smoothstep(uFade.x, uFade.y, length(ivp.xyz));
          transformed *= fk; // collapse blades past the fade radius -> camera-anchored foreground
        }`;
    if (wind) body += `
        {
          float ph = float(gl_InstanceID) * 0.613;
          float t = transformed.y; // 0..1 up the blade (post-fade scale)
          transformed.x += (sin(uTime * 1.6 + ph) * 0.10 + sin(uTime * 3.1 + ph * 1.7) * 0.04) * t;
          transformed.z += cos(uTime * 1.3 + ph) * 0.06 * t;
        }`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', header)
      .replace('#include <begin_vertex>', body);
  };
  material.customProgramCacheKey = () => `grass-${wind ? 'w' : ''}${fade ? 'f' : ''}`;
}

// spots: [{x,y,s}], hAt, V, opts. Returns { mesh, windUpdate }.
// opts (all optional, defaults = the rough fescue): {perTuft, height, baseWidth,
// segs, colorBase, colorTip, wind, jitter, seed}.
export function buildGrass(spots, hAt, V, opts = {}) {
  if (!spots.length) return { mesh: null, windUpdate: () => {} };
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide, roughness: 1.0, metalness: 0,
  });
  const refs = [];
  const wind = opts.wind !== false;
  const fade = opts.cameraFade || null;
  if (wind || fade) addBladeShader(mat, refs, { wind, fade });
  const PER = opts.perTuft ?? 12; // blades per tuft — a dense clump reads, a lone blade doesn't
  // Per-instance zone tint (opts.colorAt): bake a neutral base->tip BRIGHTNESS gradient into
  // the blade (dark base = the inter-blade micro-shadow the flat turf lacks, lit tip =
  // sun-catch) and let instanceColor carry each blade's surface-zone HUE, so the layer reads
  // matched to the turf underneath instead of a carpet glued on top.
  const tint = opts.colorAt || null;
  const geoOpts = tint
    ? { ...opts, colorBase: new THREE.Color(0.86, 0.86, 0.86), colorTip: new THREE.Color(1.12, 1.12, 1.12) }
    : opts;
  const mesh = new THREE.InstancedMesh(bladeGeometry(geoOpts), mat, spots.length * PER);
  mesh.castShadow = false;   // blade shadows are expensive + low value at this density
  mesh.receiveShadow = true;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), scaleVec = new THREE.Vector3();
  const rnd = mul32(opts.seed ?? 8081);
  const H = opts.height ?? RENDER_CONFIG.grassHeight;
  const jit = opts.jitter ?? 0.28;
  let bi = 0;
  for (const sp of spots) {
    for (let k = 0; k < PER; k++) {
      const x = sp.x + (rnd() - 0.5) * jit, y = sp.y + (rnd() - 0.5) * jit;
      const h = hAt(x, y);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      const sc = H * (0.6 + rnd() * 0.9) * (sp.s || 1);
      scaleVec.set(sc * (0.8 + rnd() * 0.5), sc, sc);
      m4.compose(V(x, y, h), q, scaleVec);
      mesh.setMatrixAt(bi, m4);
      if (tint) { const c = tint(x, y); if (c) mesh.setColorAt(bi, c); }
      bi++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, windUpdate: (t) => { for (const u of refs) u.value = t; } };
}
