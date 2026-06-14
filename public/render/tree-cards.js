// Real-time conifer built from foliage CARDS instead of a decimated film model.
// Poly Haven's fir is 6.7M geometric needle tris — decimating it to an instanceable
// budget collapses the needles into bare slivers. Instead we reuse the fir's own
// needle-sprig atlas (twig_diff + twig_alpha) on a small set of cross-fan cards
// arranged into a conical canopy over a tapered bark trunk. Lush, cheap to instance,
// and photoreal because the texture is the real fir foliage.
import * as THREE from 'three';
import { RENDER_CONFIG } from './config.js';
import { ASSETS } from './assets.js';

// Sprig sub-rects in the atlas (normalized, v from bottom). Each is one fir frond
// with its stem near vMin and the fan toward vMax — mapped stem->inner, tip->outer.
const SPRIGS = [
  { uMin: 0.18, uMax: 0.41, vMin: 0.71, vMax: 0.95 },
  { uMin: 0.66, uMax: 0.93, vMin: 0.66, vMax: 0.91 },
  { uMin: 0.32, uMax: 0.67, vMin: 0.19, vMax: 0.54 },
  { uMin: 0.62, uMax: 0.89, vMin: 0.20, vMax: 0.53 },
  { uMin: 0.48, uMax: 0.64, vMin: 0.58, vMax: 0.74 },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function tex(url, srgb) {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Build the merged foliage-card geometry for ONE reference tree (height H).
function foliageGeometry(H, rnd) {
  const pos = [], uv = [], nor = [], idx = [];
  const yBase = H * 0.18, yTop = H * 0.96;
  const rBottom = H * 0.26;
  const up = V3(0, 1, 0);
  let v = 0;
  const pushCard = (anchor, dir, across, L, W, sp, normal) => {
    const a0 = across.clone().multiplyScalar(-W / 2), a1 = across.clone().multiplyScalar(W / 2);
    const tip = dir.clone().multiplyScalar(L);
    const A = anchor.clone().add(a0), B = anchor.clone().add(a1);
    const C = anchor.clone().add(tip).add(a1), D = anchor.clone().add(tip).add(a0);
    for (const p of [A, B, C, D]) pos.push(p.x, p.y, p.z);
    uv.push(sp.uMin, sp.vMin, sp.uMax, sp.vMin, sp.uMax, sp.vMax, sp.uMin, sp.vMax);
    for (let k = 0; k < 4; k++) nor.push(normal.x, normal.y, normal.z);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
  };
  const nRings = 9;
  for (let i = 0; i < nRings; i++) {
    const t = i / (nRings - 1);
    const y = yBase + (yTop - yBase) * t;
    const r = rBottom * Math.pow(1 - t, 1.1) + 0.2;        // convex cone
    const count = Math.round(3 + (1 - t) * 7);
    for (let c = 0; c < count; c++) {
      const az = rnd() * Math.PI * 2;
      const ca = Math.cos(az), sa = Math.sin(az);
      const outward = V3(ca, 0, sa), tangent = V3(-sa, 0, ca);
      const anchor = V3(ca * 0.15, y + (rnd() - 0.5) * 0.3, sa * 0.15);
      const dir = outward.clone().add(V3(0, -0.32 - rnd() * 0.2, 0)).normalize(); // droop out+down
      const L = r * 1.5 + 0.6, W = L * (0.55 + rnd() * 0.2);
      const sp = SPRIGS[(rnd() * SPRIGS.length) | 0];
      const normal = outward.clone().multiplyScalar(0.3).add(up.clone().multiplyScalar(0.7)).normalize();
      pushCard(anchor, dir, tangent, L, W, sp, normal);                         // flat-ish branch
      const across2 = tangent.clone().add(up.clone().multiplyScalar(0.8)).normalize();
      pushCard(anchor, dir, across2, L, W * 0.9, sp, normal);                   // crossed for volume
    }
  }
  // a couple of upward apex sprigs
  for (let c = 0; c < 3; c++) {
    const az = rnd() * Math.PI * 2, ca = Math.cos(az), sa = Math.sin(az);
    const anchor = V3(0, yTop - 0.2, 0);
    const dir = V3(ca * 0.25, 1, sa * 0.25).normalize();
    const across = V3(-sa, 0, ca);
    const sp = SPRIGS[(rnd() * SPRIGS.length) | 0];
    pushCard(anchor, dir, across, 1.1, 0.7, sp, up.clone());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function addWind(material, windRef) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    windRef.push(shader.uniforms.uTime);
    const amp = (RENDER_CONFIG.windStrength || 0.5) * 0.03;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = float(gl_InstanceID) * 0.7;
          float h = max(transformed.y - 2.0, 0.0);
          float s = sin(uTime * 1.1 + ph) * 0.7 + sin(uTime * 2.3 + ph * 1.7) * 0.3;
          transformed.x += s * h * ${amp.toFixed(4)};
          transformed.z += cos(uTime * 0.9 + ph) * h * ${(amp * 0.7).toFixed(4)};
        }`);
  };
  material.customProgramCacheKey = () => 'tree-foliage-wind';
}

// spots: [{x,y,s}], hAt(x,y)->z, V: sim->three. Returns { meshes, windUpdate }.
export function buildCardTrees(spots, hAt, V) {
  if (!spots.length) return { meshes: [], windUpdate: () => {} };
  const H = 12.0;
  const rnd = rng(1771);

  const diff = tex(ASSETS.trees.foliageDiff, true);
  const alpha = tex(ASSETS.trees.foliageAlpha, false);
  const bark = tex(ASSETS.trees.bark, true);

  const foliageMat = new THREE.MeshStandardMaterial({
    map: diff, alphaMap: alpha, alphaTest: 0.42, side: THREE.DoubleSide,
    roughness: 0.92, metalness: 0, envMapIntensity: 0.5,
  });
  const windRef = [];
  addWind(foliageMat, windRef);

  const trunkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95, metalness: 0 });

  const fGeo = foliageGeometry(H, rnd);
  const tGeo = new THREE.CylinderGeometry(0.10, 0.34, H, 6, 1);
  tGeo.translate(0, H / 2, 0); // base at y=0

  const foliage = new THREE.InstancedMesh(fGeo, foliageMat, spots.length);
  const trunk = new THREE.InstancedMesh(tGeo, trunkMat, spots.length);
  foliage.castShadow = true; foliage.receiveShadow = true;
  trunk.castShadow = true; trunk.receiveShadow = true;
  // alpha-cutout shadows for the foliage cards
  foliage.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, map: diff, alphaMap: alpha, alphaTest: 0.42,
  });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
  const base = RENDER_CONFIG.treeScale || 0.95;
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    const h = hAt(sp.x, sp.y);
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    const s = base * (sp.s || 1);
    sc.set(s, s * (0.9 + rnd() * 0.25), s);
    m4.compose(V(sp.x, sp.y, h), q, sc);
    foliage.setMatrixAt(i, m4);
    trunk.setMatrixAt(i, m4);
  }
  foliage.instanceMatrix.needsUpdate = true;
  trunk.instanceMatrix.needsUpdate = true;

  return { meshes: [trunk, foliage], windUpdate: (t) => { for (const u of windRef) u.value = t; } };
}
