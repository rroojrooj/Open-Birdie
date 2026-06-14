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

// One blade: a tapered 3-segment strip, base at y=0, ~1 unit tall (scaled per
// instance). Vertex color runs green base -> golden tip (fescue).
function bladeGeometry() {
  const segs = 3, h = 1.0, baseW = 0.024;
  const pos = [], col = [], idx = [];
  const base = new THREE.Color(0x53703a), tip = new THREE.Color(0xc2b06a), c = new THREE.Color();
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

function addWind(material, windRef) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    windRef.push(shader.uniforms.uTime);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = float(gl_InstanceID) * 0.613;
          float t = transformed.y; // 0..1 up the blade (pre-scale)
          transformed.x += (sin(uTime * 1.6 + ph) * 0.10 + sin(uTime * 3.1 + ph * 1.7) * 0.04) * t;
          transformed.z += cos(uTime * 1.3 + ph) * 0.06 * t;
        }`);
  };
  material.customProgramCacheKey = () => 'grass-wind';
}

// spots: [{x,y,s}], hAt, V. Returns { mesh, windUpdate }.
export function buildGrass(spots, hAt, V) {
  if (!spots.length) return { mesh: null, windUpdate: () => {} };
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide, roughness: 1.0, metalness: 0,
  });
  const windRef = [];
  addWind(mat, windRef);
  const PER = 12; // blades per tuft — a dense clump reads, a lone blade doesn't
  const mesh = new THREE.InstancedMesh(bladeGeometry(), mat, spots.length * PER);
  mesh.castShadow = false;   // blade shadows are expensive + low value at this density
  mesh.receiveShadow = true;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), scaleVec = new THREE.Vector3();
  const rnd = mul32(8081);
  const H = RENDER_CONFIG.grassHeight;
  let bi = 0;
  for (const sp of spots) {
    for (let k = 0; k < PER; k++) {
      const x = sp.x + (rnd() - 0.5) * 0.28, y = sp.y + (rnd() - 0.5) * 0.28;
      const h = hAt(x, y);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      const sc = H * (0.6 + rnd() * 0.9) * (sp.s || 1);
      scaleVec.set(sc * (0.8 + rnd() * 0.5), sc, sc);
      m4.compose(V(x, y, h), q, scaleVec);
      mesh.setMatrixAt(bi++, m4);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { mesh, windUpdate: (t) => { for (const u of windRef) u.value = t; } };
}
