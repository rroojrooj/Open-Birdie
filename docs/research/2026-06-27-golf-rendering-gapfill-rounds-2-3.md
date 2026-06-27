# Golf Rendering — Gap-Fill (Rounds 2 & 3): Water, Sky, GI/AO

> **Status:** Research record (verified). Fills the "Scope gaps & open questions" of [2026-06-27-realistic-golf-game-architecture.md](./2026-06-27-realistic-golf-game-architecture.md) (round-1).
> **Date:** 2026-06-27
> **Why this exists:** Round-1 left 5 requested topics with **no surviving verified claims** (sources were blog/forum-tier and got filtered). Two focused follow-up passes re-ran narrower queries against primary engine docs + peer-reviewed papers.
> **Method:** Two adversarially-verified deep-research passes (3-vote / 2-of-3-to-kill).
> - **Round-2** (water, sky, sand/clubhouse): 114 agents, 31 sources, 139 claims → 23 confirmed / 2 killed. Run ID `wf_6fcfd955-36a`.
> - **Round-3** (GI/AO, mowing-stripes, sim engines, web-vs-UE5): 105 agents, 23 sources, 102 claims → 23 confirmed / 2 killed. Run ID `wf_86aa6e06-d1b`.
>
> **Honest scorecard up front:** **FILLED** — water, sky, real-time GI + ambient occlusion. **PARTIAL** — clubhouse assets (buildings only). **STILL OPEN after 2–3 tries** — fairway mowing-stripe authoring, the launch-monitor sim engines (strong-but-unverified TrackMan = Unity lead), and a measured web-vs-UE5 fidelity head-to-head (confirmed: no public one exists). Do not read this as "all gaps closed."

---

## TL;DR

