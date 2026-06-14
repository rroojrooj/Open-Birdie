import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RENDER_CONFIG } from '../public/render/config.js';

test('tier-0 systems default on, heavy/stretch systems default off', () => {
  assert.equal(RENDER_CONFIG.hdriEnv, true);
  assert.equal(RENDER_CONFIG.groundedSky, true);
  assert.equal(RENDER_CONFIG.aerialFog, true);
  assert.equal(RENDER_CONFIG.volumetricClouds, false);
  assert.equal(RENDER_CONFIG.dof, false);
});

test('exposure + env intensity are numbers in sane range', () => {
  assert.ok(RENDER_CONFIG.toneMappingExposure > 0 && RENDER_CONFIG.toneMappingExposure < 3);
  assert.ok(RENDER_CONFIG.environmentIntensity > 0 && RENDER_CONFIG.environmentIntensity <= 2);
});

test('sun direction override defaults to auto (null)', () => {
  assert.equal(RENDER_CONFIG.sunAzimuthDeg, null);
  assert.equal(RENDER_CONFIG.sunAltitudeDeg, null);
});
