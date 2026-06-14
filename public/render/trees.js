// Instanced photoreal trees from a decimated CC0 glTF model (Poly Haven fir).
// The model's sub-meshes are merged per material into instanceable geometries;
// foliage gets alpha-cutout + a vertex-shader wind. One model, GPU-instanced.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RENDER_CONFIG } from './config.js';
import { ASSETS } from './assets.js';

const loader = new GLTFLoader();
let _coniferProtos = null;

// deterministic PRNG so instance transforms are stable between loads
function mul32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Foliage wind: sway grows with height above the trunk base so the canopy moves
// and the base stays put. Per-instance phase from gl_InstanceID (WebGL2).
function addWind(material, windRef) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: RENDER_CONFIG.windStrength };
    windRef.push(shader.uniforms.uTime);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = float(gl_InstanceID) * 1.7;
          float up = max(transformed.y - 2.0, 0.0);
          transformed.x += (sin(uTime * 1.1 + ph) * 0.05 + sin(uTime * 2.3 + ph * 1.7) * 0.025) * uWind * up;
          transformed.z += cos(uTime * 0.9 + ph) * 0.04 * uWind * up;
        }`);
  };
  material.customProgramCacheKey = () => 'tree-wind';
}

// Load a tree glb -> [{ geom, material, foliage }] merged per material.
// Sub-mesh local transforms are baked in; non-essential attributes are dropped
// so same-material primitives merge cleanly.
async function loadProtos(url) {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const byMat = new Map();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const a of Object.keys(g.attributes)) {
      if (a !== 'position' && a !== 'normal' && a !== 'uv') g.deleteAttribute(a);
    }
    g.morphAttributes = {};
    const list = byMat.get(o.material) || [];
    list.push(g);
    byMat.set(o.material, list);
  });
  const protos = [];
  for (const [mat, geoms] of byMat) {
    const geom = geoms.length > 1 ? mergeGeometries(geoms) : geoms[0];
    const foliage = /twig|leaf|leaves|needle/i.test(mat.name || '');
    protos.push({ geom, material: mat, foliage });
  }
  return protos;
}

function prepMaterial(srcMat, foliage, windRef) {
  const m = srcMat.clone();
  m.vertexColors = false; // dropped the color attribute during merge
  if (foliage) {
    m.transparent = false;
    m.alphaTest = 0.5;       // cutout, not blend (sorts + casts shadows cleanly)
    m.side = THREE.DoubleSide;
    m.depthWrite = true;
    addWind(m, windRef);
  }
  return m;
}

async function getConiferProtos() {
  if (!_coniferProtos) _coniferProtos = await loadProtos(ASSETS.trees.conifer);
  return _coniferProtos;
}

// spots: [{x,y,s}], hAt(x,y)->z, V(x,y,z)->THREE.Vector3.
// Returns { meshes: InstancedMesh[], windUpdate(t) }. Async (loads the model).
export async function buildTrees(spots, hAt, V) {
  if (!spots.length) return { meshes: [], windUpdate: () => {} };
  const protos = await getConiferProtos();
  const windRef = [];
  const insts = protos.map((p) => {
    const im = new THREE.InstancedMesh(p.geom, prepMaterial(p.material, p.foliage, windRef), spots.length);
    im.castShadow = true; im.receiveShadow = true;
    if (p.foliage) {
      im.customDepthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking, map: p.material.map, alphaTest: 0.5,
      });
    }
    return im;
  });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), upv = new THREE.Vector3(0, 1, 0);
  const rnd = mul32(1234);
  const base = RENDER_CONFIG.treeScale;
  spots.forEach((sp, i) => {
    const h = hAt(sp.x, sp.y);
    q.setFromAxisAngle(upv, rnd() * Math.PI * 2);
    const sc = sp.s * base;
    m4.compose(V(sp.x, sp.y, h), q, new THREE.Vector3(sc, sc * (0.9 + rnd() * 0.25), sc));
    for (const im of insts) im.setMatrixAt(i, m4);
  });
  for (const im of insts) im.instanceMatrix.needsUpdate = true;

  return { meshes: insts, windUpdate: (t) => { for (const u of windRef) u.value = t; } };
}