- **Water (web/Three.js translation of the native recipe):** sample the scene color+depth render target and distort UVs for **screen-space refraction** (exactly what UE5's *Single Layer Water* does — not flat transparency). Tint by depth with **Beer-Lambert** absorption+scattering (deep water darkens/shifts physically). Drive **shoreline foam off a shallow-depth mask + a wave-pinch term**. At our elevated orbit cam, **prefer SSR or a reflection probe/cubemap** — planar reflection re-renders the whole scene.
- **Sky (use what Three.js ships):** the built-in **`Sky` object is a Preetham physically-based analytic sky** — zero shader work, real Rayleigh+Mie, time-of-day from sun position. Upgrade to **Hosek-Wilkie** only if sunsets matter. Hillaire 2020 (the UE5 *Sky Atmosphere* algorithm) is affordable and has WebGPU ports but is overkill. **Sky is not the fidelity bottleneck.**
- **GI + AO (mostly the native story):** UE5 **Lumen** is fully-dynamic GI and is **mutually exclusive with baked lightmaps**; Epic itself says baked lighting is impractical in large open worlds, so the native-UE5 path for a golf course leans Lumen (Software ray tracing, since a static course with many overlapping tree instances is the case that *penalizes* Hardware RT). On the **web path today**, GI = baked + IBL; for ambient occlusion use **GTAO** (radiometrically-correct, matches ray-traced ground truth) — **Three.js ships a `GTAOPass`**, so this one is directly actionable.
- **Still open (don't claim otherwise):** mowing-stripe authoring technique; which engines TrackMan/Foresight/Full Swing/Uneekor actually use (TrackMan posts Unity jobs — strong lead, unverified); and any measured web-vs-UE5 fidelity comparison (none exists publicly).

---

## GAP 1 — Water (FILLED, high confidence)

The native canon is **UE5 Single Layer Water**; the cross-engine reference with the most readable docs is **Unity Crest**. Both translate cleanly to a custom Three.js water shader.

| Technique | What it actually does | Open-Birdie (web) translation | Conf. | Source |
|---|---|---|---|---|
| **Screen-space refraction** (UE5 Single Layer Water) | Reads scene **depth + color below the surface** and distorts those samples — genuine refraction, **not** flat alpha transparency. | Render scene to a color+depth target, sample under the water plane, distort UVs by the surface normal. | ✅ 3-0 | [UE5 Single Layer Water](https://dev.epicgames.com/documentation/en-us/unreal-engine/single-layer-water-shading-model-in-unreal-engine) |
| **Beer-Lambert depth color** | Physically parameterized by **Scattering** + **Absorption Coefficients** (per-RGB, reciprocal meters) + a **PhaseG** phase function. Not a painted gradient. | Expose absorption+scattering coefficients; compute transmittance from water depth. Deep ponds darken/tint for free. | ✅ 3-0 | [UE5 Single Layer Water](https://dev.epicgames.com/documentation/en-us/unreal-engine/single-layer-water-shading-model-in-unreal-engine) |
| **Split absorption + scattering** (Crest) | Two depth-based sims combine; a **perceptual-color → absorption-coefficient** transform (`CalculateAbsorptionValueFromColor`) lets artists pick a color. | Same Beer-Lambert lever; author by color, convert to absorption density at load. | ✅ 3-0 | [Crest](https://docs.crest.waveharmonic.com/Manual/Appearance/Reflections.html) |
| **Shoreline blending + foam** (Crest) | Foam auto-generated where **very shallow** (`Shoreline Foam Max Depth`); **whitecaps** where waves are "pinched"; foam decays via `Foam Fade Rate`. | Drive foam off a **shallow-depth mask + a wave-pinch term**. Cheapest convincing shoreline. | ✅ 3-0 | [Crest](https://docs.crest.waveharmonic.com/Manual/Appearance/Reflections.html) |
| **Reflection tradeoff** | **Planar** re-renders the whole scene (Epic: *"budget half your frame time"*; reflects off-screen, no leak). **SSR** is far cheaper but can't reflect off-screen + leaks at edges. Planar both above+below water = "very expensive — enable only one." | At the orbit cam, **default to SSR or a cubemap/reflection probe**. Reserve planar for a hero still or one direction. | ✅ 3-0 (one sub-claim 2-1) | [UE5 Planar Reflections](https://dev.epicgames.com/documentation/en-us/unreal-engine/planar-reflections-in-unreal-engine), [Crest](https://docs.crest.waveharmonic.com/Manual/Appearance/Reflections.html) |

**Net:** a believable golf pond on the web = screen-space refraction + Beer-Lambert depth tint + shallow-depth foam mask + a cubemap/SSR reflection. No planar reflection needed at our camera.

---

## GAP 2 — Sky & Atmosphere (FILLED, high confidence)

| Technique | What it is | Open-Birdie (web) translation | Conf. | Source |
|---|---|---|---|---|
| **Three.js `Sky` (Preetham)** | Built-in `Sky`/`SkyMesh` implementing the **Preetham** analytic daylight model — *"the de facto standard for analytical skydomes."* Real Rayleigh+Mie. Params: `turbidity`(2), `rayleigh`(1), `mieCoefficient`(0.005), `mieDirectionalG`(0.8), `sunPosition`. | **Default web sky today.** Zero scattering shader to write; time-of-day by animating sun position. | ✅ 3-0 (param sub-claim 2-1) | [Three.js Sky](https://threejs.org/docs/pages/Sky.html), [SkyMesh](https://threejs.org/docs/pages/SkyMesh.html) |
| **Hosek-Wilkie** | Higher-quality analytic sky (SIGGRAPH 2012). Improves **sunsets and high turbidity** — Preetham's weak points. Benchmark vs ground truth: Preetham RMSE **88.1** vs Hosek **41.5**. | Port a Hosek-Wilkie GLSL impl **only if** golden-hour golf skies matter. | ✅ 3-0 | [Hosek-Wilkie](https://cgg.mff.cuni.cz/projects/SkylightModelling/), [benchmark](https://arxiv.org/abs/1612.04336) |
| **Hillaire 2020 scattering sky** | The algorithm behind **UE5's Sky Atmosphere** (EGSR 2020). Transmittance + non-linear Sky-View + 32³ aerial-perspective froxel LUTs; **O(1) multiple-scattering** = cheap time-of-day. | Overkill for a near-static sky, but **WebGPU/Three.js ports exist** if you want true aerial perspective on distant terrain. | ✅ 3-0 | [Hillaire EGSR 2020](https://sebh.github.io/publications/egsr2020.pdf), [UE5 Sky Atmosphere](https://dev.epicgames.com/documentation/en-us/unreal-engine/sky-atmosphere-component-in-unreal-engine) |
| **Cost** | Hillaire sky+aerial perspective = **~0.31 ms at 720p** (GTX 1080), **~1 ms on iPhone 6s** (Fortnite). | A full PBR sky is affordable. Spend the fidelity budget on terrain/turf/trees. | ✅ 3-0 ⚠️ native only | [Hillaire EGSR 2020](https://sebh.github.io/publications/egsr2020.pdf) |
| **Volumetric clouds (Guerrilla/HZD)** | Ray-marched **Perlin-Worley** noise + height presets; lighting = **Beer + Henyey-Greenstein + "powder sugar"**. Ships at **~2 ms** only via temporal reprojection (1-of-16 px / 4×4 block). | Blueprint for non-billboard clouds, but **must amortize**. For golf, billboard/HDRI clouds remain the pragmatic web default. | ✅ 3-0 ⚠️ PS4-class | [Guerrilla SIGGRAPH 2015](https://advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf) |

**Net:** ship the Three.js `Sky` (Preetham) now; Hosek-Wilkie if sunsets matter; reserve Hillaire/volumetric clouds for later. Sky is solved and cheap.

---

## GAP 3 — Bunkers/sand & clubhouse assets (PARTIAL — buildings only)

| Topic | Finding | Conf. | Source |
|---|---|---|---|
| **Clubhouse / building kits** | KitBash-style libraries are viable. **KitBash3D** kits ship at **5–20 M polys/kit**, average structure **~50k–100k polys**, "optimized for game engines." **Budget for decimation/LODs** — real outliers run far above average (a single tent at ~3 M polys). | ⚠️ medium (single vendor source) | [KitBash3D specs](https://help.kitbash3d.com/en/articles/6449661-what-are-the-tech-specs-of-your-kits-polycount-pbr-materials-real-time) |
| **Sand material authoring** (normal/roughness, raked/ripple, edge blending) | **No surviving evidence** after 2 rounds. Still open. | — | — |

> Open-Birdie already extrudes OSM buildings + a hero clubhouse. KitBash is for hero-asset quality, not the bulk. **The whole sand/bunker half of this gap is still open.**

---

## GAP 4 — Real-time GI & Ambient Occlusion (FILLED — mostly the native story; GTAO is the web takeaway)

### Global illumination (native UE5 path)

| Finding | Detail | Conf. | Source |
|---|---|---|---|
| **Lumen = UE5 default dynamic GI** | Fully-dynamic GI + reflections, **no baked lightmaps**, infinite diffuse bounces, mm-to-km, multiple ray-tracing methods. | ✅ 3-0 | [Lumen GI](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-global-illumination-and-reflections-in-unreal-engine) |
| **Two backends** | **Software RT** = fastest, the **only performant option with many overlapping instances**, requires Mesh Distance Fields. **Hardware RT** = higher quality, the only path to **mirror reflections + skinned meshes**, but more expensive and **sensitive to instance overlap** (falls back to SW RT). | ✅ 3-0 | [Lumen Perf Guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-performance-guide-for-unreal-engine), [Tech Details](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine) |
| **Lumen vs baked = mutually exclusive** | Enabling Lumen **disables precomputed static lighting, hides all lightmaps**, and Static-mobility lights become unsupported. The one hybrid: **Lumen Reflections** (not GI) can layer on baked-lightmap GI (requires HW RT mode). | ✅ 3-0 | [Tech Details](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine) |
| **Epic argues for dynamic GI outdoors** | *"Large, open-world environments present impractical requirements for baked lighting (even without a time-of-day system)"* — bake times, memory, texture storage. | ✅ 3-0 | [UE5 GI](https://dev.epicgames.com/documentation/unreal-engine/global-illumination-in-unreal-engine) |
| **Static course mostly dodges the RT cost** | The dominant ray-tracing cost is **per-frame BLAS rebuilds for deforming meshes** (skeletal meshes worst). Static meshes build once at load. *But* UE5 Landscape + WPO wind-foliage are flagged dynamic-BLAS contributors, so animated flags/wind-grass don't get a free pass. | ✅ 3-0 | [RT Perf Guide](https://dev.epicgames.com/documentation/unreal-engine/ray-tracing-performance-guide-in-unreal-engine?lang=en-US) |
| **Console budget** | Lumen targets **30/60 fps @ 1080p, 8ms/4ms GPU budgets** (GI + reflections on opaque & translucent + volumetric fog). | ✅ 3-0 | [Lumen Perf Guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-performance-guide-for-unreal-engine) |

**Net (native path):** if Open-Birdie ever goes UE5, a static course leans **Software-RT Lumen** (the many-overlapping-tree-instances case penalizes Hardware RT), or a **baked-GI + Lumen-Reflections** hybrid for low-spec. **None of this applies to the Three.js/WebGL path** — there, GI stays baked + IBL.

### Ambient occlusion (portable — this one IS the web takeaway)

| Finding | Detail | Conf. | Source |
|---|---|---|---|
| **GTAO = radiometrically-correct AO** | "Ground-Truth-based Ambient Occlusion" (Jimenez/Wu/Pesce/Jarabo, Activision 2016). Uses a **cosine/foreshortening-weighted horizon-based integral** that matches a Monte-Carlo ray-traced ground truth — vs HBAO/SSAO's **ad-hoc fall-off functions** (which over-darken edges with no physical basis). | ✅ 3-0 | [GTAO paper](https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf) |
| **XeGTAO = open-source reference** | Intel's **MIT-licensed** HLSL impl. Per Intel's own eval: faster + higher-detail + more radiometrically correct than HBAO+ / ASSAO (**0.56 ms @ 1080p on RTX 2060**). | ✅ 3-0 | [XeGTAO](https://github.com/GameTechDev/XeGTAO) |

**Net (web path):** **GTAO is the right AO choice and Three.js ships a `GTAOPass`** (postprocessing) — directly usable in Open-Birdie today. This validates GTAO already being on the renderer roadmap. (Caveat: the "GTAO beats HBAO+/ASSAO" numbers are the *authoring labs'* own evals — HBAO+ is closed-source, so no independent head-to-head exists.)

---

## What's still open (after 2–3 passes — round-4 targets)

1. **Fairway mowing-stripes (TARGET A sub-question, 2 failures).** The real-world light/dark stripe (grass-bend / light-reflection direction) is well documented; the **rendering technique is not citable** from primary sources. Candidates to chase: per-direction albedo/normal anisotropy, an alternating-direction tiling/mask texture, decals, or a view-dependent anisotropic-specular grass shader. Needs a GDC talk / paper / engine doc, not a blog.
2. **Launch-monitor sim engines (TARGET B, 2 failures — but a strong lead).** No claim survived to primary-source standard, **but round-3 fetched three TrackMan job postings explicitly for Unity roles**: [Unity Graphics Developer](https://www.trackman.com/careers/jobs/unity-graphics-developer), [Unity Technical Artist](https://careers.trackman.com/o/unity-technical-artist-3), [SDET – Virtual Golf – Unity](https://www.trackman.com/careers/jobs/software-developer-in-test-virtual-golf-unity). That's strong circumstantial evidence **TrackMan = Unity**; the verifier simply won't equate "hires Unity devs" with "the shipping renderer is Unity." Foresight/Full Swing/Uneekor remain unidentified. (Established elsewhere: GSPro = Unity, EA = Frostbite.)
3. **Measured web-vs-UE5 fidelity head-to-head (TARGET C — confirmed absent).** **No rigorous public benchmark exists** — verified across both rounds (the Scthe/nanite-webgpu project and UE-on-WASM talks were fetched but none is a fidelity head-to-head). **Implication:** the web-vs-native decision can't be grounded in published numbers; it must rest on **first-party testing of Open-Birdie at its actual elevated-orbit camera.** The prior "camera-dependent" read remains an internal hypothesis, not a sourced finding.

---

## Refuted claims (killed by the verifier — do not repeat)

- ❌ **"UE5 Single Layer Water reflections are primarily SSR composited with reflection-capture/sky."** Refuted 1-2.
- ❌ **"UE5's Sky Atmosphere is a precomputed-LUT, Bruneton-lineage approach."** Refuted 1-2 — Hillaire's **O(1)** method *replaces* the iterative precompute.
- ❌ **"GTAO recovers lost energy via a closed-form Neumann-series multi-bounce GI approximation with color bleeding."** Refuted 0-3 — GTAO is AO, not a multi-bounce GI solver. The surviving claim is the conservative one (radiometric correctness via the cosine term).
- ❌ **"The GTAO paper says HBAO 'simplifies the integral incorrectly.'"** Refuted 0-3 — the paper's critique is the ad-hoc fall-off in the obscurance lineage, not that phrasing.

---

## Caveats (read before acting)

- **Evidence is asymmetric web-vs-native.** Every hard perf number (Single Layer Water, Sky Atmosphere, Hillaire 0.31 ms / 1 ms, Guerrilla 2 ms, Lumen 8ms/4ms, XeGTAO 0.56 ms) is **native** (UE5/PS4/Metal/DirectX). The web side rests on Three.js `Sky` + `GTAOPass` + the *existence* of WebGPU ports. **No measured WebGL/WebGPU figures** survived. Treat web costs as extrapolation.
- **Lumen findings are native-UE5 only** and tied to current UE 5.8 docs (Epic revises per release; UE 5.5 added experimental static-lighting support for World Partition, softening — not negating — "baked is impractical outdoors").
- **GTAO comparative superiority is the authoring labs' own claim**, not independent benchmark (HBAO+ closed-source). The *technique definition* (radiometric correctness) is solid; the *beats-everyone* framing is scoped "per Activision / Intel."
- **Citation rot:** Crest's `…/WaterAppearance.html` 404s; content moved to `/Manual/Appearance/Reflections.html`. Water findings cite the new path.
- **Confidence is about *what the technique does*, not web-vs-native superiority** — that head-to-head was never measured (still open).

---

## Sources (verified; primary unless noted)

**Water/Sky (round-2)**
- UE5 Single Layer Water · Planar Reflections — <https://dev.epicgames.com/documentation/en-us/unreal-engine/single-layer-water-shading-model-in-unreal-engine>, <https://dev.epicgames.com/documentation/en-us/unreal-engine/planar-reflections-in-unreal-engine>
- Unity Crest (note URL restructure) — <https://docs.crest.waveharmonic.com/Manual/Appearance/Reflections.html>
- Hillaire 2020 · UE5 Sky Atmosphere — <https://sebh.github.io/publications/egsr2020.pdf>, <https://dev.epicgames.com/documentation/en-us/unreal-engine/sky-atmosphere-component-in-unreal-engine>
- Three.js Sky / SkyMesh — <https://threejs.org/docs/pages/Sky.html>, <https://threejs.org/docs/pages/SkyMesh.html>
- Hosek-Wilkie + benchmark — <https://cgg.mff.cuni.cz/projects/SkylightModelling/>, <https://arxiv.org/abs/1612.04336>
- Guerrilla volumetric clouds (SIGGRAPH 2015) — <https://advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf>
- KitBash3D specs (vendor) — <https://help.kitbash3d.com/en/articles/6449661-what-are-the-tech-specs-of-your-kits-polycount-pbr-materials-real-time>

**GI/AO (round-3)**
- Lumen GI · Tech Details · Perf Guide · Hardware RT · UE5 GI · RT Perf Guide — <https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-global-illumination-and-reflections-in-unreal-engine>, <https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine>, <https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-performance-guide-for-unreal-engine>, <https://dev.epicgames.com/documentation/en-us/unreal-engine/hardware-ray-tracing-in-unreal-engine>, <https://dev.epicgames.com/documentation/unreal-engine/global-illumination-in-unreal-engine>, <https://dev.epicgames.com/documentation/unreal-engine/ray-tracing-performance-guide-in-unreal-engine?lang=en-US>
- GTAO paper (Activision) · XeGTAO (Intel) — <https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf>, <https://github.com/GameTechDev/XeGTAO>

**Unverified leads (do NOT cite as fact)**
- TrackMan Unity job postings — <https://www.trackman.com/careers/jobs/unity-graphics-developer>, <https://careers.trackman.com/o/unity-technical-artist-3>
- Nanite-on-WebGPU (round-4 web-vs-native lead) — <https://github.com/Scthe/nanite-webgpu>

---

*Run stats — Round-2: 114 agents, ~5.06 M tokens, 31 sources, 139→25→23 confirmed (`wf_6fcfd955-36a`). Round-3: 105 agents, ~4.68 M tokens, 23 sources, 102→25→23 confirmed (`wf_86aa6e06-d1b`).*
