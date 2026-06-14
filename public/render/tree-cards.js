// Real-time trees built from foliage CARDS instead of decimated film models.
// Poly Haven trees model foliage as millions of geometric needle/leaf tris that
// collapse into bare slivers when decimated to an instanceable budget. Instead we
// reuse each model's own foliage-sprig ATLAS (color + alpha cutout) on a small set
// of cross-fan cards arranged into a canopy over a tapered bark trunk. Lush, cheap,
// and photoreal. Two species: a conifer (cone of vertical fir sprigs) and a
// broadleaf (rounded canopy of horizontal jacaranda fronds), mixed per stand.
import * as THREE from 'three';
import { RENDER_CONFIG } from './config.js';
import { ASSETS } from './assets.js';

// Sprig sub-rects in each atlas (normalized, v from bottom). Conifer sprigs run
// stem(vMin) -> tip(vMax) vertically; jacaranda fronds run stem(uMin) -> tip(uMax)
// horizontally (flagged `horiz`), so the card maps stem->inner either way.
const SPRIGS_CONIFER = [
  { uMin: 0.18, uMax: 0.41, vMin: 0.71, vMax: 0.95 },
  { uMin: 0.66, uMax: 0.93, vMin: 0.66, vMax: 0.91 },
  { uMin: 0.32, uMax: 0.67, vMin: 0.19, vMax: 0.54 },
  { uMin: 0.62, uMax: 0.89, vMin: 0.20, vMax: 0.53 },
  { uMin: 0.48, uMax: 0.64, vMin: 0.58, vMax: 0.74 },
];
const SPRIGS_BROADLEAF = [
  { uMin: 0.16, uMax: 0.96, vMin: 0.58, vMax: 0.97, horiz: true },
  { uMin: 0.02, uMax: 0.42, vMin: 0.34, vMax: 0.67, horiz: true },
  { uMin: 0.30, uMax: 0.95, vMin: 0.05, vMax: 0.42, horiz: true },
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

// Push one quad (card) into the accumulator. anchor=inner edge, extends `dir`*L
// outward, `across`*W wide; sprig stem->inner, tip->outer.
function pushCard(acc, anchor, dir, across, L, W, sp, normal) {
  const a0 = across.clone().multiplyScalar(-W / 2), a1 = across.clone().multiplyScalar(W / 2);
  const tip = dir.clone().multiplyScalar(L);
  const A = anchor.clone().add(a0), B = anchor.clone().add(a1);
  const C = anchor.clone().add(tip).add(a1), D = anchor.clone().add(tip).add(a0);
  for (const p of [A, B, C, D]) acc.pos.push(p.x, p.y, p.z);
  if (sp.horiz) acc.uv.push(sp.uMin, sp.vMin, sp.uMin, sp.vMax, sp.uMax, sp.vMax, sp.uMax, sp.vMin);
  else acc.uv.push(sp.uMin, sp.vMin, sp.uMax, sp.vMin, sp.uMax, sp.vMax, sp.uMin, sp.vMax);
  for (let k = 0; k < 4; k++) acc.nor.push(normal.x, normal.y, normal.z);
  const v = acc.v; acc.idx.push(v, v + 1, v + 2, v, v + 2, v + 3); acc.v += 4;
}

function finalize(acc) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
  g.setIndex(acc.idx);
  return g;
}

