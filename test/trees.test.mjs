import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speciesFor, canopyDims } from '../public/render/tree-util.js';

test('speciesFor is deterministic and splits both species', () => {
  const xs = Array.from({ length: 100 }, (_, i) => speciesFor(i));
  assert.ok(xs.every((s) => s === 'conifer' || s === 'deciduous'));
  assert.equal(speciesFor(7), speciesFor(7)); // stable
  const conifers = xs.filter((s) => s === 'conifer').length;
  assert.ok(conifers > 20 && conifers < 80, `expected a mix, got ${conifers} conifers`);
});

test('canopyDims returns taller-than-wide conifer, rounder deciduous', () => {
  const c = canopyDims('conifer'), d = canopyDims('deciduous');
  assert.ok(c.height > c.width, 'conifer taller than wide');
  assert.ok(d.width >= d.height * 0.8, 'deciduous roughly round');
  assert.ok(c.yCenter > 0 && d.yCenter > 0);
});
