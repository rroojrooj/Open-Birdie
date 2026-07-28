'use strict';
// Round state machine: hole advance, pick-up scoring, round-over.
// Pure logic — no physics, no DOM. Drives the Game class directly.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../lib/game');

// Minimal playable course: empty surfaces (surfaceAt -> 'rough'), flat terrain.
function course(holeCount, par = 4) {
  return {
    name: 'Test Course',
    surfaces: [],
    boundary: null,
    elevation: null,
    holes: Array.from({ length: holeCount }, () => ({
      par, tee: [0, 0], pin: [0, 100], lengthYd: 400, line: [[0, 0], [0, 100]],
    })),
  };
}

test('fresh round: not over, nothing picked up, no scores', () => {
  const g = new Game();
  g.setCourse(course(2));
  const s = g.state();
  assert.equal(s.over, false);
  assert.deepEqual(s.pickedUp, [false, false]);
  assert.deepEqual(s.scores, [null, null]);
});

test('pick up mid-round records strokes+1, flags it, and advances', () => {
  const g = new Game();
  g.setCourse(course(2));
  g.strokes = 5; // hacked it around hole 1, never holed
  g.nextHole();
  assert.equal(g.scores[0], 6); // 5 + the conceded stroke
  assert.equal(g.pickedUp[0], true);
  assert.equal(g.state().hole, 2); // advanced
  assert.equal(g.state().over, false);
});

test('skip with zero strokes records par+2 and flags it', () => {
  const g = new Game();
  g.setCourse(course(2, 3)); // par 3
  g.nextHole(); // strokes is 0 — a skip, not a pick-up
  assert.equal(g.scores[0], 5); // par 3 + 2
  assert.equal(g.pickedUp[0], true);
  assert.equal(g.state().hole, 2);
});

test('finishing the last hole sets over and does NOT wrap to hole 1', () => {
  const g = new Game();
  g.setCourse(course(2));
  g.nextHole(); // skip hole 1 -> hole 2
  assert.equal(g.state().hole, 2);
  g.strokes = 4;
  g.nextHole(); // pick up the final hole
  assert.equal(g.over, true);
  assert.equal(g.state().hole, 2); // regression: no modulo wrap to 1
  assert.equal(g.scores[1], 5); // 4 + 1
});

test('_scoreHole sets over only on the final hole', () => {
  const g = new Game();
  g.setCourse(course(3));
  g._scoreHole(4, false); // hole 1 of 3
  assert.equal(g.over, false);
  g.holeIndex = 2; // last hole
  g._scoreHole(5, false);
  assert.equal(g.over, true);
  assert.equal(g.scores[2], 5);
});

test('handleShot is a no-op once the round is over', () => {
  const g = new Game();
  g.setCourse(course(1)); // single hole
  g.strokes = 3;
  g.nextHole(); // pick up the only hole -> over
  assert.equal(g.over, true);
  const r = g.handleShot({ Speed: 120, VLA: 15, HLA: 0, TotalSpin: 3000 });
  assert.equal(r, null);
});

test('nextHole is a no-op once the round is over', () => {
  const g = new Game();
  g.setCourse(course(1));
  g.strokes = 3;
  g.nextHole(); // over
  const holeBefore = g.holeIndex;
  g.nextHole(); // should do nothing
  assert.equal(g.holeIndex, holeBefore);
  assert.equal(g.over, true);
});

test('reset clears over, pickedUp, and scores', () => {
  const g = new Game();
  g.setCourse(course(2));
  g.strokes = 5; g.nextHole(); // pickedUp[0]
  g.strokes = 4; g.nextHole(); // over
  g.reset();
  assert.equal(g.over, false);
  assert.deepEqual(g.pickedUp, [false, false]);
  assert.deepEqual(g.scores, [null, null]);
  assert.equal(g.state().hole, 1);
});

test('18-hole round: over triggers on hole 18, not before', () => {
  const g = new Game();
  g.setCourse(course(18));
  for (let i = 0; i < 17; i++) { g.strokes = 4; g.nextHole(); }
  assert.equal(g.over, false); // through hole 17
  assert.equal(g.state().hole, 18);
  g.strokes = 4; g.nextHole(); // finish 18
  assert.equal(g.over, true);
});

test('prepareCourse completes without mutation and commitPreparedCourse assigns the complete state', () => {
  const g = new Game();
  g.setCourse(course(2));
  g.strokes = 3;
  const activeBefore = {
    course: g.course,
    surfaceAt: g.surfaceAt,
    terrain: g.terrain,
    ball: g.ball,
    strokes: g.strokes,
  };

  const next = course(3);
  const prepared = g.prepareCourse(next, { ready: false });
  assert.deepEqual({
    course: g.course,
    surfaceAt: g.surfaceAt,
    terrain: g.terrain,
    ball: g.ball,
    strokes: g.strokes,
  }, activeBefore);
  assert.equal(prepared.course, next);
  assert.equal(prepared.runtimeReady, false);

  assert.doesNotThrow(() => g.commitPreparedCourse(prepared));
  assert.equal(g.course, next);
  assert.equal(g.state().holeCount, 3);
  assert.equal(g.strokes, 0);
  assert.equal(g.runtimeReady, false);
});

test('prepareCourse factory failures preserve every active Game field', () => {
  const terrainCourse = (count) => ({
    ...course(count),
    elevation: { patches: [] },
  });
  const cases = [
    {
      factories: {
        surfaceLookupFactory: (() => {
          let calls = 0;
          return () => {
            if (calls++ > 0) throw new Error('surface preparation failed');
            return () => 'rough';
          };
        })(),
      },
      active: course(2),
      next: course(3),
    },
    {
      factories: {
        terrainFactory: (() => {
          let calls = 0;
          return () => {
            if (calls++ > 0) throw new Error('terrain preparation failed');
            return { h: () => 0, grad: () => ({ dx: 0, dy: 0 }) };
          };
        })(),
      },
      active: terrainCourse(2),
      next: terrainCourse(3),
    },
  ];

  for (const { factories, active, next } of cases) {
    const g = new Game(factories);
    g.setCourse(active);
    g.strokes = 2;
    g.ball = { x: 7, y: 8 };
    const before = Object.fromEntries(
      Object.entries(g).filter(([key]) => key !== '_courseFactories'),
    );
    assert.throws(() => g.prepareCourse(next), /preparation failed/);
    for (const [key, value] of Object.entries(before)) assert.equal(g[key], value, key);
  }
});
