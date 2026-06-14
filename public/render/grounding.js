// Contact-shadow "decal" blobs that ground the trees. GTAO can't be used here
// (its normal pre-pass recompiles our onBeforeCompile materials without vMapUv),
// and the terrain is too coarse for baked vertex AO — so we drape a soft radial
// dark quad on the turf under each trunk. One instanced, unlit, depth-write-off,
// non-shadowing mesh: a single draw call that fills the ambient-occlusion gap the
// directional sun shadow leaves at the base.
import * as THREE from 'three';
import { RENDER_CONFIG } from './config.js';

function blobTexture() {
  const s = 128, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.30)');
  g.addColorStop(1.0, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

// treeSpots: [{x,y,s}], hAt(x,y)->z, V: sim->three. Returns { meshes }.
export function buildGrounding(treeSpots, hAt, V) {
  if (!treeSpots.length) return { meshes: [] };
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2); // lie flat, y up
  const mat = new THREE.MeshBasicMaterial({
    map: blobTexture(), transparent: true, opacity: 1, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, treeSpots.length);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1; // draw after opaque turf/grass, before nothing critical

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
  const base = RENDER_CONFIG.treeScale || 1.0;
  for (let i = 0; i < treeSpots.length; i++) {
    const sp = treeSpots[i];
    const h = hAt(sp.x, sp.y);
    q.setFromAxisAngle(up, (i * 1.3) % (Math.PI * 2)); // vary so blobs don't share a seam
    const d = base * (sp.s || 1) * 5.0; // contact-shadow diameter (m)
    sc.set(d, 1, d);
    m4.compose(V(sp.x, sp.y, h + 0.05), q, sc); // small lift above turf
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { meshes: [mesh] };
}
