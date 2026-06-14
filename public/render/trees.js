import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { speciesFor, canopyDims } from './tree-util.js';
import { RENDER_CONFIG } from './config.js';
import { ASSETS } from './assets.js';

const texLoader = new THREE.TextureLoader();
function loadTex(url, srgb) {
  const t = texLoader.load(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

// local deterministic PRNG so the scattered canopy is stable between loads
function mul32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A dense crown built by scattering many foliage cards through the canopy volume
// (a single twig/leaf card alone reads as a sparse sprig). Cards are fixed (not
// billboards) so the crown holds shape under the orbit camera. Cone-ish volume
// for conifer, rounded blob for deciduous.
function canopyGeometry(species) {
  const d = canopyDims(species);
  const conifer = species === 'conifer';
  const rnd = mul32(conifer ? 11 : 22);
  const cards = conifer ? 22 : 16;
  const geos = [];
  for (let i = 0; i < cards; i++) {
    const t = i / (cards - 1);                       // 0 = base, 1 = top
    const cw = d.width * (conifer ? (0.85 - 0.5 * t) : (0.5 + rnd() * 0.3));
    const ch = (conifer ? d.height * 0.32 : d.height * 0.5) * (0.8 + rnd() * 0.4);
    const p = new THREE.PlaneGeometry(cw, ch);
    p.rotateZ((rnd() - 0.5) * 0.5);
    p.rotateX((rnd() - 0.5) * 0.5);
    p.rotateY(rnd() * Math.PI * 2);
    const maxR = conifer ? d.width * 0.5 * (1 - t) : d.width * 0.42;
    const ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * maxR;
    const yy = conifer
      ? (d.yCenter - d.height * 0.45) + t * d.height * 0.9
      : d.yCenter + (rnd() - 0.5) * d.height * 0.7;
    p.translate(Math.cos(ang) * rad, yy, Math.sin(ang) * rad);
    geos.push(p);
  }
  return mergeGeometries(geos);
}

// Vertex-shader wind: sway grows with height above the canopy base so the top
// moves and the join to the trunk stays put. Injected via onBeforeCompile so the
// material keeps env/IBL/shadow/fog.
function addWind(material, windRef) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: RENDER_CONFIG.windStrength };
    windRef.push(shader.uniforms.uTime);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = float(gl_InstanceID) * 1.7;
          float sway = sin(uTime * 1.1 + ph) * 0.06 + sin(uTime * 2.3 + ph * 1.7) * 0.03;
          float up = max(transformed.y - 1.5, 0.0);
          transformed.x += sway * uWind * up;
          transformed.z += cos(uTime * 0.9 + ph) * 0.04 * uWind * up;
        }`);
  };
  material.customProgramCacheKey = () => 'foliage-wind';
  return material;
}

function speciesMaterial(species) {
  let map, alphaMap = null;
  if (species === 'conifer') {
    map = loadTex(ASSETS.foliage.coniferDiff, true);
    alphaMap = loadTex(ASSETS.foliage.coniferAlpha, false);
  } else {
    map = loadTex(ASSETS.foliage.deciduousDiff, true); // RGBA, alpha embedded
  }
  return new THREE.MeshStandardMaterial({
    map, alphaMap, alphaTest: 0.45, side: THREE.DoubleSide,
    roughness: 0.9, metalness: 0, transparent: false,
  });
}

// Cutout shadow so the canopy casts foliage-shaped shadows, not solid boxes.
function depthMaterial(map, alphaMap) {
  return new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map, alphaMap, alphaTest: 0.45,
  });
}

// spots: [{x,y,s}], hAt(x,y)->z, V(x,y,z)->THREE.Vector3, rnd()->[0,1)
// Returns { meshes: Mesh[], windUpdate(t) }.
export function buildTrees(spots, hAt, V, rnd) {
  const groups = { conifer: [], deciduous: [] };
  spots.forEach((sp, i) => groups[speciesFor(i)].push(sp));

  const meshes = [];
  const windRef = [];

  // shared trunk for all trees (thin so the canopy dominates, not the pole)
  const trunkGeom = new THREE.CylinderGeometry(0.11, 0.22, 3.2, 6);
  trunkGeom.translate(0, 1.6, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3f28, roughness: 0.95 });
  const trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, spots.length);
  trunks.castShadow = true; trunks.receiveShadow = true;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  let ti = 0;

  for (const species of ['conifer', 'deciduous']) {
    const list = groups[species];
    if (!list.length) continue;
    const geom = canopyGeometry(species);
    const mat = addWind(speciesMaterial(species), windRef);
    const canopies = new THREE.InstancedMesh(geom, mat, list.length);
    canopies.castShadow = true; canopies.receiveShadow = true;
    canopies.customDepthMaterial = depthMaterial(mat.map, mat.alphaMap);

    list.forEach((sp, j) => {
      const h = hAt(sp.x, sp.y);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      m4.compose(V(sp.x, sp.y, h), q, new THREE.Vector3(sp.s, sp.s * (0.9 + rnd() * 0.3), sp.s));
      canopies.setMatrixAt(j, m4);
      trunks.setMatrixAt(ti++, m4);
      col.setHSL(0.27 + rnd() * 0.06, 0.4 + rnd() * 0.18, 0.42 + rnd() * 0.12);
      canopies.setColorAt(j, col);
    });
    canopies.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    meshes.push(canopies);
  }
  trunks.instanceMatrix.needsUpdate = true;
  meshes.push(trunks);

  return { meshes, windUpdate: (t) => { for (const u of windRef) u.value = t; } };
}
