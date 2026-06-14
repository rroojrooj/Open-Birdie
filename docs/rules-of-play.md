# Open-Birdie — Rules of Play: Playable Area, OB & Penalty Areas

Researched + decided ruleset for how Open-Birdie handles the **course boundary**, **out of
bounds**, and **water / penalty areas**.

Design goal: faithful *enough* to real golf to feel right, but **forgiving and fully
automatic**. Open-Birdie resolves every shot from a single launch-monitor flight with no
human in the loop, over coarse OpenStreetMap geometry — so any rule that needs player
choices or surveyed course marking is off the table.

## Decided ruleset (the pragmatic version)

| Element | Open-Birdie rule |
| --- | --- |
| **Water / penalty areas** | All treated as **red (lateral)**. `+1` stroke. Drop within ~2 club-lengths (**2.3 m**) of the point where the ball crossed the edge — nearest **dry & in-bounds** spot, **no nearer the hole**. Back-on-the-line fallback if nothing dry is within range. |
| **Out of bounds** | **Drop-and-go, `+1`.** Drop where the ball last left the playable area (no replay). Friendly/casual — chosen over strict stroke-and-distance. |
| **Course boundary** | OSM `leisure=golf_course` outline **+ 15 m buffer**. A ball is OB only when **>15 m outside** the outline; within the buffer it plays as rough. Guards against imprecise OSM outlines. |
| **Yellow vs red** | Not distinguished (all red). Recoverable later from OSM `water_hazard` (yellow) vs `lateral_water_hazard` (red) tags if more fidelity is ever wanted. |
| **Deliberately skipped** | Relief-option choice UI, knee-height drop procedure, free relief (obstructions / abnormal conditions), provisional balls, opposite-side relief (removed from the real rules in 2019 anyway). |

### Why these, vs. strict tour rules
Penalties stay (so play still *means* something), but every resolution is forgiving and
auto-computable from data we already have. Notably, the "all red" choice also happens to
match the **modern real-world default** — an unmarked penalty area is treated as red — and
the crossing point a lateral drop needs is **already captured** in the shot simulation
(`sim.events` water event).

---

## Real-rules reference (USGA / R&A, 2023 edition)

Verified against primary governing-body text via a fan-out research pass (3-vote adversarial
verification; items that couldn't be independently re-sourced are flagged at the bottom).

**Five areas of the course** (Rule 2.2): teeing area, general area, penalty areas, bunkers,
putting green. The *general area* is the whole course except those four and out of bounds.
→ Open-Birdie's surfaces map 1:1: `tee`, `fairway`+`rough` (general area), `water` (penalty
area), `bunker`, `green`.

