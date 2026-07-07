// P0a: gameplay/debug UI must not leak into survey/beauty (non-play) framings.
// The gate is a pure predicate so it can be tested without a renderer or DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlayFraming, ballReadScale, pinReadScale } from '../public/render/framing.js';

test('isPlayFraming: only idle + not animating is a play framing', () => {
  assert.equal(isPlayFraming('idle', false), true);   // address view — gameplay UI shows
  assert.equal(isPlayFraming('idle', true), false);   // shot replay in progress — UI hidden
  assert.equal(isPlayFraming('free', false), false);  // free-roam / overview / beauty — no gameplay UI
  assert.equal(isPlayFraming('static', false), false); // shot tracer (frozen cam) — no gameplay UI
});

test('ballReadScale: inflates for readability ONLY in play framing', () => {
  // play framing: keep the existing readability curve (clamp(dist*0.055, 1, 26))
  assert.equal(ballReadScale(1000, 'idle', false), 26);   // far, clamped to max
  assert.equal(ballReadScale(100, 'idle', false), 5.5);   // mid
  assert.equal(ballReadScale(5, 'idle', false), 1);       // near, clamped to min
  // survey / replay framings: true scale, never a 26x debug billboard
  assert.equal(ballReadScale(1000, 'free', false), 1);
  assert.equal(ballReadScale(1000, 'static', false), 1);
  assert.equal(ballReadScale(1000, 'idle', true), 1);     // mid-replay
});

test('pinReadScale: inflates for readability ONLY in play framing', () => {
  assert.equal(pinReadScale(1000, 'idle', false), 6);     // far, clamped to max
  assert.equal(pinReadScale(100, 'idle', false), 1.3);    // mid (100*0.013)
  assert.equal(pinReadScale(1000, 'free', false), 1);     // survey — true scale
  assert.equal(pinReadScale(1000, 'idle', true), 1);      // replay — true scale
});
