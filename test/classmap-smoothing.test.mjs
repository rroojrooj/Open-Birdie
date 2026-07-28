import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { smoothClassmapTexture } from '../public/render/classmap-smoothing.js';

function smoothingCanvas({ context = null } = {}) {
  const calls = [];
  const drawContext = context || {
    filter: 'none',
    drawImage(...args) { calls.push(args); },
  };
  return {
    width: 0,
    height: 0,
    calls,
    context: drawContext,
    getContext: () => drawContext,
  };
}

test('classmap smoothing preserves dimensions, applies the 4px filter, and replaces the image on success', () => {
  const source = { width: 64, height: 32 };
  const texture = { image: source, needsUpdate: false };
  const canvas = smoothingCanvas();
  const result = smoothClassmapTexture(texture, { canvasFactory: () => canvas });

  assert.equal(result.status, 'smoothed');
  assert.equal(result.image, canvas);
  assert.equal(canvas.width, 64);
  assert.equal(canvas.height, 32);
  assert.equal(canvas.context.filter, 'blur(4px)');
  assert.deepEqual(canvas.calls, [[source, 0, 0]]);
  assert.equal(texture.image, canvas);
  assert.equal(texture.needsUpdate, true);
});

test('classmap smoothing failures preserve the exact raw image and texture update state', () => {
  const cases = [
    {
      name: 'missing image',
      image: null,
      canvasFactory: () => smoothingCanvas(),
      expected: 'Classmap image is missing',
    },
    {
      name: 'absent dimensions',
      image: { pixels: new Uint8Array([1, 2, 3]) },
      canvasFactory: () => smoothingCanvas(),
      expected: 'Classmap image dimensions are missing or invalid',
    },
    {
      name: 'missing 2D context',
      image: { width: 2, height: 2, pixels: new Uint8Array([1, 2, 3]) },
      canvasFactory: () => ({ width: 0, height: 0, getContext: () => null }),
      expected: 'Classmap smoothing canvas has no 2D context',
    },
    {
      name: 'draw exception',
      image: { width: 2, height: 2, pixels: new Uint8Array([1, 2, 3]) },
      canvasFactory: () => smoothingCanvas({
        context: {
          filter: 'none',
          drawImage() { throw new Error('draw exploded'); },
        },
      }),
      expected: 'draw exploded',
    },
  ];

  for (const fixture of cases) {
    const warnings = [];
    const texture = { image: fixture.image, needsUpdate: 'unchanged' };
    const originalImage = texture.image;
    const originalBytes = texture.image?.pixels && new Uint8Array(texture.image.pixels);
    const result = smoothClassmapTexture(texture, {
      canvasFactory: fixture.canvasFactory,
      warn: (...args) => warnings.push(args),
    });

    assert.equal(result.status, 'raw-fallback', fixture.name);
    assert.equal(texture.image, originalImage, fixture.name);
    assert.equal(texture.needsUpdate, 'unchanged', fixture.name);
    if (originalBytes) assert.deepEqual(texture.image.pixels, originalBytes, fixture.name);
    const warning = warnings.flat().map(String).join(' ');
    assert.match(warning, new RegExp(fixture.expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), fixture.name);
    assert.match(warning, /raw classmap fallback/, fixture.name);
  }
});

test('scene loader keeps the classmap texture selected while delegating smoothing to the helper', () => {
  const source = fs.readFileSync(new URL('../public/render/scene.js', import.meta.url), 'utf8');
  assert.match(source, /const result = smoothClassmapTexture\(tex\)/);
  assert.match(source, /this\._macro\.surfaces = cls/);
  assert.doesNotMatch(source, /catch \(e\) \{ \/\* keep the raw texture on failure \*\/ \}/);
});
