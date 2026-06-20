'use strict';
// Phase 1 / D3: the physics terrain reads LIDAR green patches, so a real borrow
// breaks a putt the correct way; and the PHYSICS surface is lightly smoothed so
// sub-metre scan noise can't throw the roll off the true line. Drives the real
// lib/physics.js simulateShot through lib/elevation.js makeTerrain.

const { test } = require('node:test');
const assert = require('node:assert');
const { simulateShot } = require('../lib/physics');
const { makeTerrain } = require('../lib/elevation');

// flat base over 0..200 m at relative 0
const base = { minX: 0, minY: 0, cellM: 10, nx: 21, ny: 21, heights: new Array(21 * 21).fill(0) };

// green patch over x∈[80,120], y∈[80,140] @ 2 m. Borrow slopes DOWN toward +x
// (east), so a putt rolled north breaks east. Optional deterministic high-freq
// noise stands in for LIDAR scan speckle.
function greenPatch(noiseAmp = 0) {
  const minX = 80, minY = 80, cellM = 2, nx = 21, ny = 31, heights = new Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * cellM;
      const borrow = (100 - x) * 0.03; // 3% cross-slope, downhill east
      heights[j * nx + i] = borrow + noiseAmp * Math.sin(i * 1.7) * Math.cos(j * 2.3);
    }
  }
  return { minX, minY, cellM, nx, ny, heights };
}

const PUTT = { speedMph: 8, vla: 0, hla: 0, totalSpin: 0, spinAxis: 0 };
const START = { x: 100, y: 95 };
const onGreen = () => 'green';
const roll = (patch, smooth) =>
  simulateShot(PUTT, START, 0, onGreen, { putt: true, terrain: makeTerrain(base, [patch], { smooth }) });

test('a real green borrow breaks the putt downhill (east)', () => {
  const r = roll(greenPatch(0), false);
  assert.ok(r.end.y > START.y, 'ball rolled down the line (north)');
  assert.ok(r.end.x > START.x, `broke east/downhill, end.x=${r.end.x}`);
  assert.ok(r.offlineYd > 0, `offline right of aim, got ${r.offlineYd}`);
});

test('smoothing recovers the true break from noisy LIDAR (physics surface)', () => {
  const clean = roll(greenPatch(0), false).offlineYd;         // true borrow break
  const sharpNoisy = roll(greenPatch(0.06), false).offlineYd; // raw noise -> jittered
  const smoothNoisy = roll(greenPatch(0.06), true).offlineYd; // D3: smoothed physics
  const errSharp = Math.abs(sharpNoisy - clean);
  const errSmooth = Math.abs(smoothNoisy - clean);
  assert.ok(errSmooth < errSharp,
    `smoothed (${smoothNoisy.toFixed(3)}) should track the true break (${clean.toFixed(3)}) ` +
    `better than raw noisy (${sharpNoisy.toFixed(3)})`);
});
