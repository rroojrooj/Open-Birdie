// Single source of feature flags + quality knobs for the renderer.
// Toggle a system off here to isolate regressions or hit a perf budget.
export const RENDER_CONFIG = {
  // Tier 0 (foundation) — on by default
  hdriEnv: true,
  groundedSky: false, // off with a puresky HDRI (it has no ground detail to project — was a white band)
  aerialFog: true,
  // Tier 0 tunables (rebalanced empirically in Task 7)
  toneMappingExposure: 0.6,
  environmentIntensity: 1.0,
  sunIntensity: 2.0,
  fogDensity: 0.00016,
  skyboxHeight: 30, // GroundedSkybox projection height (world meters); tuned in Task 7
  // Sun direction: null = auto-estimate from the HDRI's brightest texel.
  // Set BOTH (degrees) to override when the estimate is wrong on a diffuse HDRI (D2).
  sunAzimuthDeg: null,
  sunAltitudeDeg: null,
  hdriFile: 'puresky_4k.hdr',
  // Tier 1
  foliageTrees: true, // card-foliage conifers (see tree-cards.js)
  grounding: true,    // contact-shadow decal blobs under trees (see grounding.js)
  windStrength: 0.5,  // canopy sway amount
  treeScale: 1.0,     // base scale on the 12m reference card-tree (~12m trees)
  treeCap: 450,      // max instanced trees (perf); explicit trees prioritized
  // Later tiers / stretch — off until their tier lands
  pbrTurf: false,
  groundGrass: true,
  grassCap: 55000,  // max fescue tufts on the rough (× blades-per-tuft; perf)
  grassHeight: 0.85, // base blade height (m), jittered per instance
  gtao: false, // deferred: GTAO's normal-pass recompiles the onBeforeCompile turf material without vMapUv. Needs a proper integration (depth-derived normals / material exclusion).
  colorGrade: true, // cinematic grade + vignette pass (after OutputPass)
  water: true, // animated water: analytic ripples + fresnel + sun glitter (else static plane)
  dof: false,
  volumetricClouds: false,
};
