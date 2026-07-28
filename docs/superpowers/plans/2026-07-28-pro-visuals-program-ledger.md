# Pro Visuals Program — Program Ledger

**Program status:** ACTIVE
**Last updated:** 2026-07-28
**Integration branch:** `codex/pro-visuals-program-pic`
**Current accepted base:** `origin/main` at `03a1ff73cd135bac2aa7e9d1d331aa1c2852bd76`

## 1. Executive state

- SP-00 is retrospectively accepted and integrated through PR #40.
- SP-01 is accepted and integrated through PR #43.
- The first SP-01 candidate was rejected for missing movement-stability evidence; the
  corrected candidate closed that gate and passed independent review at 99%.
- The first SP-02a code candidate `61d9ab7` was rejected at 97% with 3 High and
  6 Medium findings. Corrected candidate `5d13c1c` was rejected at 98% with 1 High,
  3 Medium, and 1 Low finding. Pass-3 code candidate `82e715d` closes all five and
  awaits independent review; integration remains the critical path.
- The original repository worktree is protected because it is 24 commits behind and
  contains user changes.

## 2. Plan-unit ledger

| Unit | Status | Owner/lane | Depends on | Candidate / integrated evidence | Next gate |
|---|---|---|---|---|---|
| SP-00 Visual benchmark | DONE | Historical `codex/sp00-visual-benchmark` | — | Candidate `7d89b6ac24eb965039d5bdae6a30c943718ea81e`; PR #40; merge `88c67d6e1eda2adcc52b8a84643c1b7f15d19ce5`; CI green; `npm test` 375/375 | Harness is mandatory evidence path for every later visual unit |
| SP-01 P2a recovery | DONE | `/root/sp01_implementation`; `codex/sp01-p2a-recovery` | SP-00 | Candidate `7e18723e294153ff086d222d8ecf94bcc3ca41e1`; ACCEPT 99%; PR #43; merge `03a1ff73cd135bac2aa7e9d1d331aa1c2852bd76`; CI and post-merge 382/382; RTX 3060 three-course, motion, and perf evidence; GPU median +0.038 ms | Feed the visible high-survey HD/far-photo seam into SP-04 |
| SP-02a CoursePresentation contract | REVIEW | `/root/sp01_implementation`; `codex/sp02a-course-presentation-contract` | SP-00 | Implementation base `2dd82c7`; rejected `61d9ab7` (97%, 0C/3H/6M/0L) and `5d13c1c` / docs `d8040a5` (98%, 0C/1H/3M/1L); pass-3 code candidate `82e715d`; focused 129/129; full 492/492; package gates green; RTX 3060 renderer-neutral compare 24/24 byte-identical. Synthetic result is valid but its process-close watchdog timed out; no orphan. | Independent pass-3 review, then PR/CI/merge/post-merge verification |
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
| Visual tests can pass while appearance regresses | False completion claim | SP-00 hardware-backed before/after matrix and human-readable review |
| Historical “HD seam” label mixes causes | Scope expansion and incorrect fix | SP-01 diagnoses only; HD macro seam is SP-04 |
| Shared raw texture follows a pre-existing multi-material disposal pattern | A disposed Three texture may be revisited during teardown | Recorded Low; revisit in a focused lifecycle unit, not as hidden SP-01 scope |
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
| 2026-07-28 | Accept and integrate corrected SP-01 candidate | Five-pose RTX 3060 evidence closed the Medium; independent acceptance 99%; PR #43 CI and post-merge suite green |
| 2026-07-28 | Reject the first SP-02a plan draft | Package-unsafe validator, inconsistent transaction types, and undefined runtime staging were High blockers; ten Medium and two Low contract gaps also required correction |
| 2026-07-28 | Reject the second SP-02a plan revision | Same-identity supersession could abort its own shared fetch; source-less v1 compatibility and private active-state ownership also required exact wording |
| 2026-07-28 | Accept the third SP-02a plan revision | Exact candidate `f8693c3` passed independent review at 98% with zero findings and dispatch YES |
| 2026-07-28 | Complete the SP-02a implementation candidate | Code candidate `61d9ab7` passes 116 focused and 478 full tests, deterministic/package gates, and a 24-frame exact-input renderer-neutral comparison; independent review owns severity of the recorded synthetic process-close timeout |
| 2026-07-28 | Reject the first SP-02a code candidate | Exact code `61d9ab7` / documentation `c7520a3` was rejected at 97% with 0 Critical, 3 High, 6 Medium, and 0 Low findings |
| 2026-07-28 | Complete the corrected SP-02a code candidate | Exact code `5d13c1c` closes all nine findings through six focused correction commits; 124 focused and 487 full tests, deterministic staging, package, and unpacked smoke gates pass |
| 2026-07-28 | Reject the corrected SP-02a code candidate | Exact code `5d13c1c` / documentation `d8040a5` was rejected at 98% with 0 Critical, 1 High, 3 Medium, and 1 Low finding |
| 2026-07-28 | Complete the SP-02a pass-3 code candidate | Exact code `82e715d` closes all five pass-2 findings: exact request-local asset verification without retained buffers, cached and X→Y→X cancellation, cancellable asynchronous lock wait, and total owned-temp cleanup; 129 focused and 492 full tests plus deterministic/package/smoke gates pass |

## 7. Current bottleneck

SP-02a independent pass-3 review is the current bottleneck. Review exact
code candidate `82e715d79bdce46a5f8e09c22b37fe7d417eba0e`, including the preserved
synthetic `result.json`/`CHILD_TIMEOUT` evidence, without expanding into unrelated
harness lifecycle work. If accepted, open the PR, require Windows CI, merge, prove
candidate ancestry or integrated-tree equivalence, and rerun the full suite on the
integrated base. SP-02b remains blocked until that completes.
