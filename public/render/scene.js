// Open-Birdie 3D renderer.
// Sim coords: x = east, y = north, z = up (meters).
// Three coords: x = east, y = up, z = -north.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { PostFX } from './postfx.js';
import { grassNormalTexture } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, z, -y); // sim -> three

// deterministic PRNG so tree placement is stable between loads
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Surfaces are separated by VALUE (dark rough -> light fairway -> lighter
// green) so the hole reads as a golf hole, not one flat green carpet — while
// staying muted enough that the regraded lighting doesn't push them neon.
const COLORS = {
  base: '#33502f',
  rough: '#3c5a33',
  wood: '#2b4124',
  range: '#567a44',
  fairwayA: '#6f9e54', fairwayB: '#62904a',
  greenA: '#82b46c', greenB: '#76a760',
  tee: '#6b9850',
  bunker: '#cbb583',
  water: '#2f6d97',
};

export class GolfScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.45;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xa6c2d6, 1600, 7000);
    this.camera = new THREE.PerspectiveCamera(58, container.clientWidth / container.clientHeight, 0.3, 12000);
    this.camera.position.set(0, 30, 60);

    this._setupSkyAndLights();

    // gameplay objects
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
    );
    this.ball.castShadow = true;
    this.scene.add(this.ball);

    this.pin = this._makePin();
    this.scene.add(this.pin);

    this.trail = null;
    this.aimLine = null;
    this.courseGroup = null;
    this.geo = null;          // course geometry payload
    this.elev = null;         // elevation grid
    this.anim = null;         // active shot replay
    this.camMode = 'idle';
    this.orbit = { yaw: 0, dist: 14, height: 4.6 };
    this.camPosT = new THREE.Vector3(0, 30, 60);
    this.lookT = new THREE.Vector3();
    this.lookCur = new THREE.Vector3();
    this.ballSim = { x: 0, y: 0 };
    this.pinSim = { x: 0, y: 100 };
    this.aimDeg = 0;
    this.clock = new THREE.Clock();

    this._inputs();
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    window.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.setAnimationLoop(() => this._frame());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postfx?.setSize(w, h);
  }

  _setupSkyAndLights() {
    const sky = new Sky();
    sky.scale.setScalar(45000);
    const u = sky.material.uniforms;
    u.turbidity.value = 2.5;
    u.rayleigh.value = 2.0;
    u.mieCoefficient.value = 0.0022;
    u.mieDirectionalG.value = 0.85;
    // ~30° sun elevation: reads as midday but low enough to cast shadows that
    // give the terrain and trees real shape (the flat look was a high, fill-
    // dominated light with nothing to model the surface).
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(
      1, THREE.MathUtils.degToRad(90 - 30), THREE.MathUtils.degToRad(135)
    );
    u.sunPosition.value.copy(this.sunDir);

    // bake sky into an environment map for PBR ambient/specular
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky);
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 0.5; // env was double-counting the fill
    this.scene.add(sky); // moves it from envScene into the visible scene

    // Strong warm key light so lit turf pops and shadows read; the fill is
    // pulled way down so the directional contrast survives. Previously the
    // ambient was triple-counted (sun + hemisphere + full-strength env),
    // which flattened everything.
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    this.sun.castShadow = true;
    // 4096 halves the shadow texel size over the per-hole frustum, so tree
    // shadows read as canopy shapes instead of soft ink-blots.
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.35;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(new THREE.HemisphereLight(0xaeccff, 0x46603a, 0.25));
  }

  _makePin() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 2.3, 8),
      new THREE.MeshStandardMaterial({ color: 0xf5f2e8, roughness: 0.5 })
    );
    pole.position.y = 1.15;
    pole.castShadow = true;
    const flag = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.62, 4, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xd83a3a, roughness: 0.7, side: THREE.DoubleSide })
    );
    flag.rotation.z = -Math.PI / 2;
    flag.position.set(0.3, 2.05, 0);
    const cup = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 16),
      new THREE.MeshBasicMaterial({ color: 0x111111 })
    );
    cup.rotation.x = -Math.PI / 2;
    cup.position.y = 0.02;
    g.add(pole, flag, cup);
    return g;
  }

  // ---------- terrain sampling (client copy of bilinear grid) ----------
  hAt(x, y) {
    const g = this.elev;
    if (!g) return 0;
    let fx = (x - g.minX) / g.cellM, fy = (y - g.minY) / g.cellM;
    fx = Math.min(Math.max(fx, 0), g.nx - 1.001);
    fy = Math.min(Math.max(fy, 0), g.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy);
    const dx = fx - i, dy = fy - j;
    const H = g.heights, nx = g.nx;
    return H[j * nx + i] * (1 - dx) * (1 - dy) + H[j * nx + i + 1] * dx * (1 - dy) +
           H[(j + 1) * nx + i] * (1 - dx) * dy + H[(j + 1) * nx + i + 1] * dx * dy;
  }

  // ---------- course construction ----------
  loadCourse(geo) {
    if (this.courseGroup) {
      this.scene.remove(this.courseGroup);
      this.courseGroup.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
    }
    this.geo = geo;
    this.elev = geo.elevation || null;
    const group = new THREE.Group();

    const b = this._bounds(geo);
    this.bounds = b;
    group.add(this._terrainMesh(b));
    this._waterMeshes(geo).forEach((m) => group.add(m));
    this._treeMeshes(geo).forEach((m) => group.add(m));

    this.courseGroup = group;
    this.scene.add(group);
  }

  _bounds(geo) {
    if (geo.elevation) {
      const g = geo.elevation;
      return { minX: g.minX, minY: g.minY, maxX: g.minX + (g.nx - 1) * g.cellM, maxY: g.minY + (g.ny - 1) * g.cellM };
    }
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    const eat = (pts) => { for (const [x, y] of pts || []) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } };
    for (const s of geo.surfaces) eat(s.poly);
    for (const h of geo.holes) eat(h.line);
    eat(geo.boundary);
    return { minX: minX - 80, minY: minY - 80, maxX: maxX + 80, maxY: maxY + 80 };
  }

  _terrainMesh(b) {
    const g = this.elev;
    const nx = g ? g.nx : 2, ny = g ? g.ny : 2;
    const minX = b.minX, minY = b.minY;
    const cellX = g ? g.cellM : (b.maxX - b.minX);
    const cellY = g ? g.cellM : (b.maxY - b.minY);

    const pos = new Float32Array(nx * ny * 3);
    const uv = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        pos[k * 3] = minX + i * cellX;
        pos[k * 3 + 1] = g ? g.heights[k] : 0;
        pos[k * 3 + 2] = -(minY + j * cellY);
        uv[k * 2] = i / (nx - 1);
        uv[k * 2 + 1] = j / (ny - 1);
      }
    }
    const idx = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, c = a + nx;
        idx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geom.setIndex(idx);
    geom.computeVertexNormals();

    const tex = new THREE.CanvasTexture(this._paintSplat(b));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    // World-scale detail relief: tile the procedural grass normal map ~every
    // 2.5m across the course so the turf has per-meter surface for the sun to
    // shade. It shares the terrain's 0..1 uv; its own repeat does the tiling.
    const normal = grassNormalTexture();
    const tileM = 2.5;
    normal.repeat.set((b.maxX - b.minX) / tileM, (b.maxY - b.minY) / tileM);
    normal.anisotropy = tex.anisotropy;

    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      map: tex, normalMap: normal, normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.97, metalness: 0,
    }));
    mesh.receiveShadow = true;
    return mesh;
  }

  _paintSplat(b) {
    const geo = this.geo;
    const extX = b.maxX - b.minX, extY = b.maxY - b.minY;
    const ppm = Math.min(2.2, 4096 / Math.max(extX, extY));
    const W = Math.round(extX * ppm), H = Math.round(extY * ppm);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    const px = (x) => (x - b.minX) * ppm;
    const py = (y) => (b.maxY - y) * ppm; // canvas top = north

    const tracePoly = (poly) => {
      ctx.beginPath();
      ctx.moveTo(px(poly[0][0]), py(poly[0][1]));
      for (let i = 1; i < poly.length; i++) ctx.lineTo(px(poly[i][0]), py(poly[i][1]));
      ctx.closePath();
    };

    // base
    ctx.fillStyle = COLORS.base;
    ctx.fillRect(0, 0, W, H);

    // noise overlay (mottled grass)
    const ncv = document.createElement('canvas');
    ncv.width = ncv.height = 160;
    const nctx = ncv.getContext('2d');
    const rnd = mulberry32(7);
    const img = nctx.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + rnd() * 80;
      img.data[i] = v * 0.45; img.data[i + 1] = v; img.data[i + 2] = v * 0.4; img.data[i + 3] = 26;
    }
    nctx.putImageData(img, 0, 0);
    ctx.fillStyle = ctx.createPattern(ncv, 'repeat');
    ctx.fillRect(0, 0, W, H);

    // macro mottling: large soft patches of lighter/darker turf so the ground
    // still reads as varied grass from an elevated camera (the per-meter normal
    // map goes sub-pixel at that distance). Painted before the surface fills, so
    // fairway/green/bunker/water cover it where they apply.
    const mcv = document.createElement('canvas');
    mcv.width = mcv.height = 24;
    const mctx = mcv.getContext('2d');
    const mrnd = mulberry32(53);
    const mimg = mctx.createImageData(24, 24);
    for (let i = 0; i < mimg.data.length; i += 4) {
      const v = 100 + mrnd() * 90; // around mid-grey -> soft-light = subtle lift/dip
      mimg.data[i] = mimg.data[i + 1] = mimg.data[i + 2] = v; mimg.data[i + 3] = 255;
    }
    mctx.putImageData(mimg, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.globalCompositeOperation = 'soft-light';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mcv, 0, 0, W, H);
    ctx.restore();

    const fillKind = (kinds, color, blur = 2) => {
      ctx.save();
      ctx.filter = `blur(${blur}px)`;
      ctx.fillStyle = color;
      for (const s of geo.surfaces) {
        if (!kinds.includes(s.kind)) continue;
        tracePoly(s.poly);
        ctx.fill();
      }
      ctx.restore();
    };

    // wooded ground
    ctx.save();
    ctx.filter = 'blur(3px)';
    ctx.fillStyle = COLORS.wood;
    for (const w of geo.woods || []) { tracePoly(w); ctx.fill(); }
    ctx.restore();

    fillKind(['rough'], COLORS.rough, 3);
    fillKind(['range'], COLORS.range, 3);

    // fairways with mow stripes
    this._stripedLayer(ctx, W, H, ppm, b, ['fairway'], COLORS.fairwayA, COLORS.fairwayB, 9);
    fillKind(['tee'], COLORS.tee, 1.5);
    this._stripedLayer(ctx, W, H, ppm, b, ['green'], COLORS.greenA, COLORS.greenB, 3.2);
    fillKind(['bunker'], COLORS.bunker, 1.2);
    fillKind(['water'], COLORS.water, 1.5);
    return cv;
  }

  _stripedLayer(ctx, W, H, ppm, b, kinds, colA, colB, stripeM) {
    const layer = document.createElement('canvas');
    layer.width = W; layer.height = H;
    const lctx = layer.getContext('2d');
    const px = (x) => (x - b.minX) * ppm;
    const py = (y) => (b.maxY - y) * ppm;
    lctx.filter = 'blur(1.5px)';
    lctx.fillStyle = colA;
    for (const s of this.geo.surfaces) {
      if (!kinds.includes(s.kind)) continue;
      lctx.beginPath();
      lctx.moveTo(px(s.poly[0][0]), py(s.poly[0][1]));
      for (let i = 1; i < s.poly.length; i++) lctx.lineTo(px(s.poly[i][0]), py(s.poly[i][1]));
      lctx.closePath();
      lctx.fill();
    }
    lctx.filter = 'none';
    // diagonal stripes clipped to what we just painted
    lctx.globalCompositeOperation = 'source-atop';
    lctx.fillStyle = colB;
    const sw = stripeM * ppm;
    const diag = Math.hypot(W, H);
    lctx.save();
    lctx.translate(W / 2, H / 2);
    lctx.rotate(Math.PI / 5.2);
    for (let x = -diag; x < diag; x += sw * 2) lctx.fillRect(x, -diag, sw, diag * 2);
    lctx.restore();
    ctx.drawImage(layer, 0, 0);
  }

  _waterMeshes(geo) {
    const meshes = [];
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x3d7ba6, roughness: 0.08, metalness: 0, envMapIntensity: 1.1,
      transparent: true, opacity: 0.92,
    });
    for (const s of geo.surfaces) {
      if (s.kind !== 'water' || s.poly.length < 3) continue;
      const shape = new THREE.Shape(s.poly.map(([x, y]) => new THREE.Vector2(x, -y)));
      const g2 = new THREE.ShapeGeometry(shape);
      g2.rotateX(-Math.PI / 2); // (x, -y) plane -> (x, z=-y... ) lays flat, y up
      let level = Infinity;
      for (const [x, y] of s.poly) level = Math.min(level, this.hAt(x, y));
      const m = new THREE.Mesh(g2, mat);
      m.position.y = level - 0.08;
      meshes.push(m);
    }
    return meshes;
  }

  _treeMeshes(geo) {
    const spots = [];
    const rnd = mulberry32(1234);
    for (const t of geo.trees || []) spots.push({ x: t[0], y: t[1], s: 0.85 + rnd() * 0.5 });
    for (const w of geo.woods || []) {
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (const [x, y] of w) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      for (let gx = minX; gx < maxX; gx += 11) {
        for (let gy = minY; gy < maxY; gy += 11) {
          if (spots.length > 4800) break;
          const x = gx + (rnd() - 0.5) * 8, y = gy + (rnd() - 0.5) * 8;
          if (pointInPoly(x, y, w)) spots.push({ x, y, s: 0.7 + rnd() * 0.7 });
        }
      }
    }
    if (!spots.length) return [];

    const n = spots.length;
    const trunkGeom = new THREE.CylinderGeometry(0.16, 0.32, 2.8, 6);
    trunkGeom.translate(0, 1.4, 0);
    // Lumpy crown: a detail icosahedron displaced per-vertex so it reads as
    // organic foliage instead of a perfect blob. The noise is baked once and
    // shared; per-instance rotation + HSL keep the trees from looking cloned.
    const crownGeom = new THREE.IcosahedronGeometry(2.4, 2);
    const cpos = crownGeom.attributes.position;
    const crnd = mulberry32(99);
    const cv = new THREE.Vector3();
    for (let i = 0; i < cpos.count; i++) {
      cv.fromBufferAttribute(cpos, i).multiplyScalar(0.72 + crnd() * 0.5);
      cpos.setXYZ(i, cv.x, cv.y, cv.z);
    }
    crownGeom.computeVertexNormals();
    crownGeom.scale(1, 1.18, 1);
    crownGeom.translate(0, 4.4, 0);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3f28, roughness: 0.95 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, n);
    const crowns = new THREE.InstancedMesh(crownGeom, crownMat, n);
    trunks.castShadow = true;
    crowns.castShadow = true;
    crowns.receiveShadow = true;

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const sp = spots[i];
      const h = this.hAt(sp.x, sp.y);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      m4.compose(V(sp.x, sp.y, h), q, new THREE.Vector3(sp.s, sp.s * (0.85 + rnd() * 0.4), sp.s));
      trunks.setMatrixAt(i, m4);
      crowns.setMatrixAt(i, m4);
      col.setHSL(0.29 + rnd() * 0.06, 0.45 + rnd() * 0.2, 0.22 + rnd() * 0.1);
      crowns.setColorAt(i, col);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    return [trunks, crowns];
  }

  // ---------- gameplay state ----------
  setHole(hole, ballPos, aimDeg) {
    this.pinSim = { x: hole.pin[0], y: hole.pin[1] };
    const pz = this.hAt(this.pinSim.x, this.pinSim.y);
    this.pin.position.copy(V(this.pinSim.x, this.pinSim.y, pz));
    this.setBall(ballPos);
    this.aimDeg = aimDeg;
    this.orbit = { yaw: 0, dist: 14, height: 4.6 };
    this.camMode = 'idle';
    this._snapIdleCam();
    this._fitShadows(hole);
    this._aimLineUpdate();
    this._clearTrail();
  }

  setBall(p) {
    this.ballSim = { x: p.x, y: p.y };
    const z = this.hAt(p.x, p.y);
    this.ball.position.copy(V(p.x, p.y, z + 0.06));
  }

  setAim(aimDeg) {
    this.aimDeg = aimDeg;
    this._aimLineUpdate();
  }

  _fitShadows(hole) {
    const cx = (hole.tee[0] + hole.pin[0]) / 2, cy = (hole.tee[1] + hole.pin[1]) / 2;
    const cz = this.hAt(cx, cy);
    const center = V(cx, cy, cz);
    const span = Math.hypot(hole.pin[0] - hole.tee[0], hole.pin[1] - hole.tee[1]) * 0.62 + 70;
    this.sun.position.copy(center).addScaledVector(this.sunDir, 700);
    this.sun.target.position.copy(center);
    const c = this.sun.shadow.camera;
    c.left = -span; c.right = span; c.top = span; c.bottom = -span;
    c.near = 200; c.far = 1400;
    c.updateProjectionMatrix();
  }

  _aimLineUpdate() {
    if (this.aimLine) { this.scene.remove(this.aimLine); this.aimLine.geometry.dispose(); }
    const rad = this.aimDeg * Math.PI / 180;
    const dx = Math.sin(rad), dy = Math.cos(rad);
    const len = Math.min(Math.hypot(this.pinSim.x - this.ballSim.x, this.pinSim.y - this.ballSim.y), 240);
    const pts = [];
    for (let d = 2; d <= len; d += 6) {
      const x = this.ballSim.x + dx * d, y = this.ballSim.y + dy * d;
      pts.push(V(x, y, this.hAt(x, y) + 0.25));
    }
    if (pts.length < 2) return;
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    this.aimLine = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, dashSize: 2.2, gapSize: 2.2 }));
    this.aimLine.computeLineDistances();
    this.scene.add(this.aimLine);
  }

  _clearTrail() {
    if (this.trail) { this.scene.remove(this.trail); this.trail.geometry.dispose(); this.trail = null; }
  }

  // ---------- shot replay ----------
  playShot(points, flightTime, onDone) {
    if (!points || points.length < 2) { onDone?.(); return; }
    this._clearTrail();
    if (this.aimLine) this.aimLine.visible = false;
    const dur = points[points.length - 1].t;
    this.anim = {
      points, i: 0,
      t: 0,
      speed: dur > 14 ? dur / 14 : 1,
      flightTime,
      dur,
      onDone,
      trailPts: [],
    };
    // Fixed "golfer POV" tracer: park the camera behind the ball and let the
    // shot fly away from a still vantage point — no chase, no greenside cut.
    this._setTracerCam(points);
    this.camMode = 'static';
  }

  // Place the camera behind the ball on the launch line, framed to hold the
  // whole flight; playShot then leaves it untouched so it stays still.
  _setTracerCam(points) {
    const p0 = points[0];
    const ph = points[Math.min(points.length - 1, 10)];
    const hd = Math.atan2(ph.x - p0.x, ph.y - p0.y); // launch heading (sim frame)
    const dist = Math.max(this.orbit.dist, 15);
    const height = Math.max(this.orbit.height + 1.5, 6);
    const cx = p0.x - Math.sin(hd) * dist, cy = p0.y - Math.cos(hd) * dist;
    this.camPosT.copy(V(cx, cy, this.hAt(cx, cy) + height));
    let apex = -Infinity;
    const last = points[points.length - 1];
    for (const p of points) if (p.z > apex) apex = p.z;
    const carry = Math.hypot(last.x - p0.x, last.y - p0.y) || 60;
    const ld = Math.min(carry * 0.55, 140);
    const lx = p0.x + Math.sin(hd) * ld, ly = p0.y + Math.cos(hd) * ld;
    this.lookT.copy(V(lx, ly, p0.z + Math.max((apex - p0.z) * 0.45, 5)));
  }

  _animStep(dt) {
    const a = this.anim;
    a.t += dt * a.speed;
    const pts = a.points;
    while (a.i < pts.length - 1 && pts[a.i + 1].t <= a.t) a.i++;
    let p;
    if (a.i >= pts.length - 1) {
      p = pts[pts.length - 1];
    } else {
      const p0 = pts[a.i], p1 = pts[a.i + 1];
      const f = Math.min(1, (a.t - p0.t) / Math.max(1e-6, p1.t - p0.t));
      p = { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f, z: p0.z + (p1.z - p0.z) * f };
    }
    this.ballSim = { x: p.x, y: p.y };
    this.ball.position.copy(V(p.x, p.y, p.z + 0.06));

    // trail
    a.trailPts.push(this.ball.position.clone());
    if (a.trailPts.length > 2) {
      if (this.trail) { this.scene.remove(this.trail); this.trail.geometry.dispose(); }
      const g = new THREE.BufferGeometry().setFromPoints(a.trailPts);
      this.trail = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 }));
      this.scene.add(this.trail);
    }

    if (a.t >= a.dur) {
      const done = a.onDone;
      this.anim = null;
      setTimeout(() => {
        this.camMode = 'idle';
        if (this.aimLine) this.aimLine.visible = true;
        done?.();
      }, 900);
    }
  }

  // ---------- cameras ----------
  _snapIdleCam() {
    this._idleTargets(true);
    this.camera.position.copy(this.camPosT);
    this.lookCur.copy(this.lookT);
    this.camera.lookAt(this.lookCur);
  }

  _idleTargets() {
    const rad = (this.aimDeg + this.orbit.yaw) * Math.PI / 180;
    const dx = Math.sin(rad), dy = Math.cos(rad);
    const bx = this.ballSim.x, by = this.ballSim.y;
    const bz = this.hAt(bx, by);
    const cx = bx - dx * this.orbit.dist, cy = by - dy * this.orbit.dist;
    this.camPosT.copy(V(cx, cy, Math.max(this.hAt(cx, cy) + 1.7, bz + this.orbit.height)));
    const lookAhead = Math.min(Math.hypot(this.pinSim.x - bx, this.pinSim.y - by), 130);
    this.lookT.copy(V(bx + dx * lookAhead * 0.45, by + dy * lookAhead * 0.45, bz + 2));
  }

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.anim) this._animStep(dt);

    // 'idle' tracks the ball at address; 'static' (shot tracer) holds the
    // frozen camera that playShot parked behind the ball.
    if (this.camMode === 'idle') this._idleTargets();

    const k = 1 - Math.exp(-4.2 * dt);
    this.camera.position.lerp(this.camPosT, k);
    this.lookCur.lerp(this.lookT, k);
    this.camera.lookAt(this.lookCur);

    // keep ball & pin readable at distance
    const bd = this.camera.position.distanceTo(this.ball.position);
    this.ball.scale.setScalar(THREE.MathUtils.clamp(bd * 0.055, 1, 26));
    const pd = this.camera.position.distanceTo(this.pin.position);
    this.pin.scale.setScalar(THREE.MathUtils.clamp(pd * 0.013, 1, 6));

    this.postfx.render();
  }

  _inputs() {
    const el = this.renderer.domElement;
    let dragging = false, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging || this.camMode !== 'idle') return;
      this.orbit.yaw += (e.clientX - lx) * 0.25;
      this.orbit.height = THREE.MathUtils.clamp(this.orbit.height + (e.clientY - ly) * 0.03, 1.6, 26);
      lx = e.clientX; ly = e.clientY;
    });
    el.addEventListener('wheel', (e) => {
      if (this.camMode !== 'idle') return;
      this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * (e.deltaY > 0 ? 1.12 : 0.89), 5, 60);
    }, { passive: true });
  }
}
