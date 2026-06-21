// Course props: small human-scale objects that say "maintained golf course".
// For now: a bunker rake lying in each sand bunker — the iconic detail that
// grounds the bunkers at human scale. One instanced, shadow-casting draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A rake lying along +x: a thin handle (0..1.5m) with a wider toothed head at
// the far end. Merged to one geometry so the whole fleet is a single draw call.
function rakeGeometry() {
  const handle = new THREE.BoxGeometry(1.5, 0.05, 0.05); handle.translate(0.75, 0, 0);
  const neck = new THREE.BoxGeometry(0.14, 0.05, 0.08); neck.translate(1.5, 0, 0);
  const head = new THREE.BoxGeometry(0.11, 0.07, 0.6); head.translate(1.58, 0, 0);
  return mergeGeometries([handle, neck, head]);
}

// bunkerSurfaces: [{kind:'bunker', poly:[[x,y]..]}], hAt(x,y)->z, V: sim->three.
// One rake per bunker, laid flat just inside the rim. Returns { meshes }.
export function buildRakes(bunkerSurfaces, hAt, V) {
  const spots = [];
  for (const s of bunkerSurfaces) {
    if (!s.poly || s.poly.length < 3) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of s.poly) { cx += x; cy += y; }
    cx /= s.poly.length; cy /= s.poly.length;
    // a point ~60% from the centroid toward one rim vertex -> sits just inside the sand
    const v = s.poly[(s.poly.length * 0.37) | 0];
    spots.push({ x: cx + (v[0] - cx) * 0.6, y: cy + (v[1] - cy) * 0.6 });
  }
  if (!spots.length) return { meshes: [] };
  const geo = rakeGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc6a268, roughness: 0.7, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  mesh.castShadow = true;   // a small cast shadow grounds the rake on the sand
  mesh.receiveShadow = false;
  mesh.userData.isRakes = true; // probe/debug hook
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    const h = hAt(sp.x, sp.y);
    q.setFromAxisAngle(up, (i * 2.39996) % (Math.PI * 2)); // varied heading per bunker
    m4.compose(V(sp.x, sp.y, h + 0.04), q, sc); // just above the sand surface
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { meshes: [mesh] };
}
