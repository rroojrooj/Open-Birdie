// Open-Birdie 3D renderer.
// Sim coords: x = east, y = north, z = up (meters).
// Three coords: x = east, y = up, z = -north.
import * as THREE from 'three';
import { PostFX } from './postfx.js';
import { loadHDRIEnvironment, makeSun, makeGroundedSkybox, makeFallbackEnv } from './env.js';
import { makeAerialFog } from './atmosphere.js';
import { buildCardTrees } from './tree-cards.js';
import { buildGrounding } from './grounding.js';
import { buildPineStraw, buildFlowers, vegetationTexturePixelChecksums } from './vegetation.js';
import { buildRakes } from './props.js';
import { buildGrass } from './grass.js';
import { buildWater } from './water.js';
import { makeWaterDepth } from './water-depth.js';
import { makeTurfMaterial, makeSandMaterial } from './turf.js';
import { srgbToLinear, averageLinearColor } from './macro-tint.js';
import { densifyRing, drapeRing } from './drape.js';
import { buildHdTerrain, buildCoarseTerrain } from './hd-terrain.js';
import { makeTerrainSampler } from './terrain-grid.js';
import { RENDER_CONFIG } from './config.js';
import { isPlayFraming, ballReadScale, pinReadScale } from './framing.js';
import { COLORS, DRY_PALETTE, courseDryFor, blendPalette } from './course-character.js';
import { paintSurfaceMask, RAW_SURFACE_COLORS } from './surface-mask.js';
import { installLoadingTracker } from './capture-readiness.js';
import {
  classifyAnimationCadence,
  disjointQueryDisposition,
  normalizePerformanceRequest,
} from './capture-performance.js';

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

// sRGB hex -> linear [r,g,b] (0..1). The P2a crisp-edge composite overrides the
// splat albedo per-surface IN-SHADER, where diffuseColor is already linear — so the
// palette uniforms must be linearized to match (srgbToLinear takes a 0-255 byte).
function hexToLinearRGB(hex) {
  return [
    srgbToLinear(parseInt(hex.slice(1, 3), 16)),
    srgbToLinear(parseInt(hex.slice(3, 5), 16)),
    srgbToLinear(parseInt(hex.slice(5, 7), 16)),
  ];
}

// The lush COLORS palette lives in course-character.js (shared with the dry-links
// blend + its unit test, no circular import). Per-course dryness picks the actual
// palette (this._pal) at load — see below.

