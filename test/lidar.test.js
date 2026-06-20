'use strict';
// Pure/offline tests for the LIDAR patch sampler. The network fetch (fetchPatch)
// is verified separately against the live 3DEP service, not here — npm test
// stays offline and deterministic.

const { test } = require('node:test');
const assert = require('node:assert');
const { makePatchSampler } = require('../lib/lidar');

// 2x2 patch over a 100x100 mercator square. Row 0 is the top (y = ymax).
//   top row    (y=ymax): [TL=0,  TR=10]
//   bottom row (y=ymin): [BL=20, BR=30]
const patch = {
  xmin: 0, ymin: 0, xmax: 100, ymax: 100, width: 2, height: 2,
  heights: new Float32Array([0, 10, 20, 30]),
};
const sample = makePatchSampler(patch);

test('corners return their exact pixel values', () => {
  assert.strictEqual(sample(0, 100), 0);   // top-left
  assert.strictEqual(sample(100, 100), 10); // top-right
  assert.strictEqual(sample(0, 0), 20);     // bottom-left
  assert.strictEqual(sample(100, 0), 30);   // bottom-right
});

test('center is the bilinear average of all four corners', () => {
  assert.strictEqual(sample(50, 50), 15); // (0+10+20+30)/4
});

test('returns null outside the patch extent', () => {
  assert.strictEqual(sample(150, 50), null);
  assert.strictEqual(sample(50, -1), null);
});

test('returns null when any corner is NoData', () => {
  const nd = makePatchSampler({
    xmin: 0, ymin: 0, xmax: 1, ymax: 1, width: 2, height: 2,
    heights: new Float32Array([-3.5e38, 5, 6, 7]),
  });
  assert.strictEqual(nd(0.5, 0.5), null);
});
