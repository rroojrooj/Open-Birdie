// Depth pre-pass for water shoreline foam. Renders the course depth with the
// water meshes hidden, into a DepthTexture the water material samples to find
// where terrain sits just under the surface (the shallow/contact zone -> foam).
//
// We never override the WATER material (that path broke the turf shader for GTAO
// — see config.gtao). This pass uses MeshDepthMaterial as a temporary scene
// override so it skips lighting/env/splat work, then restores it immediately —
// the turf's onBeforeCompile program is bypassed, not recompiled.
import * as THREE from 'three';

export function makeWaterDepth(renderer) {
  const size = renderer.getSize(new THREE.Vector2());

  const depthTexture = new THREE.DepthTexture(1, 1);
  depthTexture.type = THREE.UnsignedIntType; // 24-bit; smooth foam over the 0.3..12000m frustum
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;

  const target = new THREE.WebGLRenderTarget(1, 1, {
    depthTexture, depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });

  const resolution = new THREE.Vector2();

  function setSize(w, h) {
    const ratio = renderer.getPixelRatio();
    const W = Math.max(1, Math.floor(w * ratio)), H = Math.max(1, Math.floor(h * ratio));
    target.setSize(W, H);
    resolution.set(W, H); // device pixels, to match gl_FragCoord.xy
  }
  setSize(size.x, size.y);

  // Only the TERRAIN sits under the water, so render just that mesh into the depth
  // target — one draw call. No water to hide (it isn't drawn), no material override
  // (the terrain's own program writes depth fine), so the turf shader is untouched.
  function prepass(terrain, camera) {
    if (!terrain) return;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.clear(true, true, false);
    renderer.render(terrain, camera);
    renderer.setRenderTarget(prevTarget);
  }

  function dispose() { target.dispose(); depthTexture.dispose(); }

  return { depthTexture, resolution, prepass, setSize, dispose };
}
