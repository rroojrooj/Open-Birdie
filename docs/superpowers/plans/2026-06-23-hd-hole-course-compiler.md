# HD Hole Course Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and validate one offline Bandon Dunes Hole 1 bundle from public 3DEP/NAIP data, then load it coherently into Open-Birdie physics and rendering.

**Architecture:** Work is split into four independently reviewable phase plans. Foundation defines the secure/reproducible contract; provider ingestion and runtime integration build against that contract; visual acceptance combines both and decides whether scaling beyond one hole is justified.

**Tech Stack:** Node.js 18+, Electron, Three.js, Node test runner, PNGJS, Ajv, GeoTIFF.js, Proj4js, Sharp, USGS 3DEP, USDA NAIP via Planetary Computer STAC/COGs.

---

## Source of truth

- Approved design: `docs/superpowers/specs/2026-06-23-hd-hole-course-compiler-design.md`
- Prototype: Bandon Dunes Hole 1 only
- Normal test suite stays offline and deterministic.
- Provider smoke/build commands are explicit opt-in network operations.
- Implementation work should begin in a dedicated `codex/hd-hole-compiler` worktree/branch.

## Phase plans and dependency graph

```text
Plan 1 — Compiler foundation
          │
          ├───────────────┐
          ▼               ▼
Plan 2 — Provider      Plan 3 — Runtime
ingestion/compiler     integration
          │               │
          └───────┬───────┘
                  ▼
Plan 4 — Visual acceptance and delivery decision
```

1. `docs/superpowers/plans/2026-06-23-hd-compiler-foundation.md`
2. `docs/superpowers/plans/2026-06-23-hd-provider-ingestion.md`
3. `docs/superpowers/plans/2026-06-23-hd-runtime-integration.md`
4. `docs/superpowers/plans/2026-06-23-hd-visual-acceptance-delivery.md`

Plans 2 and 3 may run in parallel only after Plan 1 is committed and its contract tests pass.
Plan 4 starts after Plans 2 and 3 are integrated on the same branch.

## Global engineering rules

- Use `@test-driven-development` for every implementation task.
- Use `@systematic-debugging` for any provider, coordinate, renderer, or performance failure.
- Use `@verification-before-completion` before completing each phase.
- Do not add shader-only visual tuning unless a fixed acceptance capture proves it is needed.
- Do not silently fall back in compiler code. Throw `HdCompileError` with stage/code/context.
- Runtime distinguishes normal absence from explicit rejection/load failure.
- Do not commit provider downloads or generated HD bundles.
- Keep compiler-only geospatial dependencies out of the packaged Electron runtime.

## Global completion gate

- [ ] All four phase plans are complete.
- [ ] `npm test` passes.
- [ ] The live provider smoke test passes for the pinned Bandon sources.
- [ ] A Bandon Hole 1 bundle validates and is reproducible at the logical-contract level.
- [ ] Procedural and HD tee/landing/approach captures are reviewed side by side.
- [ ] 1080p RTX 3060 performance meets ≤16.8 ms average frame time (or ≥99% of a measured
      59–60 Hz refresh cap) and at least 45 FPS 1%-low.
- [ ] Local HD load completes under 5 seconds.
- [ ] Conservative decoded GPU resource estimate remains below 250 MB.
- [ ] Renderer and physics sample the same HD terrain contract.
- [ ] Missing/corrupt bundles produce coherent procedural fallback.
- [ ] Actual bundle/workspace sizes and remaining risks are documented.
- [ ] A written go/no-go decision is made before any full-course work.
