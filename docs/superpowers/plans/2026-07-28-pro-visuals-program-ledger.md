# Pro Visuals Program — Program Ledger

**Program status:** ACTIVE
**Last updated:** 2026-07-28
**Integration branch:** `codex/pro-visuals-program-pic`
**Current accepted base:** `origin/main` at `57e7bffd539e4f5724bb62735003f28a45bd86d0`

## 1. Executive state

- SP-00 is retrospectively accepted and integrated through PR #40.
- SP-01 has a reviewed current-base plan and is active in an isolated correction
  lane after its first candidate review found one Medium evidence gap.
- A detailed 2026-07-07 P2a plan and implementation branch exist, but they predate the
  current base. Their implementation is evidence, not yet an accepted SP-01 candidate.
- SP-02a is eligible for a parallel planning lane after SP-01 recovery is dispatched.
- The original repository worktree is protected because it is 24 commits behind and
  contains user changes.

## 2. Plan-unit ledger

| Unit | Status | Owner/lane | Depends on | Candidate / integrated evidence | Next gate |
|---|---|---|---|---|---|
| SP-00 Visual benchmark | DONE | Historical `codex/sp00-visual-benchmark` | — | Candidate `7d89b6ac24eb965039d5bdae6a30c943718ea81e`; PR #40; merge `88c67d6e1eda2adcc52b8a84643c1b7f15d19ce5`; CI green; `npm test` 375/375 | Harness is mandatory evidence path for every later visual unit |
| SP-01 P2a recovery | ACTIVE | `/root/sp01_implementation`; `codex/sp01-p2a-recovery` | SP-00 | First candidate `b4ab4a237777d217efeaeae874343e5a7f238c29`; focused 67/67 and full 381/381; RTX 3060 baseline/compare/perf clean; candidate review REJECT at 97% for missing adjacent-pose/motion stability evidence; one non-blocking Low duplicate-dispose observation | Capture and document clean adjacent-pose evidence, then independently re-review the new exact SHA |
| SP-02a CoursePresentation contract | UNCLAIMED | — | SP-00 | Master-plan scope only | Author and review sub-plan; may run alongside SP-01 |
| SP-02b Activation transaction | BLOCKED | — | SP-01, SP-02a | — | Both predecessor units integrated |
| SP-03 World context | BLOCKED | — | SP-02b | — | Reviewed sub-plan after SP-02b |
| SP-04 Surface system / HD seam | BLOCKED | — | SP-02b | Receives deferred SP-01 HD macro-seam finding | Reviewed sub-plan after SP-02b |
| SP-05 Terrain features | BLOCKED | — | SP-03, SP-04 core | — | M1 feature sub-plan |
| SP-06 Vegetation / landmarks / LOD | BLOCKED | — | SP-03, SP-04 core | — | M1 feature sub-plan |
| M1 Automatic Course Baseline | BLOCKED | — | SP-03 through SP-06 | — | Three-course visual and performance gate |
| SP-07a Course-art validation | BLOCKED | — | SP-02 contract; scheduled before SP-07b | Design scope exists | Reviewed authoring-workflow sub-plan |
| SP-07b Renderer preview / packaging | BLOCKED | — | M1, SP-07a | — | Reviewed sub-plan |
| SP-08 Chambers Bay hero pass | BLOCKED | — | SP-07b | — | Authored-content plan and review |
| SP-09a Professional HUD | BLOCKED | — | M1; final integration before M2 | — | Reviewed UI sub-plan |
| SP-09b Quality profiles / release | BLOCKED | — | M1; final integration before M2 | — | Reviewed release sub-plan |
| M2 Curated Hero gate | BLOCKED | — | SP-08, SP-09a, SP-09b | — | User subjective acceptance plus release evidence |

## 3. SP-00 retrospective acceptance

