import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import * as THREE from 'three';
import {
  DEFAULT_GTAO_NOISE_SEED,
  buildGtaoNoiseData,
  createDeterministicGtaoNoiseTexture,
  replaceGtaoNoiseTexture,
} from '../public/render/gtao-noise.js';

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

test('GTAO denoise bytes are stable for the default seed', () => {
  const first = buildGtaoNoiseData();
  const second = buildGtaoNoiseData({ seed: DEFAULT_GTAO_NOISE_SEED });

  assert.equal(first.size, 64);
  assert.equal(first.data.length, 64 * 64 * 4);
  assert.deepEqual(first.data, second.data);
  assert.equal(hash(first.data), '059bf8264469351fd4c4bd3b80ee06196afc58d0aee131d15ae1cf095c8dce3e');
});

test('GTAO denoise bytes differ for a different seed', () => {
  const first = buildGtaoNoiseData({ seed: 1 });
  const second = buildGtaoNoiseData({ seed: 2 });

  assert.notEqual(hash(first.data), hash(second.data));
});

test('GTAO denoise texture matches Three GTAOPass texture contract', () => {
  const texture = createDeterministicGtaoNoiseTexture();

  assert.equal(texture.image.width, 64);
  assert.equal(texture.image.height, 64);
  assert.equal(texture.image.data.length, 64 * 64 * 4);
  assert.equal(texture.format, THREE.RGBAFormat);
  assert.equal(texture.type, THREE.UnsignedByteType);
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  assert.equal(texture.wrapT, THREE.RepeatWrapping);
  assert.equal(texture.needsUpdate, undefined);
  assert.equal(texture.version, 1);
  texture.dispose();
});

test('GTAOPass replacement disposes old noise and leaves replacement owned by the pass', () => {
  let oldDisposeCount = 0;
  let replacementDisposeCount = 0;
  const gtao = {
    pdNoiseTexture: { dispose() { oldDisposeCount += 1; } },
    pdMaterial: { uniforms: { tNoise: { value: null } } },
  };

  const replacement = replaceGtaoNoiseTexture(gtao);
  replacement.addEventListener('dispose', () => { replacementDisposeCount += 1; });

  assert.equal(oldDisposeCount, 1);
  assert.equal(replacementDisposeCount, 0);
  assert.equal(gtao.pdNoiseTexture, replacement);
  assert.equal(gtao.pdMaterial.uniforms.tNoise.value, replacement);

  // GTAOPass.dispose() calls this exact property once.
  gtao.pdNoiseTexture.dispose();
  assert.equal(replacementDisposeCount, 1);
});