// Conifer: dense conical canopy with a wide low skirt; sprigs fan out + droop.
function coniferGeometry(H, rnd) {
  const acc = { pos: [], uv: [], nor: [], idx: [], v: 0 };
  const up = V3(0, 1, 0);
  const yBase = H * 0.08, yTop = H * 0.97, rBottom = H * 0.40;
  const nRings = 14;
  for (let i = 0; i < nRings; i++) {
    const t = i / (nRings - 1);
    const y = yBase + (yTop - yBase) * t;
    const r = rBottom * Math.pow(1 - t, 0.78) + 0.25;
    const count = Math.round(7 + (1 - t) * 14);
    for (let c = 0; c < count; c++) {
      const az = rnd() * Math.PI * 2 + i * 0.5;
      const ca = Math.cos(az), sa = Math.sin(az);
      const outward = V3(ca, 0, sa), tangent = V3(-sa, 0, ca);
      const anchor = V3(ca * 0.12, y + (rnd() - 0.5) * 0.45, sa * 0.12);
      const dir = outward.clone().add(V3(0, -0.18 - rnd() * 0.18, 0)).normalize();
      const L = r * 0.95 + 0.7, W = L * (0.6 + rnd() * 0.25);
      const sp = SPRIGS_CONIFER[(rnd() * SPRIGS_CONIFER.length) | 0];
      const normal = outward.clone().multiplyScalar(0.3).add(up.clone().multiplyScalar(0.7)).normalize();
      pushCard(acc, anchor, dir, tangent, L, W, sp, normal);
      const across2 = tangent.clone().add(up.clone().multiplyScalar(0.85)).normalize();
      pushCard(acc, anchor, dir, across2, L, W * 0.9, sp, normal);
    }
  }
  for (let c = 0; c < 6; c++) {
    const az = rnd() * Math.PI * 2, ca = Math.cos(az), sa = Math.sin(az);
    const anchor = V3(ca * 0.2, yTop - 0.3 - rnd() * 0.6, sa * 0.2);
    const dir = V3(ca * 0.35, 1, sa * 0.35).normalize();
    pushCard(acc, anchor, dir, V3(-sa, 0, ca), 1.3, 0.8, SPRIGS_CONIFER[(rnd() * SPRIGS_CONIFER.length) | 0], up.clone());
  }
  return finalize(acc);
}

// Broadleaf: rounded, spreading canopy on the top ~half; big fronds face outward.
function broadleafGeometry(H, rnd) {
  const acc = { pos: [], uv: [], nor: [], idx: [], v: 0 };
  const up = V3(0, 1, 0);
  const cy = H * 0.74, ry = H * 0.30, rxz = H * 0.48; // canopy ellipsoid
  const N = 160;
  for (let i = 0; i < N; i++) {
    const th = rnd() * Math.PI * 2, z = 2 * rnd() - 1, r2 = Math.sqrt(Math.max(0, 1 - z * z));
    const ds = V3(r2 * Math.cos(th), z, r2 * Math.sin(th)); // unit sphere dir
    const outward = V3(ds.x, ds.y * 0.55, ds.z); // flatten vertical a touch
    if (outward.lengthSq() < 1e-4) outward.set(1, 0, 0);
    outward.normalize();
    const rad = 0.5 + 0.5 * Math.cbrt(rnd()); // fill interior
    const inner = V3(ds.x * rxz * rad * 0.4, cy + ds.y * ry * rad * 0.4, ds.z * rxz * rad * 0.4);
    const across = V3(-outward.z, 0, outward.x).normalize();
    const L = (rxz * 0.55 + 1.4) * (0.8 + rnd() * 0.4), W = L * (0.75 + rnd() * 0.3);
    const sp = SPRIGS_BROADLEAF[(rnd() * SPRIGS_BROADLEAF.length) | 0];
    const normal = up.clone().multiplyScalar(0.55).add(outward.clone().multiplyScalar(0.45)).normalize();
    pushCard(acc, inner, outward, across, L, W, sp, normal);
    const across2 = across.clone().add(up.clone().multiplyScalar(0.6)).normalize();
    pushCard(acc, inner, outward, across2, L, W * 0.9, sp, normal);
  }
  return finalize(acc);
}

function addFoliageShader(material, windRef, canopyTop) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    windRef.push(shader.uniforms.uTime);
    shader.uniforms.uCanopyTop = { value: canopyTop };
    const amp = (RENDER_CONFIG.windStrength || 0.5) * 0.03;
    // vertex: wind sway + a normalized canopy-height varying for volume shading
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uCanopyTop;\nvarying float vCanopyT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCanopyT = clamp(transformed.y / uCanopyTop, 0.0, 1.0);
        {
          float ph = float(gl_InstanceID) * 0.7;
          float h = max(transformed.y - 2.0, 0.0);
          float s = sin(uTime * 1.1 + ph) * 0.7 + sin(uTime * 2.3 + ph * 1.7) * 0.3;
          transformed.x += s * h * ${amp.toFixed(4)};
          transformed.z += cos(uTime * 0.9 + ph) * h * ${(amp * 0.7).toFixed(4)};
        }`);
    // fragment: fake canopy volume — dark/cool core+underside, bright/warm sunlit top.
    // The single biggest "video-game tree" fix; no sun/normal math needed.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCanopyT;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float ao = mix(0.5, 1.08, vCanopyT);
          vec3 tone = mix(vec3(0.86, 0.95, 0.88), vec3(1.06, 1.05, 0.90), vCanopyT);
          diffuseColor.rgb *= ao * tone;
        }`);
  };
  material.customProgramCacheKey = () => 'tree-foliage-shaded';
}

