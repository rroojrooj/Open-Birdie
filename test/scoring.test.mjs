// Pure HUD helpers: to-par math, the four-state forward button, the verdict word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPar, forwardLabel, verdict } from '../public/scoring.mjs';

test('toPar sums score-minus-par over played holes, ignoring nulls', () => {
  assert.equal(toPar([4, 5, null], [4, 4, 4]), 1); // +1 from hole 2, hole 3 unplayed
  assert.equal(toPar([3, 3], [4, 4]), -2);
  assert.equal(toPar([null, null], [4, 4]), 0); // nothing played -> even
});

test('forwardLabel: not holed with strokes -> Pick up', () => {
  assert.equal(forwardLabel({ over: false, holed: false, strokes: 3, hole: 2, holeCount: 18 }).label, 'Pick up');
});

test('forwardLabel: not holed, zero strokes -> Skip', () => {
  assert.equal(forwardLabel({ over: false, holed: false, strokes: 0, hole: 2, holeCount: 18 }).label, 'Skip');
});

test('forwardLabel: holed mid-round -> Next hole', () => {
  assert.equal(forwardLabel({ over: false, holed: true, strokes: 4, hole: 2, holeCount: 18 }).label, 'Next hole');
});

test('forwardLabel: last hole -> Finish round even when holed (precedence)', () => {
  assert.equal(forwardLabel({ over: false, holed: true, strokes: 4, hole: 18, holeCount: 18 }).label, 'Finish round');
});

test('forwardLabel: round over -> button hidden', () => {
  assert.equal(forwardLabel({ over: true, holed: true, strokes: 4, hole: 18, holeCount: 18 }).hidden, true);
});

test('verdict words by to-par', () => {
  assert.equal(verdict(-2), 'Under par');
  assert.equal(verdict(0), 'Even');
  assert.equal(verdict(3), 'Over par');
});
