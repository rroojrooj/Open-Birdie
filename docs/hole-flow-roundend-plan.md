# Open-Birdie — Hole Flow + Round-End Plan

> Status: **design review in progress** (`/plan-design-review`). Scope locked to the
> single-player "finish the loop" cluster. Multiplayer and mulligan are parked. No
> code yet. This doc captures the design decisions; implementation follows.
>
> Based on `origin/main` 735d1f9 (PR #5). Conflict-checked against the upstream club-from-LM
> (PR #4) and the rules-of-play penalty rewrite (PR #5): no overlap. Our edits live in
> `nextHole()`, `updateHolePills`, `buildScorecard`, `applyState`, and new round-end markup;
> the upstream changes are in penalty logic and `showShotData` / `prettyClub`.

## Goal

Make a single-player round feel finished. Today you can only advance by holing out,
the final hole silently wraps back to hole 1 (overwriting scores), and there is no
end-of-round payoff. Fix the flow and add a real round-complete summary, reusing the
existing HUD language in `public/style.css`.

## In scope

- Clickable hole pills + prev/next chevrons (review navigation).
- A forward action that works when not holed (pick up & advance).
- Round-complete summary card after the final hole.
- The `game.js` advance-logic fix (no more modulo wrap / score overwrite).

## Out of scope (parked, with reason)

- **Local multiplayer / add-player** — separate, larger feature; needs its own design pass.
- **Mulligan / retake** — needs an "undo to previous lie" model the engine lacks.
- **Gimme / settings UI** — not selected this pass.
- **Hole name / description display** — not selected this pass (OSM `name` still dropped).
- **Penalty rules (water / OB / boundary)** — owned by `docs/rules-of-play.md` (lateral drop,
  drop-and-go, 15 m buffer), already shipped upstream. Not this plan's concern.

## Existing leverage (reuse, do not reinvent)

`public/style.css` is the de-facto design system: glass cards, accent `#2f9e54`,
Bahnschrift tabular numerals, pill / chip / toast / modal patterns. Reused parts:
hole pills (`public/app.js` `updateHolePills`), scorecard table (`buildScorecard`),
score chip (`updateScoreChip`), toast, modal.

## Design decisions

- **D1 — Scope.** Hole flow + round-end only this pass. Multiplayer, mulligan, gimme
  UI, and hole context are deferred.
- **D2 — Navigation model: review-only.** Clicking a played pill or pressing Prev opens
  a READ-ONLY review of that hole. Forward play (Next / Pick up) is the only thing that
  advances and writes a score. Backward navigation never mutates state. This also fixes
  the existing `nextHole()` modulo-wrap + score-overwrite bug.
- **D3 — Pick-up scoring: honest count.** A hole left via `Pick up` records `strokes + 1`
  (swings taken plus the conceded stroke), no cap, flagged as picked-up on the card. A
  0-stroke `Skip` records `par + 2` ("did not play"), since `strokes + 1` would be a fake 1.
  `nextHole()` already has the pick-up line (`scores[i] = strokes`); this becomes `strokes + 1`
  plus a picked-up flag. Consistency note: `docs/rules-of-play.md` sets a "forgiving and
  automatic" house style, and honest pick-up is the one spot that runs the other way, so a
  per-hole mercy cap (`par + 4`) is the natural follow-up if a leaderboard ever lands.
- **D4 — Ending register: calm payoff.** The round-complete card matches the HUD's restraint:
  a color-coded hero to-par, a one-word verdict (`Under par` / `Even` / `Over par`), the two
  nines, highlights, the scorecard, and the actions. No confetti, no count-up, no sound. The
  per-shot toast already handles per-hole celebration. Bad rounds degrade gracefully:
  highlights read "no birdies this round" rather than an empty row, and there is zero shaming
  copy.
- **D5 — One scorecard component.** The round-complete summary IS the existing Scorecard panel
  (`#scorecard`), enriched, not a second screen. Mid-round the Scorecard button opens the light
  version (par/score table + Restart). At round end it auto-opens with the full header (hero
  to-par + verdict, nines, highlights) and the end actions (New round / Replay course / Change
  course). Reuses `buildScorecard`, `.panel`, `.dcard`, `.score-chip`, `.btn`. New tokens: the
  verdict word and the picked-up dot. Slop guardrail: the metric tiles stay data tiles
  (number over label), to-par dominant, never four identical icon-topped cards.
- **D6 — Responsive: phone collapses the strip.** Desktop and tablet show the full 1-18 pill
  strip with prev/next chevrons. Phone (≤ ~430px) hides the strip and shows a compact `7/18`
  badge that opens the enriched scorecard (D5) as the hole-by-hole review surface. Pills are
  real `<button>`s with 44px touch targets, `aria-label` per hole, `aria-current` on the active
  one. Forward button announces its action. The round-complete panel takes focus on open, has a
  heading, and closes on Esc. Under/over par never relies on colour alone.

## Information architecture

**In-round nav strip (top bar).** Pills: done = accent, current = ring, future = muted.
Prev/next chevrons. Forward button is state-dependent: `Pick up` while playing →
`Next hole` once holed/gimme → `Finish round` on the final hole. Pills are clickable → review.

**Round-complete card.** Hierarchy: to-par hero + one-word verdict → strokes + the two nines →
highlights (eagles / birdies / best hole) → per-hole strip → actions. Triggers after the final
hole of the course is completed (any hole count), replacing the modulo wrap. Two actions, not
three: **New round** (reset the same course to hole 1) and **Change course** (open the course
modal); "Replay course" is dropped as a duplicate of New round. Out/In nines show only on
18-hole courses; 9-hole and odd counts show the total alone. The scene dims behind the panel
(like the course modal). The forward button stays in the footer (`#btn-next`), always visible
with a state label; review nav (pills + chevrons) lives in the top bar.

## Interaction states

| Feature | Empty / start | Partial (mid-round) | Success / end | Error |
| --- | --- | --- | --- | --- |
| Nav strip | hole 1 ringed, rest muted, score chip `E`, Prev disabled | done = accent, current = ring, future = muted, chevrons live | final hole → forward reads `Finish round` | none (local state, no network) |
| Forward button | `Skip` (0 strokes, nothing hit) | `Pick up` (strokes > 0, not holed) / `Next hole` (holed or gimme) | `Finish round` on the last hole | n/a |
| Round-complete card | not reachable (only with a full card) | n/a (card is end-only) | hero to-par → nines → highlights → per-hole strip → actions | none |
| Picked-up hole | — | dot marker on pills + scorecard | counts toward to-par per D3 | — |

Notes: launch-monitor disconnect stays on the existing LM badge (out of scope). The card has
no loading or error state because it renders from in-memory round state, not a fetch. Pills are
clickable only for *played* holes (review-only, per D2); current and future pills are not
navigation targets.

## Responsive & accessibility

| Viewport | Pill strip | Round-complete card |
| --- | --- | --- |
| Desktop (Electron) | full 1-18 + chevrons | scorecard panel, as styled |
| Tablet (~768-1024) | full 1-18, condense stat cluster if crowded | panel fits |
| Phone (≤ ~430) | collapsed `7/18` badge → opens scorecard | panel near-full-width, scrolls |

a11y requirements (all viewports): pills are focusable `<button>`s with per-hole `aria-label`
and `aria-current`; only played holes are focusable nav targets; the forward button's label
change is announced; the round-complete panel takes focus on open, has a heading, closes on
Esc; under/over par pairs colour with the sign + number; 44px touch targets on touch clients;
`--muted` and the new dot / verdict colours verified at 4.5:1 contrast.

## Open decisions

Resolved during the review (override any of these if you disagree):
- **Round-end trigger:** fires when the final hole of the course is completed (holed or picked
  up), for any hole count. No wrap.
- **Actions:** New round + Change course only ("Replay course" dropped as redundant).
- **Nines:** Out/In split on 18-hole courses; total only otherwise.
- **Forward control placement:** stays in the footer with a state label; review nav in the top bar.
- **Scene:** dims behind the round-complete panel.

Deferred follow-ups (design debt, parked by D1 scope):
- Mercy cap (`par + 4`) on pick-up scores, if/when a leaderboard or multiplayer lands.
- Local multiplayer (roster, turn order, per-player cards).
- Mulligan / retake (needs an undo-to-previous-lie engine model).
- Gimme / settings UI (the gimme value is API-only today).
- Hole name / description display (OSM `name` is parsed then dropped).

## Engineering review

Architecture decisions (`/plan-eng-review`):
- **E1 — Review = scorecard highlight.** Clicking a played pill (or the phone `7/18` badge) opens
  the scorecard with that hole highlighted. No 3D camera move, no shot replay (the server keeps
  `scores[]`, not per-hole shot history). One review surface on every viewport.
- **E2 — Round-over is a server flag.** `state()` gains `over: boolean`, set when the final hole
  completes. `nextHole()` stops wrapping (the `% length` goes away); on the last hole it sets
  `over` instead of advancing. Clients read `state.over` and auto-open the enriched scorecard.
  Single source of truth across desktop + phone mirror.
- **E3 — Picked-up holes tracked in a parallel `pickedUp[]` boolean array** on `Game`, exposed in
  `state()`, written wherever `scores[i]` is written, reset wherever `scores` is reset. `scores[]`
  stays numeric, so `updateScoreChip` / `buildScorecard` / the to-par math are untouched.

Server change set (no new endpoints):
- `nextHole()`: branches for holed→advance / holed-on-last→`over` / pick-up (`strokes+1`, flag) /
  0-stroke skip (`par+2`, flag). No modulo wrap.
- `state()`: add `over`, `pickedUp`.
- `reset()`: clear `pickedUp` and `over` (regression-critical, see Tests).
- `/api/next-hole` and `/api/reset` reused as-is; `Skip` / `Pick up` / `Next hole` / `Finish round`
  all POST `/api/next-hole`.

Code quality (folded in, no open questions):
- Extract `toPar(scores, pars)` once, reused by the score chip, the hero, and the verdict word. DRY.
- Extract `forwardLabel(state) → {label, action}` so the four-state button is explicit, not inline
  ternaries.
- Pills become `<button>` (a11y, D6); the click handler routes to scorecard-highlight review.

Tests (`node:test`, zero-dep, wired to `npm test`):
- `test/game.test.js` drives the `Game` class against small fake-course fixtures (a 2-hole for most
  cases, plus a 9-hole and an 18-hole for the nines + trigger paths).
- **Regression (iron rule):** `nextHole()` past the last hole sets `over` and does NOT wrap to hole 0.
- **Regression (iron rule):** `reset()` clears `pickedUp[]` and `over`.
- Pickup: not holed, `strokes > 0` → `scores[i] === strokes + 1`, `pickedUp[i] === true`.
- Skip: not holed, `strokes === 0` → `scores[i] === par + 2`, `pickedUp[i] === true`.
- Holed on the last hole → `over === true`, `holeIndex` unchanged.
- `state()` exposes `over` and `pickedUp`.
- Pure UI helpers extracted so they're unit-testable: `toPar(scores, pars)` (nulls + picked-up
  summed right) and `forwardLabel(state)` (the four labels). DOM rendering (pills, scorecard)
  stays manual, no browser harness in scope.

### Outside-voice fixes (folded, findings 1–11)

The blind spot both passes share was the **round-over state machine**: who sets `over`, and what
it gates. Spelled out:

```
ROUND-OVER LIFECYCLE  (who sets `over`, what it gates)

  reset() ───────────────► over=false ; pickedUp = holes.map(()=>false)
     │
     ▼
  holes 1 .. N-1 ── nextHole(): advance (pickup/skip writes score + pickedUp[i])
     │
     ▼  final hole (holeIndex === holeCount-1) ends one of two ways:
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ holed / gimme in _play()      → _play sets over=true (score already written)│
  │ Pick up / Skip via nextHole() → writes score + pickedUp, then sets over=true│
  └──────────────────────────────────────────────────────────────────────────┘
     │
     ▼  over === true  ── GUARDS: handleShot() returns null ; nextHole() returns early ;
     │                            practice/HIT + forward button hidden
     ▼
  client applyState: open scorecard ONLY on (!prevOver && s.over)  ── once, latched
     │
     ▼
  "New round" → /api/reset → over=false   (single reset path; #btn-restart reused)
```

- **F1 — `over` set by both final-hole exits.** `_play()` sets `over=true` when it writes a
  holed/gimme score on the last hole; `nextHole()` sets it on the last hole's pick-up/skip. The
  forward button is not required to end the round. (Without this, holing out never auto-opens the card.)
- **F2 / F11 — auto-open is transition-latched.** In `applyState`, track `prevOver`; open the
  scorecard only when `!prevOver && s.over`. It lives in `applyState`, so the `pendingState` /
  `animating` deferral ([app.js:80](public/app.js)) triggers it too. `#btn-score` toggles freely after.
  (Without the latch, every SSE `state` event re-opens a card the user just closed.)
- **F3 / F6 — post-`over` guards.** `handleShot()` first line `if (this.over) return null`;
  `nextHole()` first line `if (this.over) return`. Client hides `#btn-practice` / `#ps-hit` and the
  forward button when `state.over`. (Without this, shots into a finished round corrupt it; a double
  POST skips a hole.)
- **F4 / F5 — forward button.** Delete the `btn-next` `toggle('hidden', !s.holed)` at
  [app.js:33](public/app.js); visibility + label come from `forwardLabel(state)`, hidden only when
  `over`. Precedence: `holeIndex === holeCount-1` → "Finish round" regardless of holed. (Without
  the line-33 removal, "Pick up" / "Skip" are invisible and the feature is dead.)
- **F7 — gimme note.** The gimme path in `_play` already does `strokes++`; the last-hole `over` set
  must NOT re-increment strokes.
- **F8 — `npm test` does not exist yet.** Add `"test": "node --test"` to `package.json` scripts as
  an explicit step. Regression tests must cover: `over` set when the last hole is *holed* (not just
  picked up), `handleShot()` / `nextHole()` no-op once `over`, and `reset()` clearing `over` + `pickedUp`.
- **F9 — lifecycle.** Allocate `pickedUp` next to `scores` and set `over=false` in `reset()` only,
  never in `_setupHole()` (which runs per-hole and the last-hole `nextHole()` skips).
- **F10 — one reset path.** The card's "New round" calls the same reset handler as `#btn-restart`.

## Progress log

### Implemented (TDD) — DONE

Built test-first against this plan. `npm test` = 16/16; a live-server round drive = 16/16 HTTP checks.

**Server logic (`lib/game.js`; `test/game.test.js`, 9 tests):**
- `_scoreHole(strokes, pickedUp)` — the single place a score write decides round-over (E2).
- `nextHole()` — no modulo wrap; pick-up = `strokes+1`, 0-stroke skip = `par+2` (both flagged); sets
  `over` on the final hole instead of advancing; no-op once `over` (F6).
- `_play()` holed + gimme paths call `_scoreHole`, so holing the last hole sets `over` (F1).
- `handleShot()` returns null once `over` (F3). `state()` exposes `over` + `pickedUp`. `reset()` clears
  both (F9). No new endpoints; `server.js` only gained a `.mjs` MIME type.

**Pure HUD helpers (`public/scoring.mjs`; `test/scoring.test.mjs`, 7 tests):**
- `toPar`, `forwardLabel` (last-hole-dominates precedence, F5), `verdict`.

**HUD (`public/app.js`, `public/index.html`, `public/style.css`):**
- Pills are `<button>`s with per-hole `aria-label` / `aria-current`; played pills open the scorecard
  highlighted (E1). Forward button is state-labelled (Skip / Pick up / Next hole / Finish round),
  hidden when `over`; the old line-33 hidden-toggle removed (F4). Auto-open is transition-latched in
  `applyState` (F2/F11); practice + forward hidden when over (F3). Enriched scorecard: hero to-par +
  verdict, Out/In nines (18 only), highlights, picked-up dots, New round + Change course (D5). Forward
  POST debounced (F6). Phone collapses the strip; the HOLE badge opens the scorecard (D6).

### Verification
- `npm test`: 16/16 (9 game logic + 7 helpers), including the two regressions (no-wrap, reset clears state).
- Live server, seeded 18-hole fixture: 16/16 HTTP checks — pick-up scoring, skip = par+2, finishing 18
  sets `over` with no wrap, shot-after-over no-op, reset clears everything.
- Client boot: `app.js` valid ESM, `scoring.mjs` served as `text/javascript`, new DOM ids present.
- Not browser-screenshot-verified: the WebGL+SSE app hangs the screenshot tool (known limitation);
  visual rendering left for live eyeballing.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | clean | claude subagent (codex unavailable): 11 findings, all folded |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 3 arch + 1 test decision; 11 outside-voice fixes folded; 2 regressions tested |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | 2/10 → 9/10, 6 decisions (D1–D6), 0 unresolved |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | n/a (no developer-facing surface) |

- **CROSS-MODEL:** no contradictions. The outside voice was purely additive (the round-over state
  machine); both reviewers agree on the architecture.
- **UNRESOLVED:** 0.
- **VERDICT:** DESIGN + ENG CLEARED. Plan is buildable. Ready to implement.
