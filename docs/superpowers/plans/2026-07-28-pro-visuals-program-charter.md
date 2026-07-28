# Pro Visuals Program — Program Charter

**Status:** ACTIVE
**Established:** 2026-07-28
**Program:** Open-Birdie Professional Visuals
**Program integration branch:** `codex/pro-visuals-program-pic`
**Integration base at establishment:** `origin/main` at `88c67d6e1eda2adcc52b8a84643c1b7f15d19ce5`

## 1. Mission

Raise Open-Birdie's rendered-course readability and credibility toward professional
golf-simulator presentation, while preserving deterministic course identity, physics,
hardware-backed visual evidence, performance budgets, and the automatic-course path.

The two product gates remain:

- **M1 — Automatic Course Baseline:** any supported course reads clearly and credibly
  without hand-authored course art.
- **M2 — Curated Hero Course:** Chambers Bay demonstrates the higher authored ceiling
  without contaminating automatic-course behavior.

The program does not claim literal TrackMan or GSPro parity. It closes the measurable
visual gaps defined by the design specification and records the remaining gap honestly.

## 2. Canonical control artifacts

| Artifact | Path | Purpose |
|---|---|---|
| Design specification source | Protected original worktree: `docs/superpowers/specs/2026-07-23-pro-visuals-program-design.md` | User-authored architecture source; do not modify or silently import it |
| Master-plan source | Protected original worktree: `docs/superpowers/plans/2026-07-23-pro-visuals-master-plan.md` | User-authored breakdown and sub-plan contract; accepted current-base sub-plans restate their owned requirements |
| Program-test source | Protected original worktree: `docs/superpowers/plans/2026-07-23-pro-visuals-test-plan.md` | User-authored verification source; accepted current-base sub-plans name their exact test paths |
| Program charter | `docs/superpowers/plans/2026-07-28-pro-visuals-program-charter.md` | Authority, isolation, review, and integration policy |
| Program ledger | `docs/superpowers/plans/2026-07-28-pro-visuals-program-ledger.md` | Live package status and evidence |
| Program handover | `docs/superpowers/plans/2026-07-28-pro-visuals-program-handover.md` | Resume point, risks, and immediate actions |

If prose conflicts, the order of precedence is: user direction, locked design
decisions, charter, master plan, accepted sub-plan, ledger, handover.

## 3. Authority and reserved decisions

### User-reserved

- Change program scope, quality bar, priority order, or release target.
- Make the final subjective visual-acceptance call at M1 and M2.
- Approve production publishing, release, destructive operations, or irreversible
  external changes.
- Accept a deliberate regression against a locked never-regress rule.

### Program-PIC authority

- Create and sequence in-scope plan units.
- Assign isolated implementation and review lanes.
- Make reversible technical and git-integration decisions inside accepted scope.
- Reject work that lacks evidence, violates scope, or regresses a locked rule.
- Integrate an accepted plan unit through the repository's normal PR/merge workflow.
- Update the canonical ledger and handover.

### Implementation-lane authority

An implementation owner may change only the claimed plan unit on its assigned branch
and worktree. It may not redefine program scope, accept its own work, merge its own
branch, or edit the program ledger's acceptance verdict.

## 4. Workspace and isolation policy

- The original worktree at
  `C:\Users\USER\Documents\GitHub\Open-Birdie` is user-owned, behind `origin/main`,
  and contains uncommitted work. Program work must not reset, clean, overwrite, or
  integrate from it.
- Program integration runs from
  `C:\Users\USER\.config\superpowers\worktrees\Open-Birdie\pro-visuals-program-pic`.
- Every implementation unit gets its own `codex/` branch and worktree based on the
  accepted integration base.
- A branch may have one active owner. Reviewers are read-only unless explicitly
  assigned a correction lane.
- Generated captures and machine-local course data stay outside git unless a sub-plan
  explicitly names a curated, size-bounded fixture.

The operating concurrency cap is **two implementation lanes**. This leaves capacity
for the PIC and an independent reviewer. Critical-path work has first claim on a slot.

## 5. Plan-unit lifecycle

```text
UNCLAIMED
    |
    v
PLAN_DRAFT -> PLAN_REVIEW -> READY
                              |
                              v
                           ACTIVE
                              |
                              v
                    CANDIDATE_SUBMITTED
                              |
                              v
                     REVIEWED / VERIFIED
                         |          |
                    changes       accepted
                         |          |
                         +--> ACTIVE|
                                    v
                               INTEGRATED
                                    |
                                    v
                                   DONE
```

