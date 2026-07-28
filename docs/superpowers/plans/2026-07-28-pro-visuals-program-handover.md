# Pro Visuals Program — Program Handover

**Updated:** 2026-07-28
**Program status:** ACTIVE
**Immediate package:** SP-02a — independent pass-3 review and integration

## Done

- Merged SP-00 through PR #40.
- Verified `origin/main` at
  `88c67d6e1eda2adcc52b8a84643c1b7f15d19ce5`.
- Reconstructed SP-00 evidence: candidate `7d89b6a`, green CI, and local 375/375 tests.
- Ran the program census and confirmed there are no open pull requests.
- Protected the original worktree, which is 24 commits behind and contains user edits
  and generated data.
- Created clean PIC worktree:
  `C:\Users\USER\.config\superpowers\worktrees\Open-Birdie\pro-visuals-program-pic`
  on `codex/pro-visuals-program-pic`.
- Verified the clean base with Node `v22.20.0` and `npm test`: 375 passed, 0 failed.
- Located the historical detailed P2a plan and its 13-commit implementation branch.
- Established the program charter and ledger.
- Authored the current-base SP-01 recovery plan.
- Ran a recovery audit and two-pass independent plan gate. The first pass rejected six
  Medium gaps; all were corrected; the second pass accepted at 97% confidence with no
  remaining blockers.
- Dispatched `/root/sp01_implementation` in
  `C:\Users\USER\.config\superpowers\worktrees\Open-Birdie\sp01-p2a-recovery` on
  `codex/sp01-p2a-recovery`; focused baseline tests pass 61/61.
- Built first candidate `b4ab4a237777d217efeaeae874343e5a7f238c29`.
  Focused tests pass 67/67 and the full suite passes 381/381.
- Captured clean three-course before/after, comparison, smoke, and performance
  evidence on an RTX 3060. Median GPU time changed from 15.400 ms to 15.438 ms
  (+0.038 ms); textures and geometries remained flat.
- Independently reviewed the first candidate at 97% confidence. Code and static
  visual judgments passed, but the candidate was rejected for one Medium evidence
  gap: no adjacent-pose/orbit record proved the claimed movement stability.
- Added a closed five-pose adjacent-yaw suite and captured clean RTX 3060 evidence at
  exact Git SHA `a261b564946e000f1688e3e7138f470441f89138`.
- Accepted corrected candidate `7e18723e294153ff086d222d8ecf94bcc3ca41e1`
  at 99% confidence with no unresolved Critical, High, or Medium findings.
- Merged SP-01 through PR #43 as
  `03a1ff73cd135bac2aa7e9d1d331aa1c2852bd76`; Windows CI passed, candidate
  ancestry was verified, and the clean post-merge suite passed 382/382.
- Completed the current-base SP-02a code/API census and authored
  `2026-07-28-sp02a-course-presentation-contract.md` for independent review.
- Kept the user-authored 2026-07-23 source documents untouched in the protected
  original worktree. The SP-02a plan is self-contained and records how it resolves
  their six contract contradictions.
- Ran independent plan-engineering review on draft `dc8814f`. It rejected dispatch at
  97% confidence with 3 High, 10 Medium, and 2 Low findings.
- Incorporated every recommended correction, including dependency-free packaged
  validator proof, explicit prepared/active transaction types, exact staged runtime
  schemas/tree, deterministic canonical bytes, exact-handle asset hashing, GLB
  parsing, bootstrap ordering, safe dependency order, one rollback gate, concurrent
  cache acquisition, and Windows path/header hardening.
- Ran pass-2 review of exact candidate `6c3494d0b0193a54052ab03183e95f6a50fc3c51`.
  It closed every prior High and rejected at 96% for one Medium and two Low findings:
  same-identity supersession could abort its shared fetch; source-less v1 build/read
  wording and retained private active-state ownership were ambiguous.
- Corrected all three findings by assigning abort ownership to the source-keyed
  acquisition coordinator, adding exact same-/different-ID abort-capable race tests,
  limiting source-less v1 support to already-built manifests, and defining private
  `ActiveCourseState` ownership.
- Accepted exact SP-02a plan candidate
  `f8693c3c2995a674d8f5827682d38a820deb227d` in pass 3 at 98% confidence with
  zero Critical, High, Medium, or Low findings and dispatch YES.
- Implemented Tasks 1–9 on `codex/sp02a-course-presentation-contract` from exact base
  `2dd82c7e503e3f974a9abebeeba8b9d71ce449ef`. Code evidence candidate:
  `61d9ab78edd1f56e361b7884d203d832483a6c65`.
