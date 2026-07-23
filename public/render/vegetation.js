// Ground vegetation that frames a hole: a warm pine-straw litter mat under the
// trees (the reddish-brown carpet you find under pines) and azalea-style flower
// clusters at the green surrounds + tree lines. Both are GPU-instanced single
// draw calls with procedurally-drawn textures (no asset files), lit by the scene
// so they sit in the same light as everything else.
import * as THREE from 'three';
import { RENDER_CONFIG } from './config.js';

export function deterministicRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function vegetationTextureCommands(kind) {
  if (kind === 'straw') {
    const rnd = deterministicRandom(0x51a7);
    const s = 256;
    const cols = ['#7a4a26', '#8c5a30', '#6b3f22', '#9c6a3c', '#5e3a20'];
    const commands = [];
    for (let i = 0; i < 1500; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = Math.pow(rnd(), 0.6) * (s * 0.5);
      const a = 1 - rad / (s * 0.5);
      if (a <= 0) continue;
      const cx = s / 2 + Math.cos(ang) * rad, cy = s / 2 + Math.sin(ang) * rad;
      const len = 6 + rnd() * 12, dir = rnd() * Math.PI * 2;
      commands.push({
        cx, cy,
        x2: cx + Math.cos(dir) * len,
        y2: cy + Math.sin(dir) * len,
        color: cols[(rnd() * cols.length) | 0],
        alpha: 0.5 * a * (0.6 + rnd() * 0.4),
        lineWidth: 1 + rnd() * 1.4,
      });
    }
    return commands;
  }
  if (kind === 'flower') {
    const rnd = deterministicRandom(0xf10a);
    const s = 128;
    const commands = [];
    for (let i = 0; i < 46; i++) {
      const ang = rnd() * Math.PI * 2, rad = Math.pow(rnd(), 0.5) * s * 0.42;
      commands.push({
        kind: 'blossom',
        cx: s / 2 + Math.cos(ang) * rad,
        cy: s * 0.55 + Math.sin(ang) * rad * 0.8,
        radius: 4 + rnd() * 7,
      });
    }
    for (let i = 0; i < 10; i++) {
      commands.push({
        kind: 'leaf-gap',
        cx: rnd() * s,
        cy: s * 0.5 + rnd() * s * 0.45,
        radius: 3 + rnd() * 5,
      });
    }
    return commands;
  }
  throw new RangeError(`Unknown vegetation texture kind: ${kind}`);
}

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
  for (const command of vegetationTextureCommands('straw')) {
    ctx.strokeStyle = command.color;
    ctx.globalAlpha = command.alpha;
    ctx.lineWidth = command.lineWidth;
    ctx.beginPath();
    ctx.moveTo(command.cx, command.cy);
    ctx.lineTo(command.x2, command.y2);
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

// --- azalea-style flowering bushes ----------------------------------------

// A bushy blob of white blossoms (tinted per-instance to the azalea color) with
// a few dark leaf gaps, on a transparent ground. Alpha-tested, so no sorting.
function flowerTexture() {
  const s = 128, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  for (const command of vegetationTextureCommands('flower')) {
    if (command.kind === 'blossom') {
      const g = ctx.createRadialGradient(command.cx, command.cy, 0, command.cx, command.cy, command.radius);
      g.addColorStop(0.0, 'rgba(255,255,255,1)');
      g.addColorStop(0.6, 'rgba(255,250,252,0.95)');
      g.addColorStop(1.0, 'rgba(255,240,245,0)');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = 'rgba(40,70,38,0.55)';
    }
    ctx.beginPath(); ctx.arc(command.cx, command.cy, command.radius, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  return t;
}

// Two crossed vertical quads -> a billboard that reads as a bush from any angle.
function bushGeometry() {
  const w = 0.75, h = 1.15;
  const quads = [
    [[-w, 0, 0], [w, 0, 0], [w, h, 0], [-w, h, 0]],
    [[0, 0, -w], [0, 0, w], [0, h, w], [0, h, -w]],
  ];
  const pos = [], uv = [], idx = [];
  let v = 0;
  for (const q of quads) {
    for (const p of q) pos.push(p[0], p[1], p[2]);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Augusta-ish azalea palette: vivid hot-pink/magenta/red dominate so the beds
// read as colour at distance (pale blossoms just pick up the bluish aerial fog);
// one near-white kept for variety.
const AZALEA = [0xe24b8a, 0xc4327a, 0xd83a5a, 0xe8629c, 0xf07ab0, 0xf2dfe6];

// spots: [{x,y,s}], hAt, V. One instanced mesh of crossed-quad bushes, each
// tinted to a random azalea color. Returns { meshes }.
export function buildFlowers(spots, hAt, V) {
  if (!spots.length) return { meshes: [] };
  const mat = new THREE.MeshStandardMaterial({
    map: flowerTexture(), alphaTest: 0.4, side: THREE.DoubleSide,
    roughness: 0.9, metalness: 0,
  });
  const mesh = new THREE.InstancedMesh(bushGeometry(), mat, spots.length);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.isFlowers = true; // probe/debug hook
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), col = new THREE.Color();
  const rnd = deterministicRandom(91);
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    const h = hAt(sp.x, sp.y);
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    const sz = 0.9 + rnd() * 0.7;
    sc.set(sz * (sp.s || 1), sz * (0.85 + rnd() * 0.4) * (sp.s || 1), sz * (sp.s || 1));
    m4.compose(V(sp.x, sp.y, h), q, sc);
    mesh.setMatrixAt(i, m4);
    col.setHex(AZALEA[(rnd() * AZALEA.length) | 0]);
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { meshes: [mesh] };
}
