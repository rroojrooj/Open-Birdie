# Engine / Infrastructure Path Decision — Stay on Web vs. Pivot to a Game Engine

> **Status:** DECIDED — Hybrid, web-native (do **not** pivot the engine).
> **Date:** 2026-06-20
> **Question that prompted this:** "What infrastructure do pro golf sims (TrackMan, Uneekor, GSPro, Foresight…) use to build their game, and should Open-Birdie pivot that way to become a pro-grade sim?"
> **Method:** A multi-source, adversarially-verified deep-research pass (103 agents, 21 sources fetched, 25 claims verified 3-vote / 2-of-3-to-kill, 21 confirmed) followed by an independent, deliberately-unbiased decision memo (Opus, briefed to steelman all three paths and not defer to any prior take). Both converged on the same answer.
>
> This doc is the record. It closes the "do we have a research report on alternative infrastructure?" gap (we didn't, before this).

---

## TL;DR — the decision

**Stay on the web/Three.js stack. Do NOT pivot to Unity or Unreal. Adopt a _hybrid content model_ instead:**

1. **Procedural OSM tier** (the moat no competitor has) — every course on Earth, generated live, now upgraded with **open high-res LIDAR** terrain → target ~7/10 fidelity.
2. **Baked hero-course tier** (the "wow" reel) — 5–10 marquee courses authored offline, **baked** (lightmaps/AO), shipped as static bundles, rendered by the **same web renderer** → target ~8–9/10.

**Single biggest deciding factor:** Open-Birdie is built almost entirely by AI coding agents on a ~100%-text stack (JS/GLSL/HTML/JSON). A game-engine pivot moves the bulk of the work into binary scenes, prefabs, material graphs, and lighting bakes that an AI agent cannot author like text — converting the project's greatest force-multiplier into its greatest bottleneck — for a fidelity gain the evidence says comes from **content and lighting, not the engine.**

---

## Part 1 — What professional golf sims actually run

| Product | Engine | Course pipeline | Confidence |
|---|---|---|---|
| **GSPro** | **Unity** | **Baked.** Courses hand-authored offline via the **OPCD Toolset** (Blender add-on + Inkscape + Unity → FBX); 2,000+ LIDAR-based community courses | ✅ **Verified 3-0** — primary vendor sources |
| **Foresight FSX Play** | **Unity** (HDRP per retailers) | Not established | ✅ **Verified 3-0** — primary vendor source + users hitting Unity runtime errors in the wild |
| **TrackMan (Virtual Golf 3)** | *Markets an in-house "graphics engine"* | *Markets a rebuilt course library* | ⚠️ **UNVERIFIED** — only source was a marketing press release; both claims were **killed by the verifier on sourcing grounds** (not disproven — just not authoritatively sourced) |
| **Uneekor, E6/TruGolf, Full Swing, Awesome/Creative Golf** | — | — | ❌ **No surviving evidence** — these vendors don't publish their stack |

**The one universal, well-evidenced finding:** every *documented* commercial sim **bakes** its courses (pre-modeled offline in DCC tools). **None generate at runtime.** Open-Birdie's live OSM→mesh approach is the genuine inverse — it is unique, not behind.

> **Caveat the developer should know:** the two products specifically asked about — **TrackMan and Uneekor** — are exactly the ones that could not be authoritatively sourced. A focused round-2 (patents, job postings, GDC talks, teardown forums) could fill this if it matters.

---

## Part 2 — Feasibility of a pivot (verified findings)

1. **The premise "engines require baked content" is FALSE.** ✅ 3-0. Both Unity (runtime mesh-collider cooking / `Physics.BakeMesh`; docs explicitly cite "procedural surfaces") and Unreal (`ProceduralMeshComponent` / `RuntimeMeshComponent` / `DynamicMesh`) support runtime procedural mesh **with collision**. Runtime OSM→course generation *could* technically survive a pivot.
2. **…but the existence proofs are dormant.** ✅ 3-0. UtyMap (Unity, runtime OSM→mesh — structurally the same shape as Open-Birdie's pipeline) and `ue4plugins/StreetMap` (Unreal) prove the *pattern*, but both are unmaintained and operate at **editor-time**, not as turnkey live-streaming in a packaged build. Production-readiness for live in-game OSM streaming is **not** proven; the integration effort is real and unquantified.
3. **The launch-monitor layer ports cheaply.** ✅ 3-0. GSPro Open Connect is a public spec (TCP `127.0.0.1:921`, plain JSON, no auth), already reimplemented in Java/Python/C#/JS — and Open-Birdie already implements it in **~115 lines of Node** (`lib/openconnect.js`). Not a blocker for any stack.
4. **Baked GI is incompatible with runtime-procedural courses — in ANY engine.** ✅ 3-0. Baked global illumination (a large part of the "pro look") needs static, known-ahead geometry. Unreal's marquee **Nanite Landscape is bake-only** (a sculpt edit triggers a non-free rebuild). So pivoting does **not** rescue procedural-course fidelity — the same wall exists natively. This limitation follows the *runtime-generation choice*, not the rendering tech.
5. **High-res open LIDAR is ingestible into the CURRENT web stack.** ✅ (research-identified) USGS 3DEP (~1 m, US), UK EA LIDAR, and other national open sets — a major terrain-fidelity upgrade with **no engine change** (coverage is patchy globally; needs tiling/LOD).
6. **Realism is a content-pipeline advantage, not an engine advantage.** ✅ The pros look good because of **baked LIDAR content + asset pipelines + art teams**, not Unity/Unreal per se. GSPro runs on the same Unity anyone can use.

---

## The decision, in full

### Why hybrid web-native, not a pivot

"Pro-grade" decomposes into six axes; **four are not engine-bound at all**, and Open-Birdie is already at/near the bar on the two that most establish credibility as a *launch-monitor* sim:

| Axis | Bar | Open-Birdie today | Engine the bottleneck? |
|---|---|---|---|
| Physics / ball flight | within a few % of tour TrackMan | **near the bar** (carries ~3%) | **No** — pure math, `lib/physics.js` |
| LM integration | "plug in my monitor, it just works" | **at the bar** | **No** — `lib/openconnect.js` |
| Course quality | greens/contours read true on courses people want | breadth ✅, per-course depth ✗ | Partly — the real battleground |
| Visual fidelity | a still a golfer accepts as real | **~5/10**, climbing | **Mostly no** — driven by content + light |
| UX / "is this a product" | one-click signed installer, settings UI | **behind** (no signed installer yet) | **No** — Electron does signed installers |
| Distribution | runs on the tablet/phone sim golfers use | **ahead** (web mirror) | **No** — web is an advantage |

The unmet bar is: **the last ~3–4 points of visual fidelity, the depth of a few marquee courses, and product packaging** — none of which an engine uniquely unlocks.

### The crux, confronted

The real tension is **not** "procedural vs. engine." It is **"procedural breadth vs. baked depth."** Pivoting to Unity would inherit the *same* baked-GI incompatibility (Finding 4), so "pivot to get pro visuals on procedural courses" is partly a mirage — full migration cost, identical limitation.

Resolution: **stop forcing one pipeline to do both jobs.** Keep procedural-OSM for infinite breadth (+ LIDAR for real contours); add an optional baked hero tier for the "wow" courses.

**The unlock:** you only need a game engine to *author* baked GI interactively — you don't need one to *consume* it. Baked lighting is just textures, and WebGL renders baked lightmaps perfectly. Since this project authors via scripts/agents, an **offline bake script** (headless Blender / a lightmapper invoked from Node) fits the text-stack model *better* than a GUI engine.

---

## Roadmap (solo-via-agents, impact-ordered)

0. **Signed one-click installer** (`electron-builder`) + minimal settings UI for the env-var config. *Cheapest credibility win; pure ops; fully agent-doable. README already flags this as missing.* **Verify:** fresh-machine install → launch → connect LM → hit a shot, no terminal.
1. **Ingest open LIDAR** (USGS 3DEP ~1 m; UK EA) into `lib/elevation.js`, with fallback to AWS Terrain Tiles where coverage is absent. *Highest-leverage fidelity lever; improves look **and** play (putts/roll).* **Verify:** 3DEP vs. Terrarium green-contour diff; putts break correctly.
2. **Close the real-time fidelity gap** — bundled CC0 PBR turf via a **region-mask + world-UV** material (the `_paintSplat` rewrite), real mow stripes, bunker lips/depth, water shoreline+specular; resolve the GTAO-won't-compile issue (it recompiles the custom `onBeforeCompile` materials and fails). **Verify:** blind before/after on Augusta + Bandon; target an independent ≥7/10.
3. **Prove the baked hero-course format on ONE course** — define the bundle (geometry seeded from OSM extraction + LIDAR heightfield + baked lightmap/AO + curated materials + pin/tee metadata); write a **headless offline baker**; teach the renderer to detect + sample the baked channel. *Riskiest assumption — de-risk on one course before scaling.* **Verify:** hero course renders with baked GI in-app, side-by-side vs. its procedural version and a GSPro screenshot.
4. **Productionize 5–10 hero courses** + build the landing/trailer surface off them.
5. **WebGPU migration only if evidence demands** — Three.js WebGPU/TSL, same language/repo/agent-authorability, no engine, no license change. *Last, because you're not necessarily at the WebGL2 ceiling.*

**Docs gate:** each move updates `README.md`, `CHANGELOG.md`, and `docs/visual-upgrade-plan.md` (now **stale** — it predates the modular `water.js`/`grass.js`/`tree-cards.js`/`env.js` split and the 0.5–0.7 releases; fold in the hero-course tier + LIDAR).

---

## What would change this decision (pivot becomes right if…)

1. **The AI-agent constraint relaxes** — collaborators join, or Unity agent-tooling matures enough to drive editor/material/lighting authoring. *(The big one; watch it.)*
2. **Move 3 fails** — offline-bake → web-consume can't clear ~8/10 on one hero course at acceptable size/perf.
3. **The goal narrows to "match GSPro's exact look + its 2,000-course marketplace"** — then you're out-GSPro-ing GSPro on its turf; be on its engine (and accept it's no longer a solo/MIT/runtime-generation project).
4. **Monetization** makes max visual fidelity the only thing the marginal buyer cares about.

---

## Monetization & openness (can this make money?)

Money is **independent of the engine** — every stack permits it. **GSPro charging ~$250/yr (Unity + community-baked courses) proves the market pays for golf sims.**

Openness/revenue models, least → most lucrative:

| Model | Meaning | Ceiling |
|---|---|---|
| Fully open (MIT) + donations | current; anyone can fork | Low |
| **Open-core** | open base, paid premium tier (LIDAR/hero-course packs, hosted multiplayer, cloud sync) | Medium |
| Source-available (BSL/PolyForm) | code visible, competing/commercial use barred | Med-high |
| Closed + paid (GSPro model) | one-time or subscription | High |
| Freemium | free app, paid content/features | Med-high |

Engine constraints layered on top:
- **Web stack:** owe nobody anything; **all five models available.** Only self-imposed catch: an MIT-public repo is legally forkable (monetize via official builds / hosting / premium content).
- **Unity:** **$0 royalty** (Runtime Fee cancelled). Free until **$200k/yr** trailing-12-month revenue, then paid per-seat Pro. Engine can't ship in a public MIT repo.
- **Unreal:** **$0 until $1M lifetime gross, then 5% royalty.** Your game code may stay MIT; the engine can't live in a public MIT repo.

**Conclusion:** the engine barely affects *whether* you can earn — only the distribution model and (at real scale) a small cut. **Recommended: open-core / paid premium content on the current web stack** — viable today, no engine needed. The natural premium products are exactly the roadmap's outputs (LIDAR packs, baked hero courses).

---

## AI-agent development consideration (load-bearing)

The current web stack is **~100% text** — ideal for AI coding agents, which is *how this project is built* (v0.2 → v0.7, agent-driven). Unity/Unreal development is heavily **GUI/editor-driven** (scene setup, component wiring, material graphs, lighting bakes living in binary files an agent can't edit like text). Emerging engine AI-tooling (Unity Muse, Unity MCP servers, Unreal assistants) is immature. **A pivot would shift work from "agent does ~90%" to "agent does ~40%, the solo human does the editor grind."** This is the decisive asymmetry.

---

## Sources (verified, primary unless noted)

- GSPro = Unity + OPCD baked pipeline — <https://zerosandonesgcd.com/open-platform-course-designer/>, <https://zerosandonesgcd.com/opcd-course-creation/>, <https://gsprogolf.com>
- Foresight FSX Play = Unity — <https://www.foresightsports.com/pages/fsx-play>
- Unity runtime mesh collision — <https://docs.unity3d.com/Manual//prepare-mesh-for-mesh-collider.html>, <https://docs.unity3d.com/ScriptReference/Physics.BakeMesh.html>
- Unreal runtime mesh — <https://github.com/DXGatech/RuntimeMeshComponent>
- Runtime OSM→mesh existence proofs — <https://github.com/reinterpretcat/utymap>, <https://github.com/ue4plugins/StreetMap>
- Unreal Nanite Landscape is bake-only — <https://dev.epicgames.com/documentation/en-us/unreal-engine/using-nanite-with-landscapes-in-unreal-engine>
- GSPro Open Connect spec — <https://gsprogolf.com/GSProConnectV1.html>; reimplementations: <https://github.com/kenjdavidson/gspro-connector>, <https://github.com/springbok/MLM2PRO-GSPro-Connector>, <https://github.com/tnbozman/gspro-interface>
- Unity licensing — <https://github.com/Unity-Technologies/TermsOfService> (mirror of unity.com legal, which 403-blocks fetchers)
- Unreal licensing — <https://www.unrealengine.com/license>
- Windows code signing (relevant to Move 0) — <https://www.electronforge.io/guides/code-signing/code-signing-windows>

---

## Caveats & open questions

- **Part 1 scope gap:** engine/pipeline details are well-evidenced only for **GSPro and Foresight**. TrackMan, Uneekor, E6/TruGolf, Full Swing, and Awesome/Creative Golf are **unverified** (the TrackMan proprietary-engine and VG3-baked-course claims were refuted *on sourcing grounds*, not disproven).
- **Existence proof ≠ production-ready:** UtyMap / StreetMap prove architectural feasibility only; both are dormant and editor-time. Live OSM streaming in a *packaged* engine build is unproven and the effort is unquantified.
- **No migration-effort estimate** was independently sourced (OSM-pipeline rebuild, and the drag+Magnus physics port + re-validation, are real and unmeasured).
- **License terms are time-sensitive** (Unity changed drastically in 2023–24; re-verify before any commitment). Several primary legal pages 403-block fetchers; terms were verified via official GitHub mirrors / CDN PDFs (one step removed).
- **`docs/visual-upgrade-plan.md` is stale** relative to the shipped 0.5–0.7 renderer.
