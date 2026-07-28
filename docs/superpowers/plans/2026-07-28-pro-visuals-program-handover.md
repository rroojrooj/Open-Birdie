# Pro Visuals Program — Program Handover

**Updated:** 2026-07-28
**Program status:** ACTIVE
**Immediate package:** SP-01 — recover, verify, and merge P2a

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

## Left

1. Add and capture the smallest deterministic Chambers adjacent-pose stability suite.
2. Record its clean manifest, exact Git SHA, hardware identity, and shimmer verdict.
3. Rerun focused tests, full tests, and `git diff --check`.
4. Independently re-review the corrected SP-01 candidate and integrate its PR only
   after all Medium-or-higher findings are cleared.
5. Start the reviewed SP-02a contract lane when capacity permits.

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
Set-Location 'C:\Users\USER\.config\superpowers\worktrees\Open-Birdie\pro-visuals-program-pic'
git status --short --branch
git rev-parse HEAD
npm test
```

Do not run `git reset`, `git clean`, `git pull`, or broad file-copy operations in
`C:\Users\USER\Documents\GitHub\Open-Birdie`. That worktree contains user state.

## Acceptance checkpoint

The accepted transition is:

```text
SP-01 ACTIVE (evidence correction)
    -> corrected candidate re-review and verification
```

No SP-01 candidate has been accepted into the current program base yet.

## Your turn

No user decision is required for the current in-scope technical recovery. The PIC can
continue through plan review and implementation. The next user-reserved decision is a
material scope change, a deliberate never-regress exception, or final visual acceptance.
