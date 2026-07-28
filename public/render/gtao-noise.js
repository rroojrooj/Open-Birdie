import {
  DataTexture,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

export const DEFAULT_GTAO_NOISE_SEED = 0x6f70656e;

function seededRandom(seed) {
  let state = seed >>> 0;
  return {
    random() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
  };
}

// Mirrors GTAOPass._generateNoise so replacing the texture changes only its
// process-to-process randomness, not the denoise distribution or dimensions.
export function buildGtaoNoiseData({
  size = 64,
  seed = DEFAULT_GTAO_NOISE_SEED,
} = {}) {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('GTAO noise size must be a positive integer');
  if (!Number.isInteger(seed)) throw new TypeError('GTAO noise seed must be an integer');

  const simplex = new SimplexNoise(seededRandom(seed));
  const data = new Uint8Array(size * size * 4);

  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      const offset = (i * size + j) * 4;
      data[offset] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
      data[offset + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
      data[offset + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255;
      data[offset + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
    }
  }

  return { data, size };
}

export function createDeterministicGtaoNoiseTexture(options) {
  const { data, size } = buildGtaoNoiseData(options);
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function replaceGtaoNoiseTexture(gtao, options) {
  const randomTexture = gtao.pdNoiseTexture;
  const deterministicTexture = createDeterministicGtaoNoiseTexture(options);
  gtao.pdNoiseTexture = deterministicTexture;
  gtao.pdMaterial.uniforms.tNoise.value = deterministicTexture;
  randomTexture.dispose();
  return deterministicTexture;
}
