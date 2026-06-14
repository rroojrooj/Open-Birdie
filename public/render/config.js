// Single source of feature flags + quality knobs for the renderer.
// Toggle a system off here to isolate regressions or hit a perf budget.
export const RENDER_CONFIG = {
  // Tier 0 (foundation) — on by default
  hdriEnv: true,
  groundedSky: true,
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
  hdriFile: 'meadow_4k.hdr',
  // Tier 1
  foliageTrees: true,
  windStrength: 0.5, // canopy sway amount
  treeScale: 0.95,   // base scale applied to the ~19m fir model
  treeCap: 450,      // max instanced trees (perf); explicit trees prioritized
  // Later tiers / stretch — off until their tier lands
  pbrTurf: false,
  groundGrass: false,
  gtao: false,
  dof: false,
  volumetricClouds: false,
};