- Passed the required focused matrix 116/116, full suite 478/478, deterministic
  course-art check, Windows unpacked package, packaged-root smoke, and asar scan.
- Captured exact-input RTX 3060 base/candidate evidence and compared 24/24 frames
  byte-identically with flat renderer counters. No renderer source changed.
- Preserved two final-candidate synthetic retry failures exactly: each child wrote a
  complete valid result with no page/fatal errors, then failed to emit process
  `close` before `CHILD_TIMEOUT`; no orphan remained. Earlier top-level smoke at
  `b30d3a3` and the later final-candidate three-course capture are green. Independent
  review assigns severity; SP-02a does not absorb unrelated harness lifecycle work.
- Independently reviewed exact first code candidate `61d9ab7` / documentation
  descendant `c7520a3` at 97% and rejected it with 0 Critical, 3 High, 6 Medium,
  and 0 Low findings.
- Corrected every finding in six focused commits: `e95ad4a` (owned verified asset
  bytes and one-read ownership), `be8546a` (canonical identity and native abort),
  `91b9de0` (stable-bound legacy gameplay and `DATA_DIR/courses`),
  `02eb751` (cross-process cache publication), `e2e9a78` (typed HD rejection),
  and `5d13c1c` (client-compatible activation errors).
- Verified corrected code candidate
  `5d13c1c5ba8de2628dd294f24bcf5a589065407e`: focused matrix 124/124,
  full suite 487/487, deterministic course-art check, Windows unpacked package,
  staged and unpacked smoke all pass.
- Independently reviewed exact corrected code candidate `5d13c1c` / documentation
  descendant `d8040a5` at 98% and rejected it with 0 Critical, 1 High, 3 Medium,
  and 1 Low finding.
- Corrected all five pass-2 findings in `82e715d` plus final contract pin `5215524`: request-local bounded exact-handle
  validation for GET/HEAD/304 with no active asset `Buffer`; real cached-load and
  X→Y→X coordinator cancellation; asynchronous cancellable legacy publication-lock
  acquisition; and `finally` cleanup for late winners, aborts, partial staging
  failures, and publication errors.
- Verified pass-3 code candidate
  `521552466ece23cee6134285fce1ef4d344b3932`: focused matrix 129/129,
  full suite 492/492, deterministic course-art check, Windows unpacked package,
  staged and unpacked smoke all pass.

## Left

1. Independently review exact pass-3 code candidate `5215524`, including the preserved
   synthetic process-close evidence.
2. If accepted, open the PR, require Windows CI, merge, and prove ancestry or
   integrated-tree equivalence.
3. Rerun the 492-test full suite on the integrated base and close the Done Record.
4. Keep SP-02b renderer work blocked until those gates complete.

## Current facts

- Historical source: `origin/claude/p2-sdf-surfaces` at `3f04a75`.
- Historical merge base: `fe8e677eefa0b4d8690a970a8684e1a2fcc5d17e`.
- Historical delta: 13 commits, 6 paths, approximately 480 insertions and 43 deletions.
- The old plan implemented its Tasks 1–4, but its final multi-course capture and
  documentation gate was not completed.
- The HD macro seam is explicitly deferred to SP-04; SP-01 owns surface-edge
  readability and collar behavior only.
- Candidate review also noted a non-blocking Low: shared raw surface textures follow
  the renderer's pre-existing multi-material disposal pattern. Three.js disposal is
  effectively idempotent; do not expand the evidence correction into lifecycle
  refactoring.

## Resume commands

```powershell
Set-Location 'C:\Users\USER\.config\superpowers\worktrees\Open-Birdie\sp02a-course-presentation-contract'
git status --short --branch
git rev-parse HEAD
npm test
```

Do not run `git reset`, `git clean`, `git pull`, or broad file-copy operations in
`C:\Users\USER\Documents\GitHub\Open-Birdie`. That worktree contains user state.

## Acceptance checkpoint

The accepted transition is:

```text
SP-01 DONE + SP-02a PLAN ACCEPTED
    -> SP-02a candidate independent review
    -> PR / Windows CI / merge / post-merge verification
    -> SP-02b may be planned and dispatched
```

SP-01 is present on `origin/main`; SP-02a has a corrected candidate awaiting
independent re-review and integration.

## Your turn

No user decision is required for the independent SP-02a candidate gate or normal
integration. The next user-reserved decision is a material scope change, a deliberate
never-regress exception, or final visual acceptance.
