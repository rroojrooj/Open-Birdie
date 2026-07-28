import test from 'node:test';
import assert from 'node:assert/strict';
import { paintSurfaceMask, RAW_SURFACE_COLORS } from '../public/render/surface-mask.js';

const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const polygon = [[1, 1], [9, 1], [9, 9], [1, 9]];
const surfaces = [
  { kind: 'fairway', poly: polygon },
  { kind: 'green', poly: polygon },
  { kind: 'bunker', poly: polygon },
];

function parseHex(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function fakeCanvasFactory() {
  const sample = [0, 0, 0];
  const context = {
    fillStyle: '#000000',
    filter: 'none',
    globalCompositeOperation: 'source-over',
    fillRect() {
      sample.splice(0, 3, ...parseHex(this.fillStyle));
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      const incoming = parseHex(this.fillStyle);
      if (this.globalCompositeOperation === 'lighter') {
        sample.splice(0, 3, ...sample.map((value, i) => Math.min(255, value + incoming[i])));
      } else {
        sample.splice(0, 3, ...incoming);
      }
    },
  };
  const canvas = { width: 0, height: 0, sample, context, getContext: () => context };
  return () => canvas;
}

test('raw surface packing preserves overlapping mown, green, and bunker ownership in any paint order', () => {
  for (const kinds of [
    ['fairway', 'green', 'bunker'],
    ['bunker', 'green', 'fairway'],
  ]) {
    const canvas = paintSurfaceMask({
      bounds,
      surfaces,
      kinds,
      colors: RAW_SURFACE_COLORS,
      blurPx: 0,
      additive: true,
      canvasFactory: fakeCanvasFactory(),
    });
    assert.deepEqual(canvas.sample, [255, 255, 255]);
    assert.equal(canvas.context.globalCompositeOperation, 'source-over');
    assert.equal(canvas.context.filter, 'none');
  }
});

test('green contributes mown red plus green while bunker contributes independent blue', () => {
  const canvas = paintSurfaceMask({
    bounds,
    surfaces: surfaces.filter((surface) => surface.kind !== 'fairway'),
    kinds: ['green', 'bunker'],
    colors: RAW_SURFACE_COLORS,
    blurPx: 0,
    additive: true,
    canvasFactory: fakeCanvasFactory(),
  });
  assert.deepEqual(canvas.sample, [255, 255, 255]);
});