const SPECIES = {
  conifer: { geom: coniferGeometry, H: 12, trunk: [0.10, 0.34], key: 'conifer',
    diff: () => ASSETS.trees.foliageDiff, alpha: () => ASSETS.trees.foliageAlpha, bark: () => ASSETS.trees.bark, alphaTest: 0.42 },
  broadleaf: { geom: broadleafGeometry, H: 10, trunk: [0.16, 0.46], key: 'broadleaf',
    diff: () => ASSETS.trees.broadleafDiff, alpha: () => ASSETS.trees.broadleafAlpha, bark: () => ASSETS.trees.broadleafBark, alphaTest: 0.38 },
};

// Build trunk+foliage InstancedMeshes for one species over its spots.
function buildSpecies(spots, hAt, V, sp, windRef) {
  const rnd = rng(sp.key === 'conifer' ? 1771 : 5519);
  const diff = tex(sp.diff(), true), alpha = tex(sp.alpha(), false), bark = tex(sp.bark(), true);
  const foliageMat = new THREE.MeshStandardMaterial({
    map: diff, alphaMap: alpha, alphaTest: sp.alphaTest, side: THREE.DoubleSide,
    roughness: 0.92, metalness: 0, envMapIntensity: 0.5,
  });
  addFoliageShader(foliageMat, windRef, sp.H);
  const trunkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95, metalness: 0 });

  const fGeo = sp.geom(sp.H, rnd);
  const tGeo = new THREE.CylinderGeometry(sp.trunk[0], sp.trunk[1], sp.H, 6, 1);
  tGeo.translate(0, sp.H / 2, 0);

  const foliage = new THREE.InstancedMesh(fGeo, foliageMat, spots.length);
  const trunk = new THREE.InstancedMesh(tGeo, trunkMat, spots.length);
  foliage.castShadow = foliage.receiveShadow = true;
  trunk.castShadow = trunk.receiveShadow = true;
  foliage.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, map: diff, alphaMap: alpha, alphaTest: sp.alphaTest,
  });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), scv = new THREE.Vector3(), col = new THREE.Color();
  const base = RENDER_CONFIG.treeScale || 1.0;
  for (let i = 0; i < spots.length; i++) {
    const s0 = spots[i], h = hAt(s0.x, s0.y);
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    const s = base * (s0.s || 1);
    const w = s * (0.82 + rnd() * 0.42), ht = s * (0.92 + rnd() * 0.5);
    scv.set(w, ht, w);
    m4.compose(V(s0.x, s0.y, h), q, scv);
    foliage.setMatrixAt(i, m4); trunk.setMatrixAt(i, m4);
    const b = 0.72 + rnd() * 0.5;
    col.setRGB(b * (0.92 + rnd() * 0.12), b, b * (0.82 + rnd() * 0.12));
    foliage.setColorAt(i, col);
  }
  foliage.instanceMatrix.needsUpdate = true;
  trunk.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  return [trunk, foliage];
}

// spots: [{x,y,s}], hAt(x,y)->z, V: sim->three. ~30% of stands are broadleaf for
// an Augusta-style mixed tree line. Returns { meshes, windUpdate }.
export function buildCardTrees(spots, hAt, V) {
  if (!spots.length) return { meshes: [], windUpdate: () => {} };
  const conifer = [], broadleaf = [];
  for (let i = 0; i < spots.length; i++) ((i % 10) < 3 ? broadleaf : conifer).push(spots[i]);
  const windRef = [], meshes = [];
  if (conifer.length) meshes.push(...buildSpecies(conifer, hAt, V, SPECIES.conifer, windRef));
  if (broadleaf.length) meshes.push(...buildSpecies(broadleaf, hAt, V, SPECIES.broadleaf, windRef));
  return { meshes, windUpdate: (t) => { for (const u of windRef) u.value = t; } };
}
