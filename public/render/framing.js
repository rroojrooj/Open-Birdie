// Play-framing predicate + gameplay-UI readability scales.
//
// Gameplay/debug UI (the dashed aim line; the distance-inflated ball & pin) is
// an ADDRESS-VIEW aid. It must not leak into survey/overview/beauty framings —
// a dashed line or a 26x golf ball hovering over the course reads as a GIS
// viewer with its debug layer on. These pure helpers are the single source of
// truth for "is this a play framing", shared by scene.js and its unit test.
//
//   camMode: 'idle' (orbit ball at address) | 'static' (shot tracer, frozen cam)
//            | 'free' (course-creator fly / overview / beauty)
//   anim:    truthy while a shot replay is animating

export const isPlayFraming = (camMode, anim) => camMode === 'idle' && !anim;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Ball/pin are inflated by camera distance so they stay readable AT ADDRESS.
// Outside a play framing they return to true scale (1x) so they never read as
// debug billboards. Curves match the prior in-frame logic (scene.js).
export const ballReadScale = (dist, camMode, anim) =>
  isPlayFraming(camMode, anim) ? clamp(dist * 0.055, 1, 26) : 1;

export const pinReadScale = (dist, camMode, anim) =>
  isPlayFraming(camMode, anim) ? clamp(dist * 0.013, 1, 6) : 1;
