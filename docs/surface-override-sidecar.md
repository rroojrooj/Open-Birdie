# Surface override sidecar

## Why

A hole's playing surfaces — green, fairway, bunkers — and its pin come from
OpenStreetMap. That layer is **incomplete and sometimes wrong**: at Bandon only
4 of 18 holes are mapped, and Hole 1's pin sits on a bare dune 300+ m from any
green ("flag on the mountain"). The terrain (3DEP) and aerial (NAIP) register
correctly; the OSM vector layer is the unreliable one.

The override sidecar is the durable seam for correcting it **without touching
the immutable HD bundle or the OSM cache**: a per-course file of corrected
vector polygons + relocated pins, applied once at load time. Absent sidecar =
today's behaviour, unchanged.

## Contract

File: `data/courses/<slug>.surfaces.json`, where `<slug>` is `slug(course.name)`
(same slug as the cached `<slug>.json`). Lives under the data dir
(`BIRDIE_DATA_DIR`), alongside the course cache — it is **per-install data, not
committed** (distribution of curated fixes is an open question).

```json
{
  "version": 1,
  "course": "Bandon Dunes Golf Resort",
  "note": "human-readable provenance",
  "pins": { "1": [133, 240] },
  "surfaces": [
    { "kind": "green", "hole": 1, "confidence": 0.6, "source": "claude-vision",
      "poly": [[148,240],[146,246],[141,250], ...] }
  ]
}
```

- `pins[ref]` — replaces `holes[].pin` for that hole (local metres, the sim frame).
- `surfaces[]` — **appended** to `course.surfaces`; only `kind` + `poly` are read
  (extra fields like `hole`/`confidence`/`source` are provenance metadata).
  `kind` ∈ `green|fairway|bunker|tee|water`; `poly` is a ≥3-point ring in local
  metres. Append (not replace) is fine where the OSM data is missing; replacing a
  *wrong* existing polygon is future work.
- Malformed entries (bad arity, < 3 points) are ignored, never thrown.

## Where it applies (the single seam)

`server.js` `activateCourse(course)`:

1. `resolveHdBundle(course)` — matches the HD bundle by `courseFingerprint`,
   computed on the **original** course. **Must run before the override** so the
   immutable bundle still validates. (The browser never recomputes the
   fingerprint, so the post-override geometry it receives doesn't break HD.)
2. `applySurfaceOverride(course, loadSurfaceOverride(course))` — mutates pins +
   surfaces in place.
3. `game.setCourse(course)` — physics reads the corrected surfaces via
   `makeSurfaceLookup`; `courseGeometry()` serves the corrected `surfaces`/`holes`
   to the browser renderer (`_paintSplat`, pin placement).

So one apply point feeds both physics and the renderer. `lib/course.js` owns
`applySurfaceOverride` / `loadSurfaceOverride` (next to `makeSurfaceLookup`);
`test/course-override.test.js` covers them, headline being
`surfaceAt(relocated-pin) === 'green'`.

## Authoring

The detector is **Claude reading the registered NAIP aerial directly** (no
external API): crop the hole, identify the green/bunkers, run the exact
pixel→local transform (`tools/hd-course/coordinates.mjs`), write the polygon +
pin. Verify by re-drawing the polygon on the aerial (the renderer's own imagery)
and by `surfaceAt(pin) === 'green'`. Low-confidence holes get refined against the
free-roam camera. `confidence` is a first-class field for a future review pass.