Ledger status vocabulary:

- `UNCLAIMED` — no accepted sub-plan or owner.
- `READY` — reviewed plan exists and dependencies are met.
- `ACTIVE` — implementation lane is assigned.
- `REVIEW` — candidate is under independent review or verification.
- `BLOCKED` — a named dependency or unresolved finding prevents progress.
- `INTEGRATED` — accepted candidate is present on the program integration base.
- `DONE` — integration, verification, and ledger evidence are complete.
- `REPORTED` — historical work exists but has not yet been reconstructed and accepted.

## 6. Sub-plan and acceptance contract

Every substantive plan unit must satisfy the master plan's sub-plan authoring
contract before implementation. At minimum it records:

1. outcome and non-outcome;
2. existing code to reuse;
3. exact scope and non-scope;
4. Task 0 diagnostic gate;
5. architecture and dependency boundaries;
6. ordered implementation tasks with file or symbol targets;
7. codepath, user-flow, and visual test diagram;
8. realistic failure modes and visible behavior;
9. deterministic acceptance commands and required captures;
10. done record fields for candidate, base, review, verification, and integration.

Acceptance requires:

- exact candidate commit and exact review base;
- independent review with no unresolved Critical, High, or Medium findings;
- reviewer confidence of at least 75%;
- focused tests plus the full `npm test` suite on Node 22 or newer;
- required hardware-backed captures, manifests, and performance evidence for visual
  or renderer claims;
- clean candidate worktree and documented generated-data provenance;
- integrated-tree or ancestry proof after merge;
- updated ledger and handover.

Pre-charter work remains `REPORTED` until those fields are reconstructed. Historical
work is not accepted from commit messages alone.

## 7. Visual and performance evidence policy

- Pixel-diff statistics detect change; they do not prove improvement.
- Every visual claim requires reviewable frames from the canonical SP-00 capture
  harness and a human-readable before/after sheet.
- Software rendering, missing capability evidence, blank frames, dirty captures,
  mismatched manifests, or incomplete course inputs cannot pass a visual gate.
- Chambers Bay, TPC Sawgrass, and St Andrews are the minimum regression matrix unless
  a sub-plan adds a stricter set.
- Play, near, mid, far/overview, and required proof roles must remain comparable.
- The HD macro seam is owned by SP-04. SP-01 may diagnose and route it but may not
  silently expand into HD terrain or light-response work.
- Performance claims use the program test strategy's cadence, GPU-timer, memory, and
  quality-profile evidence. Unsupported metrics are reported as unsupported, not
  inferred as passing.

## 8. Dependency and integration policy

Critical sequence:

```text
SP-00 -> SP-01 -> SP-02b -> SP-03 + SP-04 -> SP-05 + SP-06 -> M1
             \-> SP-02a -/
M1 -> SP-07b -> SP-08 -> SP-09a + SP-09b -> M2
```

- SP-01 and SP-02a may run concurrently after each has an accepted sub-plan.
- SP-02b waits for both recovery and contract work it consumes.
- SP-03 and SP-04 may run concurrently only after their shared presentation contract
  is accepted.
- A successor does not consume an unintegrated predecessor.
- Each unit lands as a focused pull request. Integration records the PR, candidate
  head, base, merge commit, CI result, and post-merge verification.
- Conflicts are resolved in the implementation lane or a dedicated correction lane,
  then re-reviewed. The PIC integration branch does not become a scratch implementation
  branch.

## 9. Standing constraints

- Preserve `canonicalCourse`, `courseFingerprint`, HD bundle identity, cache-version,
  projection-origin, physics, shot, camera, and scoring behavior unless a reviewed
  sub-plan explicitly owns the change.
- Preserve automatic/curated isolation and fallback truthfulness.
- Prefer small, explicit modules and existing Three.js/Node patterns over parallel
  frameworks or premature abstraction.
- No visual phase is done on tests alone; no engineering phase is done on screenshots
  alone.
- Dependency vulnerabilities discovered during install are tracked separately unless
  they affect the active lane or make verification unsafe.

## 10. Completion

The program is complete only when M1 and M2 have passed with archived evidence, all
required package units are `DONE`, release verification is green, and the user makes
the final subjective acceptance decision. Partial success is reported by gate and by
remaining competitor-level gap; it is never rounded up to parity.