| Field | Evidence |
|---|---|
| Historical base | `origin/main` before PR #40 |
| Candidate | `7d89b6ac24eb965039d5bdae6a30c943718ea81e` |
| Pull request | <https://github.com/rroojrooj/Open-Birdie/pull/40> |
| Integrated commit | `88c67d6e1eda2adcc52b8a84643c1b7f15d19ce5` |
| Ancestry | Candidate is an ancestor of the merge commit |
| Automated verification | GitHub CI green; local Node `v22.20.0`; `npm test`: 375 passed, 0 failed |
| Review state | Prior independent engineering and correction reviews accepted the candidate; no known unresolved Critical/High/Medium finding |
| Outcome | Reproducible capture/compare/perf harness is on `main`; benchmark mechanics pass. This is not a claim that the current visuals meet M1 or M2. |

Retrospective verdict: **ACCEPTED / DONE**. The evidence is sufficient to reconstruct
candidate, base, review, verification, and integrated state without relying on the
historical branch description.

## 4. SP-01 historical evidence inventory

Historical branch: `origin/claude/p2-sdf-surfaces` at `3f04a75`.

Known touched paths:

- `public/render/scene.js`
- `public/render/turf.js`
- `test/hd-turf.test.mjs`
- `docs/fixtures/chambers-sweep.json`
- `docs/superpowers/plans/2026-07-07-p2a-sdf-surfaces.md`
- `docs/TODO.md`

Known delivered behavior on the historical branch:

- fwidth/SDF transition work for green, fairway, and bunker boundaries;
- a green collar presentation layer;
- class-map/fwidth reconciliation;
- dot-screen artifact correction;
- targeted turf tests.

Known unclosed gate:

- final hardware-backed capture comparison across the required course matrix;
- current-base conflict and regression analysis;
- explicit routing of the HD macro seam to SP-04;
- current `docs/TODO.md` and `docs/HANDOFF.md` reconciliation.

Until those are resolved, the historical branch remains **REPORTED**, not accepted.

## 5. Active constraints and risks

| Risk | Impact | Control |
|---|---|---|
| Dirty, stale original worktree | Updating it could overwrite user work or mix bases | Never integrate from or clean it; use isolated worktrees |
| P2a branch is 24 current-main commits behind and 13 commits ahead of its merge base | Blind cherry-pick may regress newer renderer and docs behavior | Current-base plan, commit classification, focused conflict tests |
| Visual tests can pass while appearance regresses | False completion claim | SP-00 hardware-backed before/after matrix and human-readable review |
| Historical “HD seam” label mixes causes | Scope expansion and incorrect fix | SP-01 diagnoses only; HD macro seam is SP-04 |
| `npm install` reports 3 high and 1 critical dependency audit findings | Security and packaging risk outside active visual scope | Record separately; do not run broad `npm audit fix` inside SP-01 |

## 6. Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-07-28 | Preserve the original dirty `main` worktree | User-owned changes and stale base make it unsafe for integration |
| 2026-07-28 | Use a dedicated PIC integration branch and worktree | Keeps program control artifacts and accepted integrations isolated |
| 2026-07-28 | Treat P2a as recovery, not as a ready merge | It predates SP-00/current main and lacks final capture evidence |
| 2026-07-28 | Route the HD macro seam to SP-04 | It is a far/HD-patch relief and light-response issue, not SP-01 edge readability |
| 2026-07-28 | Cap concurrent implementation lanes at two | Preserves one PIC and one independent-review capacity |
| 2026-07-28 | Accept the corrected SP-01 recovery plan | Independent re-review cleared all six Medium findings at 97% confidence |
| 2026-07-28 | Reject the first SP-01 candidate pending evidence correction | Static frames do not satisfy the accepted plan's explicit hardware movement-stability gate |

## 7. Current bottleneck

SP-01 is executing a narrow evidence correction in its isolated lane. Its current
bottleneck is a clean RTX 3060 adjacent-pose/orbit record proving that the corrected
authored-green edge remains stable under camera movement. No code defect or
performance regression is currently blocking the unit.