**Out of bounds** ([Rule 18.2](https://www.randa.org/en/rog/the-rules-of-golf/rule-18)):
everything outside the Committee's boundary (white stakes / lines / fences). Only standard
relief is **stroke-and-distance** — `+1` and replay from the previous spot.
- *Model Local Rule E-5* (optional): instead of replaying, drop near the fairway edge where
  the ball went out for **`+2`**. Built for pace of play; **not allowed in elite/pro play**.
  [[USGA E-5 PDF](https://www.usga.org/content/dam/usga/pdf/2018/golfs-new-rules/Alternative%20to%20S&D%20Model%20Local%20Rule.pdf)]
- Open-Birdie's chosen "drop-and-go `+1`" is *more* forgiving than either (a deliberate
  casual choice, not a sanctioned rule).

**Penalty areas** ([Rule 17](https://www.randa.org/en/rog/the-rules-of-golf/rule-17)) —
replaced "water hazards" in the 2019 overhaul:
- A ball is "in" the moment it **crosses the edge** (a vertical plane — even just overhanging).
- **Yellow** = 2 relief options (stroke-and-distance; or back-on-the-line). **Red** = those
  two **plus lateral relief**: drop within **2 club-lengths of the point where the ball last
  crossed the edge**, no nearer the hole. All cost `+1`.
  [[USGA FAQ 210](https://www.usga.org/RulesFAQ/rules_answer2019.asp?FAQidx=210&Rule=0&Topic=4)]
- **Red is the default** for any unmarked penalty area; bodies encourage marking everything
  red so lateral relief is always available.
  [[USGA](https://www.usga.org/content/usga/home-page/rules-hub/rules-modernization/major-changes/expanded-use-of-red-marked-penalty-areas.html)]
- 2019 **removed** the old "opposite-side" relief — do not build it.

**Relief mechanics**: drop from knee height; **1 club-length** for free relief, **2** for
penalty relief; "no nearer the hole" always applies; a club-length = longest non-putter club
(~1.1–1.2 m, so 2 ≈ **2.3 m**).

### Old → new terminology (matters: OSM uses the *old* terms)

| OSM tag | Pre-2019 term | Modern equivalent | Relief |
| --- | --- | --- | --- |
| `golf=water_hazard` | water hazard | **yellow** penalty area | stroke-and-distance / back-on-line |
| `golf=lateral_water_hazard` | lateral water hazard | **red** penalty area | + lateral (2 cl from crossing) |
| `natural=water` | (plain water) | default **red** | + lateral |

---

## Current code vs. target

| Element | Real rule | Open-Birdie today | Action |
| --- | --- | --- | --- |
| Five areas | Rule 2.2 | tee / fairway+rough / water / bunker / green | ✅ none — clean map |
| OB relief | 18.2 | `+1`, replay previous spot ([`game.js:111`](../lib/game.js)) | ↻ switch to drop-and-go |
| OB boundary | Definitions | OSM outline, *exact* ([`course.js:371`](../lib/course.js)) | ↻ add 15 m buffer |
| Water drop | 17.1d(3) | `+1`, drop 4 m **toward tee** ([`game.js:99`](../lib/game.js)) | ↻ lateral from crossing point |
| Crossing point | 17.1 | water-entry event captured but unused for the drop | ↻ use it as the reference |
| Yellow vs red | 17.1 | collapsed into one `water` | ◦ skip (default red) |
| Drop UI / knee height / free relief | 14.3, 16.1 | none (auto) | ◦ correctly omitted |

---

## Implementation plan

**`lib/course.js` — boundary buffer**
- Add `BOUNDARY_BUFFER_M = 15` and a small point-to-polygon distance helper (min distance to
  the boundary edges).
- In `makeSurfaceLookup`, return `'ob'` only when the point is outside the boundary **and**
  farther than the buffer from it; otherwise fall through to `'rough'`. (Distance is only
  computed on the rare outside-the-outline case, so it stays cheap.)

**`lib/game.js` — penalties**
- **Water:** use the water-entry point (already in `sim.events`) as the crossing reference;
  resolve the drop via a new `_lateralDrop(cx, cy, pin)` helper — sample the no-nearer-the-hole
  arc within 2.3 m for the nearest dry, in-bounds spot; back-on-the-line (straight away from
  the pin until dry) as fallback.
- **OB:** replace replay-from-previous-spot with drop-and-go — walk `sim.points` and drop at
  the last point that wasn't `'ob'` (i.e. where the ball last left the playable area).

---

## Not independently re-verified
Standard 2019+ rules, but not freshly confirmed in the research pass — confirm against the
rulebook only if they ever become load-bearing. **None affect the decided ruleset**, because
we don't model drops as physical procedures:
- Knee-height drop (Rule 14.3), nearest point of complete relief (Rule 16.1).
- Exact OB-marking geometry (boundary = inside edge of white stakes/fence posts at ground level).
- Club-length defined as the longest non-putter club in the bag.

## Sources (primary)
- R&A — [Rule 17 (Penalty Areas)](https://www.randa.org/en/rog/the-rules-of-golf/rule-17),
  [Rule 18 (Stroke & Distance; Ball Lost / OB)](https://www.randa.org/en/rog/the-rules-of-golf/rule-18)
- USGA — [Stroke and Distance](https://www.usga.org/content/usga/home-page/rules-hub/rulesarticles/rules-of-golf-articles/stroke-and-distance.html),
  [Penalty-area relief FAQ](https://www.usga.org/RulesFAQ/rules_answer2019.asp?FAQidx=210&Rule=0&Topic=4),
  [Expanded use of red penalty areas](https://www.usga.org/content/usga/home-page/rules-hub/rules-modernization/major-changes/expanded-use-of-red-marked-penalty-areas.html),
  [Model Local Rule E-5 (PDF)](https://www.usga.org/content/dam/usga/pdf/2018/golfs-new-rules/Alternative%20to%20S&D%20Model%20Local%20Rule.pdf)
- R&A — [Committee Procedures §8 (Local Rules, incl. E-5)](https://www.randa.org/en/rog/committee-procedures/8)
- OSM — [`golf=lateral_water_hazard` tag](https://wiki.openstreetmap.org/wiki/Tag:golf=lateral_water_hazard)
