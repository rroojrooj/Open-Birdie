import * as THREE from 'three';
import { RENDER_CONFIG } from './config.js';

// Exponential-squared fog tinted to the HDRI horizon = real aerial perspective,
// not a flat grey veil. No hard far-plane cutoff (unlike linear THREE.Fog).
export function makeAerialFog(horizonColor) {
  return new THREE.FogExp2(horizonColor, RENDER_CONFIG.fogDensity);
}
