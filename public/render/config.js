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
  fogDensity: 0.00019, // FogExp2 to the horizon colour — soft aerial recession, no hard far edge
  skyboxHeight: 30, // GroundedSkybox projection height (world meters); tuned in Task 7
  // Sun direction: null = auto-estimate from the HDRI's brightest texel.
  // Set BOTH (degrees) to override when the estimate is wrong on a diffuse HDRI (D2).
  sunAzimuthDeg: null,
  sunAltitudeDeg: null,
  hdriFile: 'puresky_4k.hdr',
  // Tier 1
  foliageTrees: true, // card-foliage conifers (see tree-cards.js)
  grounding: true,    // contact-shadow decal blobs under trees (see grounding.js)
  pineStraw: true,    // warm pine-straw litter mat under on-course trees (see vegetation.js)
  flowers: true,      // azalea-style flowering bushes clustered at the tree lines
  flowerCap: 2000,    // max instanced flower bushes (perf)
  props: true,        // course props — bunker rakes (see props.js)
  windStrength: 0.5,  // canopy sway amount
  treeScale: 1.0,     // base scale on the 12m reference card-tree (~12m trees)
  treeCap: 450,      // max instanced trees (perf); explicit trees prioritized
  horizonTrees: true, // jittered tree band around the course perimeter (distant tree-line)
  // Later tiers / stretch — off until their tier lands
  pbrTurf: false,
  crispBunkers: true, // bunkers as their own crisp polygon meshes (sharp sand edges, real sand PBR)
  groundGrass: true,
  grassCap: 55000,  // max fescue tufts on the rough (× blades-per-tuft; perf)
  grassHeight: 0.85, // base blade height (m), jittered per instance
  gtao: true, // contact AO (grounding). If the turf goes black, GTAO's normal pass recompiled the onBeforeCompile shader without vMapUv — fall back to SSAO via a material-override prepass.
  colorGrade: true, // cinematic grade + vignette pass (after OutputPass)
  water: true, // animated water: analytic ripples + fresnel + sun glitter (else static plane)
  waterFoam: true, // shoreline foam via a depth pre-pass (wet line where water meets terrain)
  waterReflect: true, // per-pond planar reflection (trees/banks mirror in the water; frustum-culled)
  dof: false,
  volumetricClouds: false,
};
