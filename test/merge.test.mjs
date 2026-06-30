import { test } from 'node:test';
import assert from 'node:assert';
import { mergeTrace } from '../tools/trace/merge.mjs';

const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];

test('merges a hole into an empty sidecar', () => {
  const out = mergeTrace(null, {
    hole: 9,
    surfacesLocal: [{ kind: 'green', poly: sq, confidence: 0.8 }],
    pinLocal: [5, 5],
    boundaryLocal: [[0, 0], [20, 0], [20, 20]],
  });
  assert.equal(out.surfaces.length, 1);
  assert.equal(out.surfaces[0].hole, 9);
  assert.equal(out.surfaces[0].source, 'claude-vision');
  assert.deepEqual(out.pins[9], [5, 5]);
  assert.equal(out.holeBoundaries[9].length, 3);
});

test('re-merging the same hole REPLACES, never duplicates (idempotent)', () => {
  const a = mergeTrace(null, { hole: 9, surfacesLocal: [{ kind: 'green', poly: sq }] });
  const b = mergeTrace(a, { hole: 9, surfacesLocal: [{ kind: 'green', poly: sq }, { kind: 'bunker', poly: sq }] });
  assert.equal(b.surfaces.filter((s) => s.hole === 9).length, 2); // not 3
});

test('merging hole 9 leaves hole 8 surfaces intact', () => {
  const a = mergeTrace(null, { hole: 8, surfacesLocal: [{ kind: 'green', poly: sq }] });
  const b = mergeTrace(a, { hole: 9, surfacesLocal: [{ kind: 'green', poly: sq }] });
  assert.equal(b.surfaces.filter((s) => s.hole === 8).length, 1);
  assert.equal(b.surfaces.filter((s) => s.hole === 9).length, 1);
});

test('drops degenerate rings (< 3 points)', () => {
  const out = mergeTrace(null, { hole: 9, surfacesLocal: [{ kind: 'green', poly: [[0, 0], [1, 1]] }] });
  assert.equal(out.surfaces.length, 0);
});
