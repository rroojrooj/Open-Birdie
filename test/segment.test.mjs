import { test } from 'node:test';
import assert from 'node:assert';
import { ndvi, classifyPixel, maskOf, segmentWindow } from '../tools/trace/segment.mjs';

test('ndvi separates vegetation (high) from bare ground (low)', () => {
  assert.ok(ndvi(50, 120) > 0.3);   // veg: NIR >> R
  assert.ok(Math.abs(ndvi(150, 150)) < 0.05); // bare: NIR ~ R
});

test('classifyPixel: bright non-veg -> sand', () => {
  assert.equal(classifyPixel({ R: 150, G: 150, B: 150, N: 150 }, 2), 'sand');
});

test('classifyPixel: dark non-veg -> water', () => {
  assert.equal(classifyPixel({ R: 30, G: 30, B: 30, N: 30 }, 2), 'water');
});

test('classifyPixel: high vigor + smooth -> green', () => {
  assert.equal(classifyPixel({ R: 50, G: 90, B: 40, N: 120 }, 5), 'green');
});

test('classifyPixel: mid vigor + medium texture -> fairway', () => {
  assert.equal(classifyPixel({ R: 60, G: 95, B: 45, N: 100 }, 12), 'fairway');
});

test('classifyPixel: otherwise -> rough', () => {
  assert.equal(classifyPixel({ R: 70, G: 90, B: 50, N: 95 }, 25), 'rough'); // veg but high texture
});

test('maskOf builds a binary mask for one class', () => {
  const classes = ['sand', 'green', 'sand', 'rough'];
  assert.deepEqual(Array.from(maskOf(classes, 'sand')), [1, 0, 1, 0]);
});

test('segmentWindow classifies a 2x2 RGBN window', () => {
  // 4 px: bright-bare, dark-bare, veg-smooth, veg-smooth
  const bands = [
    150, 150, 150, 150,
    30, 30, 30, 30,
    50, 90, 40, 120,
    50, 90, 40, 120,
  ];
  const out = segmentWindow(bands, 2, 2);
  assert.equal(out.length, 4);
  assert.equal(out[0], 'sand');
  assert.equal(out[1], 'water');
});