export class GolfScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER_CONFIG.toneMappingExposure;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // fog is set once the HDRI horizon color is known (see _setupSkyAndLights)
    this.camera = new THREE.PerspectiveCamera(58, container.clientWidth / container.clientHeight, 0.3, 12000);
    this.camera.position.set(0, 30, 60);

    // Install before HDRI/texture requests begin so capture readiness observes
    // every asynchronous renderer load without changing Three's callbacks.
    this.loadingTracker = installLoadingTracker(THREE.DefaultLoadingManager);
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
    this.camMode = 'idle'; // 'idle' (orbit ball) | 'static' (shot tracer) | 'free' (course-creator fly)
    this.orbit = { yaw: 0, dist: 14, height: 4.6 };
    // free-roam "course creator" camera: a ground pivot (tx,ty,h) orbited by yaw/pitch at dist.
    this.free = { tx: 0, ty: 0, h: 0, yaw: 0, pitch: -28, dist: 45, hOff: 0 };
    this.freeKeys = {};
    this._freeCamCb = null; // (on) => void — UI hook for the toggle/hint
    this.camPosT = new THREE.Vector3(0, 30, 60);
    this.lookT = new THREE.Vector3();
    this.lookCur = new THREE.Vector3();
    this.ballSim = { x: 0, y: 0 };
    this.pinSim = { x: 0, y: 100 };
    this.aimDeg = 0;
    this.clock = new THREE.Clock();

    this._inputs();
    // overlay layer for floating distance markers projected from world space
    this.markerLayer = document.createElement('div');
    this.markerLayer.className = 'dist-markers';
    container.appendChild(this.markerLayer);
    this.markers = [];
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this.waterDepth = RENDER_CONFIG.waterFoam ? makeWaterDepth(this.renderer) : null;
    window.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(container);
    this._liveFrame = () => this._frame();
    this._visualCaptureCourseRevision = 0;
    this.shaderCompileStatus = { state: 'waiting-for-course', revision: 0 };
    this._animationLoopLive = true;
    this._captureFixedTime = null;
    this.renderer.setAnimationLoop(this._liveFrame);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postfx?.setSize(w, h);
    this.waterDepth?.setSize(w, h);
  }

  _setupSkyAndLights() {
    this.environmentStatus = { state: 'loading' };
    // neutral hold until the HDRI resolves (avoids a black flash)
    this.scene.background = new THREE.Color(0x9fb8cf);
    // sun must exist before the first frame / first _fitShadows; aim refined on load
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(
      1, THREE.MathUtils.degToRad(60), THREE.MathUtils.degToRad(135));
    this.sun = makeSun(this.sunDir);
    this.scene.add(this.sun, this.sun.target);

    // HDRI: image-based lighting + visible sky + ground horizon + sun direction.
    // One source of truth for the sun (this.sunDir) drives the light + _fitShadows.
    this.envReady = loadHDRIEnvironment(this.renderer).then(({ envTexture, equirect, sunDir, horizonColor }) => {
      this.scene.environment = envTexture;
      this.scene.environmentIntensity = RENDER_CONFIG.environmentIntensity;
      this.scene.background = equirect;
      this._equirect = equirect;
      this.sunDir.copy(sunDir);
      if (RENDER_CONFIG.aerialFog) this.scene.fog = makeAerialFog(horizonColor);
      if (this.bounds) this._placeSkybox();                     // course already loaded
      if (this._activeHole) this._fitShadows(this._activeHole); // re-aim shadows to HDRI sun
      this.environmentStatus = { state: 'ready' };
    }).catch((e) => {
      console.error('[env] HDRI load failed, using fallback env', e);
      this.scene.environment = makeFallbackEnv(this.renderer);  // D1: keep scene lit
      this.scene.environmentIntensity = RENDER_CONFIG.environmentIntensity;
      this.environmentStatus = { state: 'fallback', error: e?.message || String(e) };
    });
  }

  // GroundedSkybox needs course bounds, so it's (re)placed on course load and on
  // env-ready, whichever comes second.
  _placeSkybox() {
    if (!RENDER_CONFIG.groundedSky || !this._equirect || !this.bounds) return;
    if (this._skybox) { this.scene.remove(this._skybox); this._skybox.geometry?.dispose(); }
    this._skybox = makeGroundedSkybox(this._equirect, this.bounds);
    this.scene.add(this._skybox);
  }

  _makePin() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 2.3, 8),
      new THREE.MeshStandardMaterial({ color: 0xf5f2e8, roughness: 0.5 })
    );
    pole.position.y = 1.15;
    pole.castShadow = true;
    // Waving cloth flag: a subdivided plane anchored at the pole, rippled in the
    // vertex shader (amplitude grows toward the free edge). The focal point of
    // every shot, so it shouldn't be a frozen faceted cone.
    const flagGeo = new THREE.PlaneGeometry(0.7, 0.42, 14, 5);
    flagGeo.translate(0.35, 0, 0); // left edge at the pole
    const flagU = { value: 0 };
    this._flagU = flagU;
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xd83a3a, roughness: 0.7, side: THREE.DoubleSide });
    flagMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = flagU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float fx = clamp(transformed.x / 0.7, 0.0, 1.0);
          transformed.z += (sin(fx * 6.0 - uTime * 7.0) * 0.06 + sin(fx * 3.0 - uTime * 4.3) * 0.035) * fx;
          transformed.y += sin(fx * 5.0 - uTime * 6.0) * 0.02 * fx;`);
    };
    flagMat.customProgramCacheKey = () => 'pin-flag';
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0, 2.08, 0);
    flag.castShadow = true;
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
  // Bilinear sample of one grid {minX,minY,cellM,nx,ny,heights}, clamped to edge.
  _sampleGrid(g, x, y) {
    let fx = (x - g.minX) / g.cellM, fy = (y - g.minY) / g.cellM;
    fx = Math.min(Math.max(fx, 0), g.nx - 1.001);
    fy = Math.min(Math.max(fy, 0), g.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy);
    const dx = fx - i, dy = fy - j;
    const H = g.heights, nx = g.nx;
    return H[j * nx + i] * (1 - dx) * (1 - dy) + H[j * nx + i + 1] * dx * (1 - dy) +
           H[(j + 1) * nx + i] * (1 - dx) * dy + H[(j + 1) * nx + i + 1] * dx * dy;
  }

  // Terrain height at (x,y): high-res LIDAR patch where one covers, else base.
  // Sharp (no feather) — used to seat the ball/pin/objects on the real surface.
  hAt(x, y) {
    if (this._hdSampler) return this._hdSampler.h(x, y); // HD patch wins (parity with physics)
    const g = this.elev;
    if (!g) return 0;
    for (const p of g.patches || []) {
      const maxX = p.minX + (p.nx - 1) * p.cellM, maxY = p.minY + (p.ny - 1) * p.cellM;
      if (x >= p.minX && x <= maxX && y >= p.minY && y <= maxY) return this._sampleGrid(p, x, y);
    }
    return this._sampleGrid(g, x, y);
  }

  // ---------- course construction ----------
  loadCourse(geo, { hdAssets = null } = {}) {
    this._visualCaptureCourseRevision += 1;
    this.shaderCompileStatus = {
      state: 'pending',
      revision: this._visualCaptureCourseRevision,
    };
    this._treeWind = this._grassWind = this._waterUpdate = this._waterMeshList = this._terrain = null; // drop stale per-course refs
    this._fairwayGrassMesh = this._fairwayGrassWind = this._fairwayGrassCenter = this._fgGeo = this._fgGroup = this._fairwayZoneColorFn = null;
    // HD bundles (one per built hole) each own their textures. hdAssets may be an
    // array, a single legacy bundle, or null — normalize, then free any bundle from
    // the previous course that isn't being kept.
    const hdList = Array.isArray(hdAssets) ? hdAssets : (hdAssets ? [hdAssets] : []);
    for (const a of (Array.isArray(this._hdAssets) ? this._hdAssets : [])) {
      if (!hdList.includes(a)) { try { a.dispose?.(); } catch (e) { /* already gone */ } }
    }
    if (this.courseGroup) {
      this.scene.remove(this.courseGroup);
      this.courseGroup.traverse((o) => {
        o.geometry?.dispose();
        const m = o.material;
        if (m) {
          m.map?.dispose(); m.alphaMap?.dispose(); m.normalMap?.dispose(); m.roughnessMap?.dispose();
          (m.userData?.disposeTextures || []).forEach((t) => t?.dispose?.());
          m.dispose?.();
        }
        o.customDepthMaterial?.dispose?.(); // foliage cutout-shadow material isn't a child
        if (o.userData?.isWaterReflector) o.dispose?.(); // free the reflection render target
      });
    }
    this.geo = geo;
    this.elev = geo.elevation || null;
    // Course character (P1b): one manual dryness scalar (0 lush parkland .. 1 dry
    // links) picks the actual turf palette + drives the turf shader (uCourseDry).
    // Chambers -> tan links; Sawgrass -> unchanged lush green.
    this._courseDry = courseDryFor(geo.name);
    this._pal = blendPalette(COLORS, DRY_PALETTE, this._courseDry);
    // HD bundle: a high-res terrain patch + aerial macro within its rect. Sets up the
    // unified sampler (placement) + macro (turf shader) consumed below.
    this._hdAssets = hdList;
    // Free the previous course's macro tint textures on BOTH paths — inside the
    // aerial branch this would leak the old full-res aerial (~64 MB + mips GPU)
    // whenever the user switches from a US course to a no-aerial course.
    if (this._macro) { this._macro.albedo?.dispose?.(); this._macro.low?.dispose?.(); this._macro.classTex?.dispose?.(); }
    for (const hm of this._hdMacros || []) hm.low?.dispose?.(); // ours; the bundle owns the ortho
    if (hdList.length && this.elev) {
      this._hdPatches = hdList.map((a) => ({
        minX: a.terrain.bounds.minX, minY: a.terrain.bounds.minY, cellM: a.terrain.cellM,
        nx: a.terrain.nx, ny: a.terrain.ny, heights: a.terrain.heights, edgeBlendM: 0,
      }));
      // Each HD macro gets a REAL blurred tint copy + mean from its own decoded ortho
      // bitmap — without it, the aerial-less fallback path would divide the un-blurred
      // photo by a fabricated grey mean (a mis-normalized full-frequency multiply).
      // Defaults re-tuned for v24 tint semantics (the old 0.78/0.96 meant photo weight).
      this._hdMacros = hdList.map((a) => {
        const t = this._tintFromImage(a.orthophoto.image);
        return {
          albedo: a.orthophoto, surfaces: a.surfaces, coverage: a.coverage, bounds: a.terrain.bounds,
          low: t.low, avg: t.avg,
          closeWeight: RENDER_CONFIG.hdMacroCloseWeight ?? 0.85, farWeight: RENDER_CONFIG.hdMacroFarWeight ?? 0.92,
        };
      });
      this._hdSampler = makeTerrainSampler(this.elev, this._hdPatches);
    } else {
      this._hdPatches = []; this._hdMacros = []; this._hdSampler = null;
    }
    // Course-wide aerial: since v24 it TINTS the lit turf (blurred copy + playable
    // mean, built when the photo decodes) and supplies the true-far-field photo; the
    // materials carry the surface at play distance. Loaded async; white 1x1 coverage
    // = valid everywhere; black 1x1 surfaces = "no classes" (reserved for the NDVI
    // follow-up — white would mean all-classes-everywhere the day it's sampled).
    if (geo.aerial && geo.aerial.bounds) {
      // Capture the macro object in the decode callback (NOT this._macro): if the user
      // switches course before the photo decodes, the stale callback must not redraw
      // the NEW course's tint canvas from the OLD course's image.
      const macroRef = {};
      const tex = new THREE.TextureLoader().load('/api/course-aerial',
        () => this._buildMacroTint(macroRef),
        undefined,
        () => console.warn('[render] course aerial failed to load — procedural turf + neutral tint'));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      if (!this._whiteTex) {
        this._whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
        this._whiteTex.needsUpdate = true;
      }
      if (!this._blackTex) {
        this._blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
        this._blackTex.needsUpdate = true;
      }
      // Tint copy: starts as 1x1 mid-grey (tint == 1.0 everywhere) and is redrawn in
      // place from the decoded photo — the shader uniform holds THIS texture object,
      // so mutating it needs no recompile (same async-update pattern as the photo).
      const tintCv = document.createElement('canvas');
      tintCv.width = tintCv.height = 1;
      const tctx = tintCv.getContext('2d');
      tctx.fillStyle = '#808080'; tctx.fillRect(0, 0, 1, 1);
      const low = new THREE.CanvasTexture(tintCv);
      low.colorSpace = THREE.SRGBColorSpace;
      low.wrapS = low.wrapT = THREE.ClampToEdgeWrapping;
      this._macro = Object.assign(macroRef, {
        albedo: tex, low, avg: new THREE.Vector3(0.2159, 0.2159, 0.2159), // linear of #808080 -> tint 1.0
        coverage: this._whiteTex, surfaces: this._blackTex, bounds: geo.aerial.bounds,
        closeWeight: RENDER_CONFIG.courseAerialTintClose ?? 0.85,
        farWeight: RENDER_CONFIG.courseAerialTintFar ?? 0.92,
        photoFar: RENDER_CONFIG.courseAerialPhotoFar ?? 0.88,
      });
      // Runtime NDVI classmap: when the server advertises a FRESH one (classes:true),
      // replace the black 1x1 surfaces default with the real per-pixel class texture.
      // A 404 / decode failure leaves surfaces as whatever it was (the incomplete
      // texture samples black) → OSM-only, graceful by construction. Task 5 makes the
      // turf shader actually SAMPLE this; here we only deliver the texture.
      if (geo.aerial.classes) {
        const cls = new THREE.TextureLoader().load('/api/course-classmap',
          (tex) => {
            // P2a-T4: the runtime NDVI classmap is per-pixel scatter (false positives that
            // NDVI misreads as mown/sand) — rendered raw it's a "dot-screen" stipple on the
            // turf. Blur it into SMOOTH coverage at load: isolated noise averages toward 0,
            // contiguous real regions stay high (the turf shader then thresholds the
            // low-amplitude survivors so only confident coverage adds surface).
            try {
              const im = tex.image;
              if (im && im.width) {
                const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
                const c = cv.getContext('2d');
                c.filter = 'blur(4px)';
                c.drawImage(im, 0, 0);
                tex.image = cv; tex.needsUpdate = true;
              }
            } catch (e) { /* keep the raw texture on failure */ }
            console.log('[render] classmap loaded + smoothed');
          },
          undefined,
          () => console.warn('[render] classmap failed to load — OSM-only surfaces'));
        cls.colorSpace = THREE.NoColorSpace;               // data, not colour
        cls.wrapS = cls.wrapT = THREE.ClampToEdgeWrapping;
        cls.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        this._macro.surfaces = cls;
        this._macro.classTex = cls;                        // so it's disposed on reload
      }
    } else {
      this._macro = null;
    }
    const group = new THREE.Group();

    const b = this._bounds(geo);
    this.bounds = b;
    this._placeSkybox();
    const terrain = this._terrainMesh(b);
    group.add(terrain);
    this._terrain = terrain; // referenced by the water-foam depth pre-pass
    this._addWater(geo, group);
    this._addTrees(geo, group);
    try { this._addBuildings(geo, group); }
    catch (e) { console.warn('[render] buildings skipped:', e && e.message); }
    this._addGrass(geo, group);
    this._addFlowers(geo, group);
    this._addFairwayGrass(geo, group);
    // LIDAR green meshes are a visual enhancement — never let a bug here break
    // the course load (the picker, physics, base render must still work). With an
    // HD bundle the high-res terrain + aerial already supply the greens, and
    // `terrain` is a Group (no single material), so skip the legacy patches.
    if (!this._hdPatches.length) {
      try { this._addGreenPatches(group, terrain); }
      catch (e) { console.warn('[render] green patches skipped:', e && e.message); }
    }
    // Crisp bunker meshes (sharp sand edges). Same guard — purely visual.
    if (RENDER_CONFIG.crispBunkers) {
      try { this._addSurfacePatches(group, ['bunker'], makeSandMaterial); }
      catch (e) { console.warn('[render] bunker patches skipped:', e && e.message); }
    }
    // Bunker rakes — iconic human-scale prop. Purely visual, so same load guard.
    if (RENDER_CONFIG.props) {
      try {
        const bunkers = (geo.surfaces || []).filter((s) => s.kind === 'bunker' && s.poly && s.poly.length >= 3);
        buildRakes(bunkers, (x, y) => this.hAt(x, y), V).meshes.forEach((m) => group.add(m));
      } catch (e) { console.warn('[render] rakes skipped:', e && e.message); }
    }

    this.courseGroup = group;
    this.scene.add(group);
  }

  async compileVisualCaptureShaders() {
    const revision = this._visualCaptureCourseRevision;
    this.shaderCompileStatus = { state: 'compiling', revision };
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
      if (revision === this._visualCaptureCourseRevision) {
        this.shaderCompileStatus = { state: 'ready', revision };
      }
    } catch (error) {
      if (revision === this._visualCaptureCourseRevision) {
        this.shaderCompileStatus = {
          state: 'failed',
          revision,
          error: error?.message || String(error),
        };
      }
      console.error('[visual-capture] shader compilation failed', error);
    }
    return { ...this.shaderCompileStatus };
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
    // Packed channels: .r = mown (fairway/tee/green — semantics unchanged), .g = green
    // only. One canvas, no extra texture (~67 MB saved at the 4096 cap); kinds paint
    // in order so greens land last and keep their G channel.
    const maskTex = new THREE.CanvasTexture(this._paintMask(
      b, ['fairway', 'tee', 'green'], { default: '#ff0000', green: '#ffff00' }));
    maskTex.colorSpace = THREE.NoColorSpace;
    maskTex.anisotropy = tex.anisotropy;
    const bunkerMaskTex = new THREE.CanvasTexture(this._paintMask(b, ['bunker']));
    bunkerMaskTex.colorSpace = THREE.NoColorSpace;
    bunkerMaskTex.anisotropy = tex.anisotropy;
    // P2a raw packed surface membership (additive channels, so overlaps survive):
    //   R = mown (fairway / tee / green), G = green, B = bunker.
    // The blurred masks above remain authoritative for their existing soft uses.
    const maskRawTex = new THREE.CanvasTexture(this._paintMask(
      b, ['fairway', 'tee', 'green', 'bunker'], RAW_SURFACE_COLORS, 0, true));
    maskRawTex.colorSpace = THREE.NoColorSpace;
    maskRawTex.anisotropy = tex.anisotropy;

    // Stashed so _addGreenPatches can build a second, polygon-offset instance of the
    // SAME shader (shared texture/macro objects — in-place tint updates reach both).
    this._turfInputs = {
      baseMap: tex, mownMask: maskTex, bunkerMask: bunkerMaskTex, bounds: b, anisotropy: tex.anisotropy,
      macro: this._macro || this._hdMacros[0] || null,
      courseDry: this._courseDry, // P1b: drives the turf shader (warm-mix, stripes, far-photo)
      surfaceMaskRaw: maskRawTex, // P2a: crisp fwidth edge source (R=mown/G=green/B=bunker)
      // P2a: per-surface palette (linear) so the shader can composite the base colour
      // per-fragment with a crisp fwidth mask, overriding the soft splat/tint/collar.
      pal: {
        greenA: hexToLinearRGB(this._pal.greenA),
      },
    };
    const turfMat = makeTurfMaterial(this._turfInputs);
    if (this._hdPatches.length) {
      // Unified terrain: a coarse mesh with EVERY HD rect cut out + one HD mesh per
      // patch filling the cutouts, sharing boundaries with zero positive-area overlap.
      // All share the turf material (the course-wide aerial macro + splat/masks use
      // course-relative UVs, so they align across patches). Each HD mesh skips cells
      // already covered by an earlier patch, so overlapping padded hole rects don't
      // z-fight — same precedence the height sampler uses.
      const cutouts = this._hdMacros.map((m) => m.bounds);
      const grp = new THREE.Group();
      grp.add(buildCoarseTerrain({ grid: this.elev, cutouts, material: turfMat }));
      this._hdPatches.forEach((patch, k) => {
        grp.add(buildHdTerrain({ grid: patch, material: turfMat, uvBounds: b, skipBounds: cutouts.slice(0, k) }));
      });
      return grp;
    }
    const mesh = new THREE.Mesh(geom, turfMat);
    mesh.receiveShadow = true;
    return mesh;
  }

  // Redraw the 1x1 placeholder tint canvas from the decoded course aerial: a small
  // blurred copy (low-frequency hue/value only — baked shadows and sub-30cm detail
  // are averaged away) + the mean linear color of the PLAYABLE ground, used to
  // normalize it. Playable = inside the course boundary, outside water/bunker: the
  // aerial is padded ~60 m past the course and can include open sea (not an OSM
  // surface at all), and parkland courses are water-heavy — a mean dragged dark by
  // water would brighten ALL turf and make the tint knobs course-dependent.
  // Non-playable pixels are then neutralized to that mean so they can't halo into
  // the turf tint. Resolution is fixed metres-per-pixel, course-size-independent.
  // `m` is the macro object captured at load time; bail if a newer course replaced
  // it. Best-effort: a failure here must never break course load.
  _buildMacroTint(m) {
    if (!m || m !== this._macro) return; // course changed while the photo decoded
    try {
      const img = m.albedo && m.albedo.image;
      if (!img || !img.width) return;
      const b = m.bounds, extX = b.maxX - b.minX, extY = b.maxY - b.minY;
      const mpp = RENDER_CONFIG.macroTintMPerPx ?? 2.5;
      const w = Math.min(1024, Math.max(32, Math.round(extX / mpp)));
      const h = Math.min(1024, Math.max(32, Math.round(extY / mpp)));
      const px = (x) => ((x - b.minX) / extX) * w, py = (y) => ((b.maxY - y) / extY) * h;
      const trace = (c, poly) => {
        c.moveTo(px(poly[0][0]), py(poly[0][1]));
        for (let i = 1; i < poly.length; i++) c.lineTo(px(poly[i][0]), py(poly[i][1]));
        c.closePath();
      };
      const cnv = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      const raw = cnv(); const rctx = raw.getContext('2d');
      rctx.drawImage(img, 0, 0, w, h);
      // playable-mask: alpha 1 inside the boundary, erased over water/bunker (alpha
      // keys both the mean loop and the composite below)
      const msk = cnv(); const mctx = msk.getContext('2d');
      const boundary = this.geo && this.geo.boundary;
      mctx.fillStyle = '#fff';
      if (boundary && boundary.length >= 3) { mctx.beginPath(); trace(mctx, boundary); mctx.fill(); }
      else mctx.fillRect(0, 0, w, h);
      mctx.globalCompositeOperation = 'destination-out';
      for (const s of (this.geo && this.geo.surfaces) || []) {
        if ((s.kind !== 'water' && s.kind !== 'bunker') || !s.poly || s.poly.length < 3) continue;
        mctx.beginPath(); trace(mctx, s.poly); mctx.fill();
      }
      // mean over playable pixels only (empty mask -> full-frame fallback)
      const rd = rctx.getImageData(0, 0, w, h).data, md = mctx.getImageData(0, 0, w, h).data;
      let r = 0, g = 0, bl = 0, n = 0;
      for (let i = 0; i < rd.length; i += 4) {
        if (md[i + 3] < 128) continue;
        r += srgbToLinear(rd[i]); g += srgbToLinear(rd[i + 1]); bl += srgbToLinear(rd[i + 2]); n++;
      }
      if (n > 0) m.avg.set(r / n, g / n, bl / n);
      else { const a = averageLinearColor(rd); m.avg.set(a.r, a.g, a.b); }
      // composite: mean everywhere, real photo only where playable, then blur into
      // the live tint canvas (the texture object bound at compile — mutate in place)
      const play = cnv(); const pctx = play.getContext('2d');
      pctx.drawImage(msk, 0, 0);
      pctx.globalCompositeOperation = 'source-in';
      pctx.drawImage(raw, 0, 0);
      const comp = cnv(); const cctx = comp.getContext('2d');
      cctx.fillStyle = `rgb(${Math.round(255 * (m.avg.x ** (1 / 2.2)))},${Math.round(255 * (m.avg.y ** (1 / 2.2)))},${Math.round(255 * (m.avg.z ** (1 / 2.2)))})`;
      cctx.fillRect(0, 0, w, h);
      cctx.drawImage(play, 0, 0);
      const cv = m.low.image;
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.filter = `blur(${RENDER_CONFIG.macroTintBlurPx ?? 2}px)`;
      ctx.drawImage(comp, 0, 0);
      m.low.needsUpdate = true;
      console.log(`[render] aerial tint built ${w}x${h}, playable mean rgb(${m.avg.x.toFixed(3)}, ${m.avg.y.toFixed(3)}, ${m.avg.z.toFixed(3)})`);
    } catch (e) { console.warn('[render] tint build failed — neutral tint kept:', e && e.message); }
  }

  // Blurred low-res copy + linear mean from an already-decoded image (HD ortho path —
  // the bundle loader hands us the ImageBitmap synchronously).
  _tintFromImage(img) {
    const w = Math.max(8, Math.min(128, Math.round(((img && img.width) || 64) / 8)));
    const h = Math.max(8, Math.min(128, Math.round(((img && img.height) || 64) / 8)));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.filter = `blur(${RENDER_CONFIG.macroTintBlurPx ?? 2}px)`;
    try { ctx.drawImage(img, 0, 0, w, h); } catch (e) { /* keep blank canvas -> neutral-ish */ }
    const a = averageLinearColor(ctx.getImageData(0, 0, w, h).data);
    const low = new THREE.CanvasTexture(cv);
    low.colorSpace = THREE.SRGBColorSpace;
    low.wrapS = low.wrapT = THREE.ClampToEdgeWrapping;
    return { low, avg: new THREE.Vector3(a.r || 0.2159, a.g || 0.2159, a.b || 0.2159) };
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
    ctx.fillStyle = this._pal.base;
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

    // (Macro-mottling removed in Tier 2: the tiled PBR grass detail now provides
    // turf variation; the old large soft-light patches read as a blob/smudge.)

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
    ctx.fillStyle = this._pal.wood;
    for (const w of geo.woods || []) { tracePoly(w); ctx.fill(); }
    ctx.restore();

    fillKind(['rough'], this._pal.rough, 1.5);
    fillKind(['range'], this._pal.range, 1.5);

    // mown surfaces — uniform base color; mow stripes are added physically in the
    // turf shader (mask-gated) so they survive the tiled grass detail.
    fillKind(['fairway'], this._pal.fairwayA, 1.2);
    fillKind(['tee'], this._pal.tee, 1.5);
    // P2a: the green splat is painted near-crisp (0.35) so it doesn't bleed ~0.45 m of
    // green PAST the polygon; the in-shader fwidth composite overrides the base colour
    // AT the edge, but where gCrisp==0 (just outside) it falls back to this splat, so a
    // soft splat here would re-soften the mow line the shader just crisped.
    fillKind(['green'], this._pal.greenA, 0.35);
    fillKind(['bunker'], this._pal.bunker, 1.2);
    fillKind(['water'], this._pal.water, 1.5);
    return cv;
  }

  // Channel mask over the terrain for the given surface kinds — black elsewhere.
  // Default: white inside the polygons (the shipping single-channel behavior).
  // With a `colors` map, each kind fills with its own color so one canvas can pack
  // several gates (e.g. .r = mown, .g = green). Kinds paint in the ORDER GIVEN —
  // later kinds overpaint earlier ones where polygons touch.
  _paintMask(b, kinds, colors = null, blurPx = 1, additive = false) {
    return paintSurfaceMask({
      bounds: b,
      surfaces: this.geo.surfaces,
      kinds,
      colors,
      blurPx,
      additive,
    });
  }

  // Animated water (config.water) or the static fallback plane.
  _addWater(geo, group) {
    if (RENDER_CONFIG.water) {
      const foamEnabled = !!this.waterDepth;
      const { meshes, waterMeshes, waterUpdate, setFoamDepth } = buildWater(geo.surfaces, (x, y) => this.hAt(x, y), this.sunDir, foamEnabled);
      meshes.forEach((m) => group.add(m));
      this._waterUpdate = waterUpdate;
      this._waterMeshList = waterMeshes;
      if (foamEnabled) setFoamDepth(this.waterDepth.depthTexture, this.waterDepth.resolution, this.camera.near, this.camera.far);
    } else {
      this._waterMeshes(geo).forEach((m) => group.add(m));
    }
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

  _treeSpots(geo) {
    const spots = [];
    const rnd = mulberry32(1234);
    const CAP = RENDER_CONFIG.treeCap;
    for (const t of geo.trees || []) { if (spots.length >= CAP) break; spots.push({ x: t[0], y: t[1], s: 0.85 + rnd() * 0.5 }); }
    for (const w of geo.woods || []) {
      if (spots.length >= CAP) break;
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (const [x, y] of w) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      for (let gx = minX; gx < maxX; gx += 18) {
        if (spots.length >= CAP) break;
        for (let gy = minY; gy < maxY; gy += 18) {
          if (spots.length >= CAP) break;
          const x = gx + (rnd() - 0.5) * 12, y = gy + (rnd() - 0.5) * 12;
          if (pointInPoly(x, y, w)) spots.push({ x, y, s: 0.7 + rnd() * 0.7 });
        }
      }
    }
    return spots;
  }

  // A jittered band of trees around the course perimeter -> a hazy distant tree-line
  // on the horizon (aerial fog gives the atmospheric falloff). Skips water surfaces.
  _horizonSpots(geo, b) {
    const water = (geo.surfaces || []).filter((s) => s.kind === 'water' && s.poly && s.poly.length >= 3);
    const inWater = (x, y) => { for (const w of water) if (pointInPoly(x, y, w.poly)) return true; return false; };
    const rnd = mulberry32(424242);
    const spots = [];
    const step = 55, rows = 2, rowGap = 26, inset = 40;
    const place = (x, y) => {
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY || inWater(x, y)) return;
      if (rnd() < 0.35) return; // random gaps -> a broken, sparse tree-line, not an enclosing wall
      spots.push({ x, y, s: 0.8 + rnd() * 1.5 }); // wide scale variation -> not a uniform cardboard ring
    };
    for (let r = 0; r < rows; r++) {
      const d = inset + r * rowGap;
      for (let x = b.minX + d; x <= b.maxX - d; x += step) {
        place(x + (rnd() - 0.5) * step, b.minY + d + (rnd() - 0.5) * rowGap);
        place(x + (rnd() - 0.5) * step, b.maxY - d + (rnd() - 0.5) * rowGap);
      }
      for (let y = b.minY + d; y <= b.maxY - d; y += step) {
        place(b.minX + d + (rnd() - 0.5) * rowGap, y + (rnd() - 0.5) * step);
        place(b.maxX - d + (rnd() - 0.5) * rowGap, y + (rnd() - 0.5) * step);
      }
    }
    return spots;
  }

  _addTrees(geo, group) {
    if (!RENDER_CONFIG.foliageTrees) return;
    const coreSpots = this._treeSpots(geo); // on-course trees (no horizon band)
    const spots = coreSpots.slice();
    if (RENDER_CONFIG.horizonTrees) spots.push(...this._horizonSpots(geo, this.bounds));
    if (!spots.length) return;
    const { meshes, windUpdate } = buildCardTrees(spots, (x, y) => this.hAt(x, y), V);
    meshes.forEach((m) => group.add(m));
    this._treeWind = windUpdate;
    if (RENDER_CONFIG.grounding) {
      buildGrounding(spots, (x, y) => this.hAt(x, y), V).meshes.forEach((m) => group.add(m));
    }
    // Pine-straw litter under the on-course trees only (the horizon band is too
    // far to matter and would blow the instance budget).
    if (RENDER_CONFIG.pineStraw) {
      buildPineStraw(coreSpots, (x, y) => this.hAt(x, y), V).meshes.forEach((m) => group.add(m));
    }
  }

  // Extrude OSM building footprints into simple 3D massing — walls + a flat
  // colored roof (ExtrudeGeometry yields two material groups: 0 = caps/roof,
  // 1 = side walls). Buildings are the VERTICAL structure that makes a course
  // read as a real place instead of a textured surface; the clubhouse gets a
  // hero material. Each is seated at the lowest ground under its footprint
  // (sunk 0.6 m) so walls meet a slope without floating. Scenery only
  // (geo.buildings is non-fingerprinted), so a bad footprint must never break
  // the load — guarded per building.
  _addBuildings(geo, group) {
    const list = geo.buildings || [];
    if (!list.length || RENDER_CONFIG.buildings === false) return;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xc8bda6, roughness: 0.92, metalness: 0 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x70604e, roughness: 0.85, metalness: 0 });
    const heroWall = new THREE.MeshStandardMaterial({ color: 0xe9dec6, roughness: 0.82, metalness: 0 });
    const heroRoof = new THREE.MeshStandardMaterial({ color: 0x8c3a2c, roughness: 0.7, metalness: 0 }); // terracotta
    // Pitched (hip) roofs sit on the wall extrusion — double-sided so we don't have
    // to fuss over triangle winding for arbitrary OSM footprints.
    const roofPitch = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    const heroRoofPitch = new THREE.MeshStandardMaterial({ color: 0x8c3a2c, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    // ExtrudeGeometry wants a CCW (positive-area) contour for the cap to face up.
    const ccw = (p) => { let a = 0; for (let i = 0; i < p.length; i += 1) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a >= 0 ? p : p.slice().reverse(); };
    let drawn = 0;
    for (const bld of list) {
      const poly0 = bld.poly;
      if (!poly0 || poly0.length < 3) continue;
      let minH = Infinity, bad = false;
      for (const [x, y] of poly0) { const h = this.hAt(x, y); if (!Number.isFinite(h)) { bad = true; break; } if (h < minH) minH = h; }
      if (bad || !Number.isFinite(minH)) continue;
      const poly = ccw(poly0);
      const shape = new THREE.Shape();
      poly.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
      let g;
      try { g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(2.5, bld.heightM || 5), bevelEnabled: false, steps: 1 }); }
      catch (e) { continue; }
      g.rotateX(-Math.PI / 2);      // extrude +Z -> world +Y (up); footprint (x,y) -> (x, h, -y)
      g.translate(0, minH - 0.6, 0); // sink 0.6 m so walls meet the slope, no float
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, bld.clubhouse ? [heroRoof, heroWall] : [roofMat, wallMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      // Pitched hip roof: fan each footprint edge up to a raised centroid so
      // buildings read as real peaked structures, not flat boxes.
      const topY = (minH - 0.6) + Math.max(2.5, bld.heightM || 5);
      let cx = 0, cyc = 0, bw0 = Infinity, bw1 = -Infinity, bh0 = Infinity, bh1 = -Infinity;
      for (const [x, y] of poly) { cx += x; cyc += y; if (x < bw0) bw0 = x; if (x > bw1) bw1 = x; if (y < bh0) bh0 = y; if (y > bh1) bh1 = y; }
      cx /= poly.length; cyc /= poly.length;
      const roofH = Math.min(6, Math.max(1.6, 0.30 * Math.min(bw1 - bw0, bh1 - bh0)));
      const rp = [];
      for (let i = 0; i < poly.length; i += 1) {
        const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
        rp.push(x0, topY, -y0, x1, topY, -y1, cx, topY + roofH, -cyc);
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      rg.computeVertexNormals();
      const roof = new THREE.Mesh(rg, bld.clubhouse ? heroRoofPitch : roofPitch);
      roof.castShadow = true; roof.receiveShadow = true;
      group.add(roof);
      drawn += 1;
    }
    if (drawn) console.log(`[render] buildings: ${drawn}/${list.length}`);
  }

  // Clumped scatter across rough polygons. Real fescue grows in dense patches
  // with bare gaps, not an even thin spread — so we drop clump centers on the
  // rough, then cluster tufts around each (center-biased disc, trimmed at the
  // rough edge so a clump never spills onto a mown surface). Same tuft budget as
  // a uniform scatter, but it reads far fuller where the grass actually is.
  _grassSpots(geo) {
    if (!RENDER_CONFIG.groundGrass) return [];
    const rough = (geo.surfaces || []).filter((s) => s.kind === 'rough' && s.poly && s.poly.length >= 3);
    if (!rough.length) return [];
    const onRough = (x, y) => { for (const s of rough) if (pointInPoly(x, y, s.poly)) return true; return false; };
    // Bunkers (and water) often sit as islands inside a rough polygon, so "on rough"
    // is true inside them — exclude those so fescue never sprouts in the sand.
    const blocked = (geo.surfaces || []).filter((s) => (s.kind === 'bunker' || s.kind === 'water') && s.poly && s.poly.length >= 3);
    const onBlocked = (x, y) => { for (const s of blocked) if (pointInPoly(x, y, s.poly)) return true; return false; };
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const s of rough) for (const [x, y] of s.poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const spots = [], rnd = mulberry32(8080), CAP = RENDER_CONFIG.grassCap;
    let att = 0;
    while (spots.length < CAP && att++ < CAP * 6) {
      const cx = minX + rnd() * (maxX - minX), cy = minY + rnd() * (maxY - minY);
      if (!onRough(cx, cy)) continue;
      const R = 1.0 + rnd() * 2.5;             // clump radius (m) — tight, bushy patches
      const K = 10 + ((rnd() * rnd() * 26) | 0); // tufts/clump, skewed toward small patches
      for (let k = 0; k < K && spots.length < CAP; k++) {
        const ang = rnd() * Math.PI * 2, rad = Math.pow(rnd(), 0.7) * R; // center-biased
        const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
        if (onRough(x, y) && !onBlocked(x, y)) spots.push({ x, y, s: 0.7 + rnd() * 0.7 });
      }
    }
    return spots;
  }

  _addGrass(geo, group) {
    const spots = this._grassSpots(geo);
    if (!spots.length) return;
    const { mesh, windUpdate } = buildGrass(spots, (x, y) => this.hAt(x, y), V);
    if (mesh) { group.add(mesh); this._grassWind = windUpdate; }
  }

  // Foreground grass-object layer (see config.foregroundGrass). A camera-anchored patch of
  // SHORT, dense, per-instance zone-tinted blades on the mown corridor — fairway/tee/base,
  // never greens (must stay smooth) or rough (has its own fescue). The shader collapses
  // blades past the fade radius, so a patch centered on the ball reads as foreground grass at
  // the orbit camera and never re-triggers the mid/far sub-pixel smear. Re-anchored when the
  // ball moves to a new lie (debounced in _frame).
  _addFairwayGrass(geo, group) {
    if (!RENDER_CONFIG.foregroundGrass) return;
    this._fgGeo = geo; this._fgGroup = group;
    this._fairwayZoneColorFn = this._fairwayZoneColor(geo);
    this._placeFairwayGrass();
  }

  // Per-blade tint = the COLORS hue of the surface zone under it (fairway/tee else base),
  // so blades read matched to the turf they stand on, not one flat carpet color.
  _fairwayZoneColor(geo) {
    const surf = geo.surfaces || [];
    const fairway = surf.filter((s) => s.kind === 'fairway' && s.poly && s.poly.length >= 3);
    const tee = surf.filter((s) => s.kind === 'tee' && s.poly && s.poly.length >= 3);
    const cFair = new THREE.Color(this._pal.fairwayA), cTee = new THREE.Color(this._pal.tee), cBase = new THREE.Color(this._pal.base);
    const onAny = (polys, x, y) => { for (const s of polys) if (pointInPoly(x, y, s.poly)) return true; return false; };
    return (x, y) => (onAny(tee, x, y) ? cTee : onAny(fairway, x, y) ? cFair : cBase);
  }

  _fairwayGrassSpots(geo, cx, cy, radius) {
    const surf = geo.surfaces || [];
    const blocked = surf.filter((s) => ['green', 'bunker', 'water', 'rough', 'range'].includes(s.kind) && s.poly && s.poly.length >= 3);
    const onBlocked = (x, y) => { for (const s of blocked) if (pointInPoly(x, y, s.poly)) return true; return false; };
    const b = this.bounds, spots = [], rnd = mulberry32(1234), CAP = RENDER_CONFIG.foregroundGrassCap;
    let att = 0;
    while (spots.length < CAP && att++ < CAP * 5) {
      const ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * radius; // uniform over the disc
      const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
      if (b && (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY)) continue;
      if (onBlocked(x, y)) continue; // keep off greens/bunkers/water/rough
      spots.push({ x, y, s: 1 });
    }
    return spots;
  }

  _placeFairwayGrass() {
    if (!RENDER_CONFIG.foregroundGrass || !this._fgGeo) return;
    const cx = this.ballSim.x, cy = this.ballSim.y;
    if (this._fairwayGrassMesh) {
      this._fgGroup.remove(this._fairwayGrassMesh);
      this._fairwayGrassMesh.geometry.dispose();
      this._fairwayGrassMesh.material.dispose();
      this._fairwayGrassMesh = this._fairwayGrassWind = null;
    }
    this._fairwayGrassCenter = { x: cx, y: cy };
    const spots = this._fairwayGrassSpots(this._fgGeo, cx, cy, RENDER_CONFIG.foregroundGrassRadius);
    if (!spots.length) return;
    const { mesh, windUpdate } = buildGrass(spots, (x, y) => this.hAt(x, y), V, {
      perTuft: 4, height: RENDER_CONFIG.foregroundGrassHeight, baseWidth: 0.018, segs: 2,
      jitter: 0.15, seed: 1234, colorAt: this._fairwayZoneColorFn,
      cameraFade: { near: RENDER_CONFIG.foregroundGrassFadeNear, far: RENDER_CONFIG.foregroundGrassFadeFar },
    });
    if (mesh) { this._fgGroup.add(mesh); this._fairwayGrassMesh = mesh; this._fairwayGrassWind = windUpdate; }
  }

  // Azalea bushes clustered around ~half the on-course trees (the pine understory
  // is where Augusta's azaleas live) — frames holes with color, and tree spots
  // steer clear of water/bunkers/greens, so generic placement stays plausible.
  _flowerSpots(geo) {
    if (!RENDER_CONFIG.flowers) return [];
    const trees = this._treeSpots(geo);
    if (!trees.length) return [];
    const spots = [], rnd = mulberry32(91), CAP = RENDER_CONFIG.flowerCap;
    for (const t of trees) {
      if (spots.length >= CAP) break;
      if (rnd() > 0.62) continue;           // ~3 in 5 trees get a bed
      const K = 3 + ((rnd() * 4) | 0);      // 3-6 bushes per chosen tree
      for (let k = 0; k < K && spots.length < CAP; k++) {
        const ang = rnd() * Math.PI * 2, rad = 2.5 + rnd() * 4.5; // 2.5-7m ring off the trunk
        spots.push({ x: t.x + Math.cos(ang) * rad, y: t.y + Math.sin(ang) * rad, s: 0.8 + rnd() * 0.6 });
      }
    }
    return spots;
  }

  _addFlowers(geo, group) {
    const spots = this._flowerSpots(geo);
    if (!spots.length) return;
    buildFlowers(spots, (x, y) => this.hAt(x, y), V).meshes.forEach((m) => group.add(m));
  }

  // High-res LIDAR green patches: a finer terrain mesh per patch so the real
  // green relief shows (the base mesh is too coarse to render it). Heights are
  // feathered into the base at the patch edges to kill the seam. The mesh uses a
  // fresh material that references (does not clone) the base turf textures, with
  // a depth bias so the patch always wins over the coarse base — including green
  // depressions that sit BELOW it (a height lift can't fix those; polygonOffset can).
  _addGreenPatches(group, baseMesh) {
    const patches = this.elev && this.elev.patches;
    if (!patches || !patches.length || !baseMesh) return;
    const b = this.bounds, extX = b.maxX - b.minX, extY = b.maxY - b.minY;
    const FEATHER = 4; // m — matches the physics feather in makeTerrain
    // The patch mesh must run the FULL turf shader (tint, fescue desat, the uMask.g
    // green treatment) — a plain slot-clone renders the raw kelly-green splat with
    // none of it, which read as a neon decal once material-first ground landed
    // (invisible before, when the photo drape covered everything at 90%+). Patch UVs
    // are course-relative, so every mask/macro gate lines up with the ground below.
    const mat = this._turfInputs
      ? makeTurfMaterial(this._turfInputs)
      : (() => {
        const bm = baseMesh.material;
        return new THREE.MeshStandardMaterial({
          map: bm.map, normalMap: bm.normalMap, roughnessMap: bm.roughnessMap,
          normalScale: bm.normalScale ? bm.normalScale.clone() : new THREE.Vector2(0.8, 0.8),
          roughness: bm.roughness, metalness: 0, envMapIntensity: bm.envMapIntensity,
        });
      })();
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1;
    // second material instance -> its own texture registrations would double-dispose;
    // the primary turf material owns them (loadCourse traverse dedupes by object, but
    // dispose() on an already-disposed texture is a safe no-op in three anyway)
    for (const p of patches) {
      const { minX, minY, cellM, nx, ny, heights } = p;
      const maxX = minX + (nx - 1) * cellM, maxY = minY + (ny - 1) * cellM;
      const pos = new Float32Array(nx * ny * 3);
      const uv = new Float32Array(nx * ny * 2);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const x = minX + i * cellM, y = minY + j * cellM;
          const baseH = this._sampleGrid(this.elev, x, y);
          const w = Math.min(1, Math.min(x - minX, maxX - x, y - minY, maxY - y) / FEATHER);
          pos[k * 3] = x;
          pos[k * 3 + 1] = baseH + (heights[k] - baseH) * w;
          pos[k * 3 + 2] = -y;
          uv[k * 2] = (x - b.minX) / extX;
          uv[k * 2 + 1] = (y - b.minY) / extY;
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
      const m = new THREE.Mesh(geom, mat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // Render the given surface kinds (e.g. bunkers) as their own polygon meshes
  // draped on the terrain — the boundary becomes a crisp GEOMETRIC edge instead
  // of a blurry low-res splat paint, sharp at any zoom. One shared material.
  _addSurfacePatches(group, kinds, makeMat) {
    const surfs = (this.geo.surfaces || []).filter(
      (s) => kinds.includes(s.kind) && s.poly && s.poly.length >= 3);
    if (!surfs.length) return;
    const b = this.bounds;
    const mat = makeMat(b, this.renderer.capabilities.getMaxAnisotropy());
    const sampler = (x, y) => this.hAt(x, y);
    for (const s of surfs) {
      const ring = densifyRing(s.poly, 3);
      if (ring.length < 3) continue;
      const tris = THREE.ShapeUtils.triangulateShape(
        ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
      if (!tris.length) continue;
      const { pos, uv } = drapeRing(ring, sampler, b, 0.04); // small lift + polygonOffset
      const idx = [];
      for (const t of tris) idx.push(t[0], t[1], t[2]);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geom.setIndex(idx);
      geom.computeVertexNormals();
      // Up-facing fix: triangle winding depends on the polygon orientation AND
      // the sim->three y->-z flip, so normalize to point up.
      const nrm = geom.attributes.normal.array;
      let ny = 0; for (let i = 1; i < nrm.length; i += 3) ny += nrm[i];
      if (ny < 0) { idx.reverse(); geom.setIndex(idx); geom.computeVertexNormals(); }
      const m = new THREE.Mesh(geom, mat);
      m.receiveShadow = true;
      group.add(m);
    }
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
    this._activeHole = hole;
    this._fitShadows(hole);
    this._aimLineUpdate();
    this._clearTrail();
  }

  setBall(p) {
    this.ballSim = { x: p.x, y: p.y };
    const z = this.hAt(p.x, p.y);
    this.ball.position.copy(V(p.x, p.y, z + 0.06));
    this._buildMarkers();
  }

  // Floating yardage markers every 50y down the ball->pin line, drawn as DOM
  // pills positioned each frame by projecting their world point to the screen.
  _buildMarkers() {
    if (!this.markerLayer) return;
    for (const m of this.markers) m.el.remove();
    this.markers = [];
    if (!this.geo) return;
    const bx = this.ballSim.x, by = this.ballSim.y;
    const dx = this.pinSim.x - bx, dy = this.pinSim.y - by;
    const distM = Math.hypot(dx, dy);
    if (distM < 55) return; // putt/short — no markers
    const ux = dx / distM, uy = dy / distM;
    const yd = 0.9144;
    for (let d = 100; d * yd < distM - 11; d += 100) {
      const x = bx + ux * d * yd, y = by + uy * d * yd;
      const el = document.createElement('div');
      el.className = 'dist-marker';
      el.innerHTML = `${d}<span>y</span>`;
      this.markerLayer.appendChild(el);
      this.markers.push({ world: V(x, y, this.hAt(x, y) + 1.4), el });
    }
  }

  _updateMarkers() {
    if (!this.markers.length) return;
    const hide = this.anim || this.camMode === 'static';
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const v = new THREE.Vector3();
    const shown = []; // screen positions already placed, for de-overlap
    for (const m of this.markers) { // ordered nearest -> farthest
      if (hide) { m.el.style.display = 'none'; continue; }
      v.copy(m.world).project(this.camera);
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      let ok = !(v.z > 1 || sx < 6 || sx > w - 6 || sy < 50 || sy > h - 6);
      if (ok) for (const p of shown) if (Math.abs(sy - p.y) < 34 && Math.abs(sx - p.x) < 70) { ok = false; break; }
      if (!ok) { m.el.style.display = 'none'; continue; }
      shown.push({ x: sx, y: sy });
      m.el.style.display = '';
      m.el.style.transform = `translate(-50%,-100%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    }
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
      if (!this._trailMat) this._trailMat = new THREE.LineBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.9 });
      const g = new THREE.BufferGeometry().setFromPoints(a.trailPts);
      this.trail = new THREE.Line(g, this._trailMat); // reuse one material (was allocated per frame)
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

  // ---- free-roam "course creator" camera ----
  // Toggle: seed a ground pivot at the current look point, facing the pin, then fly.
  enterFreeCam(on) {
    if (on && this.camMode !== 'free') {
      if (this.anim) return false; // don't grab the camera mid shot-replay
      this.free.tx = this.lookCur.x;
      this.free.ty = -this.lookCur.z;          // three -> sim north
      this.free.hOff = 0;
      this.free.h = this.hAt(this.free.tx, this.free.ty) + 2;
      this.free.yaw = Math.atan2(this.pinSim.x - this.free.tx, this.pinSim.y - this.free.ty) * 180 / Math.PI;
      this.free.pitch = -28; this.free.dist = 45;
      this.camMode = 'free';
    } else if (!on && this.camMode === 'free') {
      this.camMode = 'idle';
      this.freeKeys = {};
    }
    if (this._freeCamCb) this._freeCamCb(this.camMode === 'free');
    return this.camMode === 'free';
  }

  setFreeCamCallback(cb) { this._freeCamCb = cb; }

  // held WASD/arrows pan the ground pivot (speed scales with zoom); Q/E nudge look height.
  _freeStep(dt) {
    const f = this.free, k = this.freeKeys;
    const yaw = f.yaw * Math.PI / 180, fx = Math.sin(yaw), fy = Math.cos(yaw);
    const rx = Math.cos(yaw), ry = -Math.sin(yaw);
    const sp = Math.max(10, f.dist * 0.8) * dt;
    let mx = 0, my = 0;
    if (k.w || k.arrowup) { mx += fx; my += fy; }
    if (k.s || k.arrowdown) { mx -= fx; my -= fy; }
    if (k.d || k.arrowright) { mx += rx; my += ry; }
    if (k.a || k.arrowleft) { mx -= rx; my -= ry; }
    if (mx || my) { f.tx += mx * sp; f.ty += my * sp; }
    if (k.e) f.hOff += 14 * dt;
    if (k.q) f.hOff = Math.max(-3, f.hOff - 14 * dt);
    f.h = this.hAt(f.tx, f.ty) + 2 + f.hOff;
  }

  _freeTargets() {
    const f = this.free;
    const yaw = f.yaw * Math.PI / 180, pitch = f.pitch * Math.PI / 180;
    const horiz = Math.cos(pitch) * f.dist, up = -Math.sin(pitch) * f.dist;
    const fx = Math.sin(yaw), fy = Math.cos(yaw); // forward (toward the look point)
    this.camPosT.copy(V(f.tx - fx * horiz, f.ty - fy * horiz, f.h + up));
    this.lookT.copy(V(f.tx, f.ty, f.h));
  }

  _frame(capture = null) {
    const fixed = capture && typeof capture === 'object';
    const dt = fixed ? Math.max(0, Number(capture.fixedDelta) || 0) : Math.min(this.clock.getDelta(), 0.05);
    const frameTime = fixed ? (Number(capture.fixedTime) || 0) : this.clock.elapsedTime;
    this._captureFixedTime = fixed ? frameTime : null;

    if (this.anim) this._animStep(dt);

    // 'idle' tracks the ball at address; 'static' (shot tracer) holds the
    // frozen camera that playShot parked behind the ball.
    if (this.camMode === 'idle') this._idleTargets();
    else if (this.camMode === 'free') { this._freeStep(dt); this._freeTargets(); }

    const k = capture?.snapCamera ? 1 : 1 - Math.exp(-4.2 * dt);
    this.camera.position.lerp(this.camPosT, k);
    this.lookCur.lerp(this.lookT, k);
    this.camera.lookAt(this.lookCur);

    // keep ball & pin readable at distance — but ONLY in a play framing, so
    // survey/overview/beauty shots don't get a 26x ball reading as a debug billboard
    const bd = this.camera.position.distanceTo(this.ball.position);
    this.ball.scale.setScalar(ballReadScale(bd, this.camMode, this.anim));
    const pd = this.camera.position.distanceTo(this.pin.position);
    this.pin.scale.setScalar(pinReadScale(pd, this.camMode, this.anim));
    // gameplay aim line is an address-view aid — never in non-play framings
    if (this.aimLine) this.aimLine.visible = isPlayFraming(this.camMode, this.anim);

    this._updateMarkers();
    if (this._treeWind) this._treeWind(frameTime);
    if (this._grassWind) this._grassWind(frameTime);
    if (RENDER_CONFIG.foregroundGrass && this.camMode === 'idle' && this._fairwayGrassCenter) {
      const fdx = this.ballSim.x - this._fairwayGrassCenter.x, fdy = this.ballSim.y - this._fairwayGrassCenter.y;
      if (fdx * fdx + fdy * fdy > 64) this._placeFairwayGrass(); // ball moved > 8m -> re-anchor the foreground patch
    }
    if (this._fairwayGrassWind) this._fairwayGrassWind(frameTime);
    if (this._flagU) this._flagU.value = frameTime;
    if (this._waterUpdate) this._waterUpdate(frameTime);
    if (this.waterDepth && this._terrain) this.waterDepth.prepass(this._terrain, this.camera);
    this.postfx.render();
    if (fixed) {
      this._lastVisualCapture = {
        sequence: (this._lastVisualCapture?.sequence || 0) + 1,
        fixedTime: frameTime,
        renderPath: 'postfx.render',
      };
    }
  }

  visualCaptureStatus() {
    return {
      environment: { ...this.environmentStatus },
      loader: this.loadingTracker.status(),
      postfx: this.postfx ? 'effect-composer' : null,
      geometryReady: !!this.geo,
      shaderCompile: { ...this.shaderCompileStatus },
    };
  }

  renderVisualCaptureStill(frame = {}) {
    const width = Number(frame.width);
    const height = Number(frame.height);
    if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0) {
      this.renderer.setPixelRatio(1);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
      this.postfx.setSize(width, height);
      this.waterDepth?.setSize(width, height);
    }

    // Capture URLs own their render loop. Normal URLs never call this method and
    // keep the existing animation loop untouched.
    this.renderer.setAnimationLoop(null);
    this._animationLoopLive = false;
    if (frame.mode === 'free') {
      this.enterFreeCam(true);
      Object.assign(this.free, frame.pose || {});
      this._freeTargets();
    } else {
      this.enterFreeCam(false);
      this.camMode = 'idle';
      this._idleTargets();
    }
    this._frame({ fixedTime: Number(frame.time) || 0, fixedDelta: 0, snapCamera: true });
    // Synchronize only the still readback path; the interactive render loop
    // remains fully asynchronous.
    this.renderer.getContext().finish();
    return this.visualCaptureDiagnostics();
  }

  _sceneObjectCounts() {
    const counts = { total: 0, visible: 0, meshes: 0, instancedMeshes: 0, lights: 0, cameras: 0 };
    this.scene.traverse((object) => {
      counts.total += 1;
      if (object.visible) counts.visible += 1;
      if (object.isMesh) counts.meshes += 1;
      if (object.isInstancedMesh) counts.instancedMeshes += 1;
      if (object.isLight) counts.lights += 1;
      if (object.isCamera) counts.cameras += 1;
    });
    return counts;
  }

  _rendererInfoSnapshot() {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length || 0,
    };
  }

  visualCaptureDiagnostics({ resetRendererInfo = false } = {}) {
    const info = this.renderer.info;
    if (resetRendererInfo) info.reset();
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererInfo = this._rendererInfoSnapshot();
    return {
      canvas: { width: this.renderer.domElement.width, height: this.renderer.domElement.height },
      camera: {
        mode: this.camMode,
        position: this.camera.position.toArray(),
        lookAt: this.lookCur.toArray(),
      },
      renderer: {
        webglVersion: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        ...rendererInfo,
        drawCalls: rendererInfo.calls,
        infoAutoReset: info.autoReset,
      },
      sceneObjects: this._sceneObjectCounts(),
      postfx: 'effect-composer',
      lastVisualCapture: this._lastVisualCapture ? { ...this._lastVisualCapture } : null,
      fixedCaptureTime: this._captureFixedTime,
      animationLoopLive: this._animationLoopLive,
      environment: { ...this.environmentStatus },
      loader: this.loadingTracker.status(),
    };
  }

  async sampleVisualCapturePerformance(options = {}) {
    const { sampleDuration, performanceClaim, routeFrames } = normalizePerformanceRequest(options);
    const minimumWarmupFrames = performanceClaim ? 300 : 10;
    const minimumWarmupMs = performanceClaim ? 5000 : 1000;
    const info = this.renderer.info;
    const previousAutoReset = info.autoReset;
    this.renderer.setAnimationLoop(null);
    this._animationLoopLive = false;
    this._captureFixedTime = null;
    info.autoReset = false;

    const gl = this.renderer.getContext();
    const isWebGl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const timerExtension = isWebGl2 ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    const pendingQueries = [];
    const gpuSamples = [];
    let issueGpuQueries = true;
    let discardedInvalid = 0;
    let discardedDisjoint = 0;
    let frameWaiter = null;
    const nextFrame = () => new Promise((resolve) => { frameWaiter = resolve; });
    let renderedFrames = 0;

    const applyRouteFrame = (frame) => {
      if (!frame) return;
      if (frame.mode === 'free') {
        this.enterFreeCam(true);
        Object.assign(this.free, frame.pose || {});
        this._freeTargets();
      } else {
        this.enterFreeCam(false);
        this.camMode = 'idle';
        this._idleTargets();
      }
    };

    const collectQueries = () => {
      if (!timerExtension) return;
      const disjoint = !!gl.getParameter(timerExtension.GPU_DISJOINT_EXT);
      const disposition = disjointQueryDisposition({
        disjoint,
        pendingCount: pendingQueries.length,
      });
      if (disposition.discardAll) {
        discardedDisjoint += disposition.discardedDisjoint;
        pendingQueries.splice(0).forEach((query) => gl.deleteQuery(query));
        return;
      }
      for (let index = pendingQueries.length - 1; index >= 0; index -= 1) {
        const query = pendingQueries[index];
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
        pendingQueries.splice(index, 1);
        const nanoseconds = Number(gl.getQueryParameter(query, gl.QUERY_RESULT));
        gl.deleteQuery(query);
        if (!Number.isFinite(nanoseconds) || nanoseconds <= 0) discardedInvalid += 1;
        else gpuSamples.push(nanoseconds / 1e6);
      }
    };

    const renderSampleFrame = () => {
      let query = null;
      if (timerExtension && issueGpuQueries) {
        query = gl.createQuery();
        try {
          gl.beginQuery(timerExtension.TIME_ELAPSED_EXT, query);
        } catch {
          gl.deleteQuery(query);
          query = null;
          discardedInvalid += 1;
        }
      }
      this._frame();
      renderedFrames += 1;
      if (query) {
        gl.endQuery(timerExtension.TIME_ELAPSED_EXT);
        pendingQueries.push(query);
      }
      collectQueries();
    };

    try {
      // Sample the same animation source used by normal play. The callback must
      // keep rendering while hidden: a callback that only waits for another rAF
      // can be suspended by Chromium after still capture even when background
      // throttling is disabled.
      this.renderer.setAnimationLoop((timestamp) => {
        renderSampleFrame();
        const resolve = frameWaiter;
        frameWaiter = null;
        if (resolve) resolve(timestamp);
      });
      const warmupStarted = performance.now();
      while (renderedFrames < minimumWarmupFrames || performance.now() - warmupStarted < minimumWarmupMs) {
        await nextFrame();
      }

      info.reset();
      pendingQueries.splice(0).forEach((query) => gl.deleteQuery(query));
      gpuSamples.length = 0;
      discardedInvalid = 0;
      discardedDisjoint = 0;
      const resetPoint = {
        name: 'after-warmup-before-timed-sample',
        warmupFrames: renderedFrames,
        warmupDurationMs: Number((performance.now() - warmupStarted).toFixed(3)),
        requiredFrames: minimumWarmupFrames,
        requiredDurationMs: minimumWarmupMs,
        autoReset: false,
      };
      const intervals = [];
      const sampleStarted = performance.now();
      let previousTimestamp = null;
      let sampleFrames = 0;
      while (performance.now() - sampleStarted < sampleDuration) {
        const timestamp = await nextFrame();
        if (previousTimestamp !== null) intervals.push(timestamp - previousTimestamp);
        previousTimestamp = timestamp;
        if (routeFrames.length) {
          const progress = Math.min(0.999999, (performance.now() - sampleStarted) / sampleDuration);
          applyRouteFrame(routeFrames[Math.floor(progress * routeFrames.length)]);
        }
        sampleFrames += 1;
      }

      const sampleEnded = performance.now();
      const timedRendererCounts = this._rendererInfoSnapshot();
      issueGpuQueries = false;
      const queryDeadline = performance.now() + 1000;
      while (pendingQueries.length && performance.now() < queryDeadline) {
        await nextFrame();
        collectQueries();
      }
      discardedInvalid += pendingQueries.length;
      pendingQueries.splice(0).forEach((query) => gl.deleteQuery(query));

      const sorted = [...intervals].filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
      const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
      const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
      const median = sorted.length % 2
        ? sorted[Math.floor(sorted.length / 2)]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      const sortedGpu = [...gpuSamples].sort((a, b) => a - b);
      const averageGpu = sortedGpu.reduce((sum, value) => sum + value, 0) / sortedGpu.length;
      const medianGpu = sortedGpu.length % 2
        ? sortedGpu[Math.floor(sortedGpu.length / 2)]
        : (sortedGpu[sortedGpu.length / 2 - 1] + sortedGpu[sortedGpu.length / 2]) / 2;
      const cadenceQualification = classifyAnimationCadence({
        samples: sorted.length,
        medianMs: median,
      });
      if (!cadenceQualification.qualifying) {
        cadenceQualification.recovery = 'Rerun visual:perf with --show-window so rAF is not occlusion-throttled.';
      }
      return {
        evidenceClass: performanceClaim
          ? (cadenceQualification.qualifying ? 'performance' : 'performance-non-qualifying')
          : 'diagnostic-only',
        requestedPerformanceClaim: performanceClaim,
        performanceClaim: performanceClaim && cadenceQualification.qualifying,
        cadenceQualification,
        routeFrames: routeFrames.map((frame) => frame.id || null),
        warmup: resetPoint,
        sample: {
          requestedDurationMs: sampleDuration,
          actualDurationMs: Number((sampleEnded - sampleStarted).toFixed(3)),
          renderedFrames: sampleFrames,
          intervals: sorted.length,
        },
        cpu: sorted.length ? {
          samples: sorted.length,
          averageMs: Number(average.toFixed(3)),
          medianMs: Number(median.toFixed(3)),
          p95Ms: Number(percentile(0.95).toFixed(3)),
          worstMs: Number(sorted.at(-1).toFixed(3)),
          averageFps: Number((1000 / average).toFixed(3)),
          onePercentLowFps: Number((1000 / percentile(0.99)).toFixed(3)),
        } : { samples: 0, reason: 'no-valid-raf-intervals' },
        gpu: timerExtension ? {
          supported: true,
          validSampleCount: sortedGpu.length,
          validSamplesMs: sortedGpu.map((value) => Number(value.toFixed(3))),
          discardedInvalid,
          discardedDisjoint,
          ...(sortedGpu.length ? {
            averageMs: Number(averageGpu.toFixed(3)),
            medianMs: Number(medianGpu.toFixed(3)),
            p95Ms: Number(sortedGpu[Math.min(sortedGpu.length - 1, Math.ceil(sortedGpu.length * 0.95) - 1)].toFixed(3)),
            worstMs: Number(sortedGpu.at(-1).toFixed(3)),
          } : { reason: discardedDisjoint ? 'all-samples-disjoint-or-invalid' : 'no-valid-samples' }),
        } : {
          supported: false,
          reason: isWebGl2 ? 'extension-unavailable' : 'webgl2-unavailable',
          validSampleCount: 0,
          discardedInvalid: 0,
          discardedDisjoint: 0,
        },
        renderer: {
          resetPoint,
          aggregation: 'cumulative-across-postfx-passes-during-timed-sample',
          counts: timedRendererCounts,
          sceneObjects: this._sceneObjectCounts(),
          postfx: 'effect-composer',
        },
      };
    } finally {
      info.autoReset = previousAutoReset;
      this._captureFixedTime = null;
      this._animationLoopLive = true;
      this.renderer.setAnimationLoop(this._liveFrame);
    }
  }

  visualCaptureVegetationChecksums() {
    return vegetationTexturePixelChecksums();
  }

  _inputs() {
    const el = this.renderer.domElement;
    let dragging = false, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (this.camMode === 'idle') {
        this.orbit.yaw += dx * 0.25;
        this.orbit.height = THREE.MathUtils.clamp(this.orbit.height + dy * 0.03, 1.6, 26);
      } else if (this.camMode === 'free') {
        this.free.yaw += dx * 0.3;
        this.free.pitch = THREE.MathUtils.clamp(this.free.pitch - dy * 0.3, -88, -4);
      }
    });
    el.addEventListener('wheel', (e) => {
      if (this.camMode === 'idle') {
        this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * (e.deltaY > 0 ? 1.12 : 0.89), 5, 60);
      } else if (this.camMode === 'free') {
        this.free.dist = THREE.MathUtils.clamp(this.free.dist * (e.deltaY > 0 ? 1.1 : 0.9), 4, 600);
      }
    }, { passive: true });
    // 'c' toggles the free course-creator camera; WASD/arrows + Q/E drive it while active.
    window.addEventListener('keydown', (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === 'c') { this.enterFreeCam(this.camMode !== 'free'); e.preventDefault(); return; }
      if (this.camMode !== 'free') return;
      if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e' || key.startsWith('arrow')) {
        this.freeKeys[key] = true; e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => { this.freeKeys[e.key.toLowerCase()] = false; });
  }
}
