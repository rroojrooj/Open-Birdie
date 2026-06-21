// Ground vegetation that frames a hole: a warm pine-straw litter mat under the
// trees (the reddish-brown carpet you find under pines) and azalea-style flower
// clusters at the green surrounds + tree lines. Both are GPU-instanced single
// draw calls with procedurally-drawn textures (no asset files), lit by the scene
// so they sit in the same light as everything else.
import * as THREE from 'three';
import { RENDER_CONFIG } from './config.js';

// Pine-straw mat: a faint continuous brown disc (densest at the trunk, fading to
// nothing at the rim so it feathers into turf) with many short needle strokes on
// top for litter detail. The transparent gaps let blades of turf show through.
function strawTexture() {
  const s = 256, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  const base = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  base.addColorStop(0.0, 'rgba(124,78,40,0.74)');
  base.addColorStop(0.6, 'rgba(110,66,34,0.52)');
  base.addColorStop(1.0, 'rgba(110,66,34,0.0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  const cols = ['#7a4a26', '#8c5a30', '#6b3f22', '#9c6a3c', '#5e3a20'];
  for (let i = 0; i < 1500; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.pow(Math.random(), 0.6) * (s * 0.5);
    const a = 1 - rad / (s * 0.5); // fade strokes at the rim too
    if (a <= 0) continue;
    const cx = s / 2 + Math.cos(ang) * rad, cy = s / 2 + Math.sin(ang) * rad;
    const len = 6 + Math.random() * 12, dir = Math.random() * Math.PI * 2;
    ctx.strokeStyle = cols[(Math.random() * cols.length) | 0];
    ctx.globalAlpha = 0.5 * a * (0.6 + Math.random() * 0.4);
    ctx.lineWidth = 1 + Math.random() * 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(dir) * len, cy + Math.sin(dir) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  return t;
}

// treeSpots: [{x,y,s}] (on-course trees only — not the horizon band), hAt, V.
// One flat straw mat per trunk; overlapping mats in a wooded clump read as a
// continuous carpet, an isolated fairway tree gets a tidy mulch ring.
export function buildPineStraw(treeSpots, hAt, V) {
  if (!treeSpots.length) return { meshes: [] };
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2); // lie flat, y up
  const mat = new THREE.MeshStandardMaterial({
    map: strawTexture(), transparent: true, roughness: 1.0, metalness: 0,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, treeSpots.length);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2; // after the grounding contact-shadow (renderOrder 1)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
  const base = RENDER_CONFIG.treeScale || 1.0;
  for (let i = 0; i < treeSpots.length; i++) {
    const sp = treeSpots[i];
    const h = hAt(sp.x, sp.y);
    q.setFromAxisAngle(up, (i * 2.39996) % (Math.PI * 2)); // golden-angle spin, no shared seam
    const d = base * (sp.s || 1) * (4.0 + (i % 3)); // 4-6m, varied so rings don't tile
    sc.set(d, 1, d);
    m4.compose(V(sp.x, sp.y, h + 0.06), q, sc); // just above the contact-shadow decal
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { meshes: [mesh] };
}
