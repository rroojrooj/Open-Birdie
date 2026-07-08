// Terrain turf material. Keeps the painted splat (per-surface zones) as the base
// color, overlays a tiled CC0 PBR grass set (real normal + roughness + blade-detail
// albedo), adds shader mowing stripes gated to a fairway/green mask, and swaps in
// bright CC0 sand on a bunker mask — all on the single terrain mesh.
import * as THREE from 'three';
import { ASSETS } from './assets.js';

const loader = new THREE.TextureLoader();
function tiled(url, srgb, repX, repY, aniso) {
  const t = loader.load(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.anisotropy = aniso;
  return t;
}

// Dedicated sand material for crisp bunker meshes (Tier 1). A plain
// MeshStandardMaterial — no onBeforeCompile — so it stays GTAO-safe and cheap.
// Uses the full CC0 sand PBR set (color + normal + roughness), brightened toward
// bunker-white. polygonOffset so the bunker mesh wins over the base + green collar.
export function makeSandMaterial(bounds, aniso) {
  const extX = bounds.maxX - bounds.minX, extY = bounds.maxY - bounds.minY;
  const tileM = 2.0, repX = extX / tileM, repY = extY / tileM;
  const map = tiled(ASSETS.turf.sand, true, repX, repY, aniso);
  const normalMap = tiled(ASSETS.turf.sandNormal, false, repX, repY, aniso);
  const roughnessMap = tiled(ASSETS.turf.sandRough, false, repX, repY, aniso);
  const mat = new THREE.MeshStandardMaterial({
    map, normalMap, normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap, roughness: 1.0, metalness: 0,
    envMapIntensity: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1.2, polygonOffsetUnits: -1.2,
  });
  mat.color = new THREE.Color(1.02, 0.97, 0.84); // muted greige native sand (real links/waste sand
  // is a grey-tan crushed material ~#b7a98b, NOT bright white — verified vs Chambers Bay photos)
  mat.userData.disposeTextures = [map, normalMap, roughnessMap];
  return mat;
}

export function makeTurfMaterial({ baseMap, mownMask, bunkerMask, bounds, anisotropy, macro = null, courseDry = 0, mownMaskRaw = null, pal = null }) {
  const splatTex = baseMap, maskTex = mownMask, bunkerMaskTex = bunkerMask, aniso = anisotropy;
  // P2a: a RAW (unblurred) mask for the crisp fwidth edge. Falls back to the blurred
  // mask so the headless material test (no raw mask supplied) still builds.
  const maskRawTex = mownMaskRaw || mownMask;
  const extX = bounds.maxX - bounds.minX, extY = bounds.maxY - bounds.minY;
  const tileM = 2.0; // grass texture repeats ~every 2m
  const repX = extX / tileM, repY = extY / tileM;

  const normalMap = tiled(ASSETS.turf.normal, false, repX, repY, aniso);
  const roughnessMap = tiled(ASSETS.turf.rough, false, repX, repY, aniso);
  const detail = tiled(ASSETS.turf.color, true, repX, repY, aniso);
  const sand = tiled(ASSETS.turf.sand, true, repX, repY, aniso);
  maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
  bunkerMaskTex.wrapS = bunkerMaskTex.wrapT = THREE.ClampToEdgeWrapping;
  maskRawTex.wrapS = maskRawTex.wrapT = THREE.ClampToEdgeWrapping;

  const mat = new THREE.MeshStandardMaterial({
    map: splatTex,
    normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap, roughness: 1.0, metalness: 0,
    envMapIntensity: 0.2, // turf is matte — keep sky/sun reflection low so lit slopes don't blow out white
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.uniforms.uDetailRepeat = { value: new THREE.Vector2(repX, repY) };
    shader.uniforms.uMask = { value: maskTex };
    shader.uniforms.uBunker = { value: bunkerMaskTex };
    shader.uniforms.uSand = { value: sand };
    shader.uniforms.uExt = { value: new THREE.Vector2(extX, extY) };
    shader.uniforms.uStripeM = { value: 7.0 }; // mow-band width (m) — a touch wider reads better from the orbit cam
    shader.uniforms.uCourseDry = { value: courseDry }; // P1b: 0 lush parkland .. 1 dry links
    // P2a: crisp-edge inputs — the RAW mask + per-surface palette (linear). The shader
    // composites the surface BASE COLOUR per-fragment gated by a fwidth mask so the
    // green/tan boundary is a crisp ~1px mow line, not the soft splat/tint/collar sum.
    shader.uniforms.uMaskRaw = { value: maskRawTex };
    const PV = (a, d) => new THREE.Vector3(...(Array.isArray(a) ? a : d));
    const P = pal || {};
    shader.uniforms.uPalGreenA = { value: PV(P.greenA, [0.072, 0.275, 0.055]) };
    // Aerial macro layer (optional) — MATERIAL-FIRST since v24: the photo no longer
    // replaces the lit turf. Its blurred low-frequency copy (uMacroLow / uMacroAvg)
    // TINTS the material's hue/value, and the raw photo only crossfades in at TRUE
    // far range where 0.3 m/px beats screen texel density. The tiled PBR detail,
    // mow stripes, grain, and light response all survive at play distance.
    const macroDecl = macro ? `
        uniform sampler2D uMacro; uniform sampler2D uMacroSurfaces; uniform sampler2D uMacroCoverage;
        uniform sampler2D uMacroLow; uniform vec3 uMacroAvg; uniform float uMacroPhotoFar;
        uniform vec2 uMacroMin; uniform vec2 uMacroSize; uniform vec2 uMacroWeights; uniform vec2 uCourseMin;` : '';
    // NDVI class-map union (runtime NDVI classification). The class-map rides the
    // AERIAL bounds (uMacroMin/uMacroSize), NOT the terrain bounds the OSM masks use,
    // so it's sampled at clsUv (course-world → aerial-UV), never vMapUv. R = NDVI-
    // detected mown fairway (OSM may have missed), B = NDVI-detected sand. We union
    // (max) these INTO the existing gates so it can only ADD surface, never remove —
    // the _blackTex default (course with no classmap) makes cls.r=cls.b=0 → clean
    // no-op → OSM-only behavior preserved. Sampled BEFORE the stripe block on purpose:
    // the stripes key off `m`, so widening the mown gate here is what puts stripes on
    // NDVI-detected fairway. When there's no macro, `cls` is a zero vec4 so the later
    // sand-union line references a defined symbol in BOTH program variants.
    const macroPre = macro ? `
          vec2 clsUv = (uCourseMin + vMapUv * uExt - uMacroMin) / uMacroSize;
          vec4 cls = (clsUv.x >= 0.0 && clsUv.x <= 1.0 && clsUv.y >= 0.0 && clsUv.y <= 1.0)
            ? texture2D(uMacroSurfaces, clsUv) : vec4(0.0);
          m = max(m, cls.r);        // extend the mown gate onto NDVI-detected fairway` : `
          vec4 cls = vec4(0.0);`;
    const macroBlend = macro ? `
          { vec2 wXY = uCourseMin + vMapUv * uExt;
            vec2 mUv = (wXY - uMacroMin) / uMacroSize;
            if (mUv.x >= 0.0 && mUv.x <= 1.0 && mUv.y >= 0.0 && mUv.y <= 1.0) {
              // Feather across the rect edge so the layer dissolves into procedural
              // turf instead of clipping at a hard rectangle.
              vec2 edgeM = min(mUv, 1.0 - mUv) * uMacroSize;
              float edgeW = smoothstep(0.0, 7.0, min(edgeM.x, edgeM.y) + (tNoise(wXY * 0.15) - 0.5) * 5.0);
              float mvalid = texture2D(uMacroCoverage, mUv).r;
              // Two separate distance curves: the tint ramps over the mid-range and owns
              // it; the RAW photo only crossfades in past the aiming corridor (at the
              // default framing the player reads the ground at ~25-150 m, so the photo
              // band starts at 60 m — 0.3 m/px only beats screen texels ~100 m+ out).
              float tintFar  = smoothstep(20.0, 60.0, length(vViewPosition));
              float photoFar = smoothstep(60.0, 150.0, length(vViewPosition));
              // CHROMATIC TRANSFER — the photo's low-frequency hue/value modulates the
              // LIT turf instead of replacing it. uMacroLow is a blurred copy (baked
              // capture-day shadows and sub-30cm detail are gone), normalized by the
              // playable-ground mean so the tint averages ~1.0; the material keeps its
              // own value structure, stripes, and light response.
              vec3 tRaw = texture2D(uMacroLow, mUv).rgb / max(uMacroAvg, vec3(0.03));
              // CHROMA-LIMITED LUMA-LEAN: take the photo's VALUE fully, but its HUE only
              // in proportion to how far it strays from neutral. OSM-unmapped water /
              // cart paths / roofs print their saturated colour straight onto the grass
              // (a teal 'lake' painted on turf, white 'fog' smears in the corridor); they
              // are HIGH-chroma outliers, so a soft limiter crushes them to value shifts
              // while normal fairway-vs-dune tan/green drift (LOW chroma) passes through.
              float tL = dot(tRaw, vec3(0.299, 0.587, 0.114));
              vec3 chroma = tRaw - tL;
              float keep = 0.62 / (1.0 + 2.4 * length(chroma));
              vec3 tint = clamp(tL + chroma * keep, 0.62, 1.32);
              float tw = mvalid * edgeW * mix(uMacroWeights.x, uMacroWeights.y, tintFar);
              // Greens keep their authored colour; mown fairway keeps its mow structure —
              // pull the tint back on BOTH so the manicured signal (stripes, green
              // treatment) isn't washed flat by the photo. The photo PLACES the surface;
              // the material grooms it. P2a: suppress the tint across the green VICINITY
              // (gVic, a ~4 m dilation) not just on-green — the low-freq aerial otherwise
              // smears a soft green halo just OUTSIDE the crisp mow line the base composite
              // made. gVic fades out so the tint returns to full on the open fescue.
              tw *= clamp(1.0 - 0.9 * gVic - 0.35 * m, 0.0, 1.0);
              grass *= mix(vec3(1.0), tint, tw);
              // FAR PHOTO CROSSFADE — keeps the shipped "real place" overview (raw RGB;
              // a global de-light flattens real fairway/dune/sand albedo into milky grey
              // — tried, reverted). A sliver of blade grain (dl) for micro-texture.
              vec3 photo = texture2D(uMacro, mUv).rgb * (0.86 + 0.30 * dl);
              // P1b: on dry courses lower the far-photo weight so the lit TAN turf carries
              // the overview instead of the green summer aerial washing back over it.
              grass = mix(grass, photo, mvalid * edgeW * uMacroPhotoFar * photoFar * (1.0 - 0.7 * uCourseDry));
            } }` : '';
    if (macro) {
      shader.uniforms.uMacro = { value: macro.albedo };
      shader.uniforms.uMacroSurfaces = { value: macro.surfaces };
      shader.uniforms.uMacroCoverage = { value: macro.coverage };
      // HD-bundle macros have no low/avg — fall back to the ortho itself + a neutral
      // grey mean so the vec3 uniform upload never dereferences undefined (a per-frame
      // TypeError that kills the scene on HD courses whose course aerial failed).
      shader.uniforms.uMacroLow = { value: macro.low ?? macro.albedo };
      shader.uniforms.uMacroAvg = { value: macro.avg ?? new THREE.Vector3(0.2159, 0.2159, 0.2159) };
      shader.uniforms.uMacroPhotoFar = { value: macro.photoFar ?? 0.88 };
      shader.uniforms.uMacroMin = { value: new THREE.Vector2(macro.bounds.minX, macro.bounds.minY) };
      shader.uniforms.uMacroSize = { value: new THREE.Vector2(macro.bounds.maxX - macro.bounds.minX, macro.bounds.maxY - macro.bounds.minY) };
      shader.uniforms.uMacroWeights = { value: new THREE.Vector2(macro.closeWeight ?? 0.25, macro.farWeight ?? 0.6) };
      shader.uniforms.uCourseMin = { value: new THREE.Vector2(bounds.minX, bounds.minY) };
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetail; uniform vec2 uDetailRepeat;
        uniform sampler2D uMask; uniform sampler2D uBunker; uniform sampler2D uSand;
        uniform sampler2D uMaskRaw; uniform vec3 uPalGreenA;
        uniform vec2 uExt; uniform float uStripeM; uniform float uCourseDry;
        // Procedural turf grain — evaluated from world XZ so it stays crisp at ANY
        // zoom. A tiled grass photo mip-blurs to a flat average from the elevated
        // orbit camera (the "Minecraft" smoothness); world-space value noise doesn't.
        float tHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tNoise(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          float a = tHash(i), b = tHash(i + vec2(1.0, 0.0));
          float c = tHash(i + vec2(0.0, 1.0)), d = tHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float tFbm(vec2 p){
          float s = 0.0, a = 0.5;
          for (int k = 0; k < 4; k++){ s += a * tNoise(p); p *= 2.03; a *= 0.5; }
          return s;
        }${macroDecl}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
        {
          // grass path: splat zone color modulated by tiled blade detail + mow stripes
          vec3 gd = texture2D(uDetail, vMapUv * uDetailRepeat).rgb;
          float dl = dot(gd, vec3(0.299, 0.587, 0.114));
          // P2a CRISP EDGES: the visible surface->surface boundary is the SUM of three
          // soft layers (soft splat base, ~1.8 m collar dilation, low-freq aerial tint).
          // Override the BASE COLOUR at the boundary with the palette colour, gated by a
          // fwidth-AA mask off the RAW (unblurred) mask channels. fwidth collapses the
          // mask's ramp to a ~1px mow line AT the polygon edge regardless of the mask's
          // 0.45 m/px resolution, so the boundary reads crisp instead of airbrushed.
          // One raw-mask sample: .r = mown (fairway/tee/green), .g = green only.
          vec4 mkRaw = texture2D(uMaskRaw, vMapUv);
          float gRaw = mkRaw.g, mRaw = mkRaw.r;
          float gAA = max(fwidth(gRaw), 1e-5);
          float gCrisp = smoothstep(0.5 - gAA, 0.5 + gAA, gRaw);
          float mAA = max(fwidth(mRaw), 1e-5);
          float mCrisp = smoothstep(0.5 - mAA, 0.5 + mAA, mRaw); // crisp mown (fairway) edge
          // P2a Task 2 — GREEN COLLAR/FRINGE: a ~0.8 m apron ring just OUTSIDE the crisp
          // putting-surface edge. An 8-tap dilation of the RAW green mask is a soft ramp
          // (the collar's soft OUTER edge into the rough); (1-gCrisp) gives the crisp INNER
          // mow line; distance-faded (a play/mid feature — the far photo owns past ~60 m).
          float gDistFade = 1.0 - smoothstep(45.0, 70.0, length(vViewPosition));
          vec2 co = vec2(0.8) / uExt;
          float gDil = (gRaw
            + texture2D(uMaskRaw, vMapUv + vec2(co.x, 0.0)).g + texture2D(uMaskRaw, vMapUv - vec2(co.x, 0.0)).g
            + texture2D(uMaskRaw, vMapUv + vec2(0.0, co.y)).g + texture2D(uMaskRaw, vMapUv - vec2(0.0, co.y)).g
            + texture2D(uMaskRaw, vMapUv + co).g + texture2D(uMaskRaw, vMapUv - co).g
            + texture2D(uMaskRaw, vMapUv + vec2(co.x, -co.y)).g + texture2D(uMaskRaw, vMapUv + vec2(-co.x, co.y)).g) * (1.0 / 9.0);
          float collarBand = clamp(gDil, 0.0, 1.0) * (1.0 - gCrisp) * gDistFade;
          // Base-colour stack: rough(splat) -> collar apron -> putting surface. The green
          // gets a full crisp override (a distinct putting colour); the collar an apron green
          // (lighter + warmer) UNDER it; the fairway gets NO base override (splat is already
          // ~crisp; forcing dry-olive recolours + darkens shaded slopes — its soft cue is the
          // STRIPE fade, crisped below via mCrisp). Compositing the collar in baseCol means
          // the downstream grain / warm-mix / sun-rake / desat all apply to it, so it reads
          // as real mown grass, not a flat decal.
          vec3 collarCol = clamp(uPalGreenA * vec3(1.25, 1.15, 0.90), 0.0, 1.0);
          vec3 baseCol = mix(diffuseColor.rgb, collarCol, collarBand);
          baseCol = mix(baseCol, uPalGreenA, gCrisp);
          vec3 grass = baseCol * (0.72 + 0.48 * dl);
          // inject a little of the blade's own chroma so a zone isn't one flat tint
          // (green/yellow flecks); clamped so dark blade pixels can't blow up the hue
          grass *= mix(vec3(1.0), clamp(gd / max(dl, 0.1), 0.6, 1.5), 0.16);
          vec4 mk = texture2D(uMask, vMapUv);
          float m = mk.r;                 // mown gate — semantics unchanged
          float g = mk.g;                 // green gate — packed channel (.g = greens only)
          // P2a: a GREEN-VICINITY membership (soft ~4 m dilation of the crisp green) used
          // ONLY to suppress the low-freq aerial tint near greens. uMacroLow is blurred
          // ~5 m, so the green oval smears a soft GREEN halo just OUTSIDE the crisp mow
          // line — knocking the tint down in the vicinity is what keeps the boundary crisp.
          vec2 vo = vec2(4.0) / uExt;
          float gVic = (texture2D(uMaskRaw, vMapUv + vec2(vo.x, 0.0)).g + texture2D(uMaskRaw, vMapUv - vec2(vo.x, 0.0)).g
                      + texture2D(uMaskRaw, vMapUv + vec2(0.0, vo.y)).g + texture2D(uMaskRaw, vMapUv - vec2(0.0, vo.y)).g) * 0.25;
          gVic = max(gVic, gCrisp);
          // Union the NDVI class-map into the mown gate BEFORE the stripe block (see
          // macroPre): widens the mown gate onto NDVI-detected fairway OSM missed; cls is
          // also reused by the sand union below (kept inside #ifdef USE_MAP, GTAO-safe).${macroPre}
          // P2a: the green CHARACTER (checker/contour/sheen roll below) rides the CRISP
          // membership so it stops at the same mow line as the base colour. (v29 checker +
          // contour still apply INSIDE where gCrisp==1, just with a sharp edge.) The collar
          // apron is composited above in baseCol (gDil / collarBand computed there).
          float gEdge = gCrisp;                                  // crisp green membership
          float wx = vMapUv.x * uExt.x, wy = vMapUv.y * uExt.y;
          // procedural grain: fine "tooth" (~0.5-4m) + broad patches (~8-20m), so the
          // turf reads as real grass at the orbit camera instead of a flat plastic
          // sheet. Strong on purpose — this is the fix for the "Minecraft" look.
          // Multi-scale variation so the field is never the same twice (real grass
          // isn't). fbm clusters near its mean, so use a big gain (re-center ~0.47).
          float fine  = tFbm(vec2(wx, wy) * 0.40) - 0.47;        // ~0.7-3m blade grain
          float broad = tFbm(vec2(wy, wx) * 0.10 + 11.3) - 0.47; // ~8-15m growth/wear patches
          float zone  = tFbm(vec2(wx, wy) * 0.026 + 3.7) - 0.47; // ~30-80m big regions
          // Manicured rebalance (Phase 2): the loud mid-scale grain read as blotch/wear
          // and BURIED the mow stripes — the opposite of manicured. Tame fine+broad,
          // keep the large zone (it survives the orbit-cam mip-collapse and carries the
          // lush/dry character below). Clean base + bold stripes = the "pro sim" read.
          grass *= 1.0 + 0.26 * fine + 0.12 * broad + 0.20 * zone; // GENTLE — stacked mottling read as churned "warzone" mud on hilly holes
          // big regions also shift the grass CHARACTER — lush deep-green <-> dry
          // yellow-green — so different parts of the course read as different grass,
          // not one uniform tone stamped edge to edge.
          // P1b: on dry/links courses the tan comes from the base palette, so pull the
          // noise warm-endpoint toward neutral by uCourseDry — else the tan base x warm
          // multiplier double-counts and overshoots past the target gold-tan.
          vec3 warmEnd = mix(vec3(1.13, 1.03, 0.74), vec3(1.0, 1.0, 0.96), uCourseDry * 0.7);
          grass *= mix(vec3(0.93, 1.0, 0.9), warmEnd,
                       clamp(zone * 1.7 + 0.5, 0.0, 1.0)); // lush green <-> golden tan-fescue patches
          grass.r *= 1.0 + 0.10 * broad;                        // finer warm/cool drift on top
          grass.b *= 1.0 - 0.07 * broad;
          // Mowing stripes — the dominant "manicured" signal, fairway/green only.
          // Softer smoothstep ramps give the mower-sheen gradient (not hard bars). A
          // BOLD primary set reads as light/dark bands from the orbit camera; a fainter,
          // wider cross set keeps the pattern alive when you sight straight down the
          // primary axis (a single direction vanishes when you look along it).
          float band = sin((wx * 0.82 + wy * 0.57) * (3.14159265 / uStripeM));
          float stripe = smoothstep(-0.42, 0.42, band) * 2.0 - 1.0;
          float band2 = sin((wx * -0.55 + wy * 0.84) * (3.14159265 / (uStripeM * 1.7)));
          float stripe2 = smoothstep(-0.5, 0.5, band2) * 2.0 - 1.0;
          // Bolder primary set — the photo tint no longer washes it flat (pulled back on
          // mown ground above), so the grooming cue can carry. Fairway only (green +
          // collar suppressed; the green has its own tighter checker below).
          // DISTANCE-FADE (v30): mow stripes are a PLAY-scale grooming cue — full near the
          // player, gone by survey/overview range. Without this the grid over-reads as an
          // artificial pattern at altitude now that the lowered courseAerialPhotoFar lets
          // the lit relief (and the stripes) show through instead of a flat far photo.
          float sFade = 1.0 - smoothstep(120.0, 280.0, length(vViewPosition));
          // P1b: links are lightly mown — scale stripe strength down (to a low, non-zero
          // floor) by uCourseDry; parkland (0) keeps the bold set.
          // P2a: gate the stripes on the CRISP mown edge (mCrisp) so they stop at the mow
          // line instead of the soft ~1 m fade; keep the NDVI union (cls.r) for coverage
          // OSM lacks (its feather is reconciled in Task 3).
          grass *= 1.0 + (0.38 * stripe + 0.17 * stripe2) * max(mCrisp, cls.r) * (1.0 - 0.85 * g - 0.6 * collarBand) * sFade * (1.0 - 0.7 * uCourseDry);
          // GREEN (v29): calm fine grain + a SUBTLE checker mow + a gentle contour roll,
          // all gated by the SOFT edge (gEdge) so the putting-surface character fades
          // across the collar instead of at a hard line. Checker dropped 0.15 -> 0.09 (the
          // bold grid read as a blocky checkerboard from the orbit cam); a low-freq value
          // roll gives the green a shaped, non-uniform read instead of a flat disc.
          vec3 gdF = texture2D(uDetail, vMapUv * uDetailRepeat * 3.0).rgb;
          float dlF = dot(gdF, vec3(0.299, 0.587, 0.114));
          grass = mix(grass, grass * (0.92 + 0.16 * dlF), gEdge);
          float gb1 = sin((wx * 0.94 + wy * 0.34) * (3.14159265 / (uStripeM * 0.30)));
          float gb2 = sin((wx * -0.34 + wy * 0.94) * (3.14159265 / (uStripeM * 0.30)));
          grass *= 1.0 + 0.09 * ((smoothstep(-0.6, 0.6, gb1) - 0.5) + (smoothstep(-0.6, 0.6, gb2) - 0.5)) * gEdge * sFade;
          float gRoll = tFbm(vec2(wx, wy) * 0.06 + 7.0) - 0.5;   // ~16 m gentle undulation
          grass *= 1.0 + 0.05 * gRoll * gEdge;                  // shaped green, not a flat disc
          // Procedural sun-play — directional shading from a low-frequency undulation
          // field so the sun visibly rakes across gentle rolls instead of lighting a
          // flat sheet. The DIRECTIONAL gradient (one flank of a roll lit, the other
          // shaded) is what reads as a lit 3D surface; the isotropic grain above only
          // reads as texture. Faked in albedo — cheap, GTAO-safe, turf normal is ~flat.
          vec2 sp = vec2(wx, wy) * 0.085;                  // ~12m roll wavelength (survives distance)
          float gx = tFbm(sp + vec2(0.07, 0.0)) - tFbm(sp - vec2(0.07, 0.0));
          float gy = tFbm(sp + vec2(0.0, 0.07)) - tFbm(sp - vec2(0.0, 0.07));
          vec2 sunDir = normalize(vec2(0.55, -0.84));      // HDRI sun's horizontal bearing
          float rake = clamp((gx * sunDir.x + gy * sunDir.y) * 7.0, -0.6, 0.6);
          grass *= 1.0 + 0.09 * rake;                      // GENTLE — 0.22 was carving dark shade-bands into the hills
          // Pull the radioactive kelly-green toward muted, warm tan-green fescue (Bandon
          // links is firm golden-tan, not astroturf emerald). Desaturate + warm.
          float gLum = dot(grass, vec3(0.299, 0.587, 0.114));
          grass = mix(grass, vec3(gLum * 0.85) * vec3(1.1, 1.0, 0.8), 0.4); // *0.85 darkens so desaturating doesn't LIGHTEN the green to pale
          ${macroBlend}
          // Soft highlight rolloff: light mown/aerial areas + mow-stripe peaks were
          // washing out to pale rectangles. Compress grass values above ~0.66.
          grass = grass / (1.0 + 0.5 * max(vec3(0.0), grass - 0.66));
          // sand path: real tiled sand toned to muted GREIGE native sand (was brightened
          // toward bunker-white *1.28 — real links/waste sand is grey-tan ~#b7a98b, verified
          // vs Chambers Bay photos; white sand read as manufactured/wrong).
          vec3 sand = texture2D(uSand, vMapUv * uDetailRepeat).rgb;
          sand = mix(sand, vec3(0.72, 0.68, 0.58), 0.18) * 1.04;
          // Union NDVI-detected sand (cls.b) into the OSM bunker mask, but only OUTSIDE
          // mown ground — m is post-union here, so "no sand where OSM- or NDVI-mown".
          // P2a: crisp the OSM bunker edge with fwidth AA so the sand->grass boundary is a
          // ~1px line, killing the soft desaturated "sand halo" band the blurred mask left
          // around each bunker. (The NDVI cls.b feather stays; Task 3 reconciles it.)
          float bRaw = texture2D(uBunker, vMapUv).r;
          float bAA = max(fwidth(bRaw), 1e-5);
          float bCrisp = smoothstep(0.5 - bAA, 0.5 + bAA, bRaw);
          float bm = max(bCrisp, cls.b * (1.0 - m));
          diffuseColor.rgb = mix(grass, sand, bm);
        }
        #endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // Turf is near-Lambertian — force it MATTE everywhere. The old mown-surface
        // roughness reduction + sky reflection produced the wet-plastic specular blowout
        // on sunlit slopes (the big white smear). A high roughness floor kills it.
        roughnessFactor = clamp(roughnessFactor, 0.9, 1.0);
        // GREEN sheen: putting surfaces are the one turf with a real (subtle) specular
        // read. Explicit USE_MAP guard — this chunk has none of its own, and GTAO's
        // normal-pass recompile must never see vMapUv unguarded.
        #ifdef USE_MAP
        roughnessFactor = mix(roughnessFactor, 0.84, texture2D(uMask, vMapUv).g);
        #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // Specular sheen: tilt the shading normal by a low-frequency undulation field so
        // the sun glint + sky reflection ROLL across the turf as the camera moves (the
        // wet-lush pro-sim sheen). World XZ from the splat UV; nudge the view-space
        // normal toward the undulation downslope. vMapUv is defined (USE_MAP) so this
        // stays GTAO-safe; the tilt is gentle so distant turf doesn't shimmer.
        {
          float snwx = vMapUv.x * uExt.x, snwy = vMapUv.y * uExt.y;
          // SMOOTH single-octave noise (not fbm): broad rolls only, no fine facets —
          // fine facets + a sharp specular lobe are what glitter without TAA. Broad
          // rolls give soft sheen BANDS on the flanks, so we can afford a lower
          // roughness (below) for a sheen that actually reads.
          vec2 snp = vec2(snwx, snwy) * 0.045;   // ~22m smooth rolls
          float sgx = tNoise(snp + vec2(0.12, 0.0)) - tNoise(snp - vec2(0.12, 0.0));
          float sgy = tNoise(snp + vec2(0.0, 0.12)) - tNoise(snp - vec2(0.0, 0.12));
          vec3 tiltV = (viewMatrix * vec4(-sgx, 0.0, -sgy, 0.0)).xyz;
          normal = normalize(normal + tiltV * 0.12); // tiny: gentle form only — strong tilt + low roughness was the wet-plastic glare
          // Meso-relief (lever 3): procedural ~1.8 m hummocks BETWEEN the blade normalMap and
          // the 22 m sheen rolls, so turf reads as an undulating surface, not a flat sheet.
          // Distance-faded past ~18 m (no shimmer); modulates DIFFUSE only (roughness floor 0.9
          // kills the specular sparkle that would otherwise glitter without TAA).
          float me = 0.35, mh0 = tFbm(vec2(snwx, snwy) * 0.55);
          float mhx = tFbm((vec2(snwx, snwy) + vec2(me, 0.0)) * 0.55);
          float mhy = tFbm((vec2(snwx, snwy) + vec2(0.0, me)) * 0.55);
          vec3 mTilt = (viewMatrix * vec4(-(mhx - mh0) / me, 0.0, -(mhy - mh0) / me, 0.0)).xyz;
          normal = normalize(normal + mTilt * (0.18 * (1.0 - smoothstep(18.0, 55.0, length(vViewPosition)))));
        }`);
  };
  mat.customProgramCacheKey = () => (macro ? 'turf-grain-v34-macro' : 'turf-grain-v34');
  // textures injected via onBeforeCompile (+ the canvas masks) aren't reachable from
  // the standard material slots, so register them for disposal on course reload.
  mat.userData.disposeTextures = [detail, sand, maskTex, bunkerMaskTex, ...(mownMaskRaw ? [maskRawTex] : [])];
  return mat;
}
