'use strict';
// Tier-0 reliability regressions: malformed launch-monitor packets must not
// corrupt the round, and a course with no playable holes must be rejected
// rather than wedge the game. Pure logic — drives Game/parseOsm directly.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../lib/game');
const { parseOsm } = require('../lib/course');

function course(holeCount = 1, par = 4) {
  return {
    name: 'Test Course', surfaces: [], boundary: null, elevation: null,
    holes: Array.from({ length: holeCount }, () => ({
      par, tee: [0, 0], pin: [0, 100], lengthYd: 400, line: [[0, 0], [0, 100]],
    })),
  };
}

test('handleShot rejects malformed ball data without corrupting the round', () => {
  const g = new Game();
  g.setCourse(course(1));
  const bad = [
    {},                                   // no Speed
    { Speed: NaN, VLA: 15 },              // NaN (the original poisoning case)
    { Speed: 'fast' },                    // wrong type
    { Speed: 0 }, { Speed: -5 },          // non-positive
    { Speed: 99999 },                     // absurd
  ];
  for (const b of bad) assert.equal(g.handleShot(b), null);
  // strokes untouched and ball still finite — no NaN poisoning
  assert.equal(g.strokes, 0);
  assert.ok(Number.isFinite(g.ball.x) && Number.isFinite(g.ball.y));
});

test('a valid shot still works after a malformed packet (recovery)', () => {
  const g = new Game();
  g.setCourse(course(1));
  assert.equal(g.handleShot({ Speed: NaN }), null);       // poison attempt
  const r = g.handleShot({ Speed: 120, VLA: 15, HLA: 0, TotalSpin: 3000 });
  assert.ok(r, 'valid shot after a bad one must still resolve');
  assert.equal(g.strokes, 1);
  assert.ok(Number.isFinite(g.ball.x) && Number.isFinite(g.ball.y));
  assert.ok(Number.isFinite(g.distToPinYd));
});

test('handleShot sanitizes out-of-range launch fields instead of failing', () => {
  const g = new Game();
  g.setCourse(course(1));
  // extreme but finite VLA/HLA/spin should be clamped, not NaN-propagated
  const r = g.handleShot({ Speed: 130, VLA: 999, HLA: -999, TotalSpin: 999999, SpinAxis: NaN });
  assert.ok(r);
  assert.ok(Number.isFinite(r.end.x) && Number.isFinite(r.end.y));
});

test('setCourse rejects a course with no playable holes and keeps the loaded one', () => {
  const g = new Game();
  g.setCourse(course(2));
  for (const bad of [course(0), { holes: [] }, {}, null]) {
    assert.throws(() => g.setCourse(bad), /no playable holes/i);
  }
  // the good course is still active (guard runs before any mutation)
  assert.equal(g.state().loaded, true);
  assert.equal(g.state().holeCount, 2);
});

test('parseOsm throws when hole lines exist but none are playable', () => {
  const osm = { elements: [
    { type: 'way', tags: { golf: 'green' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, { lat: 0.001, lon: 0.001 }, { lat: 0, lon: 0 }] },
    { type: 'way', tags: { golf: 'hole' }, geometry: [{ lat: 0, lon: 0 }] }, // 1 point -> unplayable
  ] };
  assert.throws(() => parseOsm(osm, 'Test', null), /playable/i);
});
