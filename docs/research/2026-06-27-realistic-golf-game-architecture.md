# Building a Realistic 3D Golf Game — End-to-End System Architecture

> **Status:** Research record (verified). Informs, does not override, [2026-06-20-engine-path-decision.md](./2026-06-20-engine-path-decision.md).
> **Date:** 2026-06-27
> **Question that prompted this:** "How does a game creator build a genuinely REAL 3D golf game — the full system architecture, not a flat 'paint on a paper' course? Real 3D trees, slope, bunkers, clubhouse, water, sky. Reference real-life courses + pro sims + the actual system code. Goal is reality — open to a native engine over web if it delivers better reality."
> **Method:** Multi-source, adversarially-verified deep-research pass (106 agents, 23 sources fetched, 103 claims extracted, top 25 verified by 3-vote / 2-of-3-to-kill → 23 confirmed, 2 killed).
>
> This doc is the record of the **rendering/pipeline** half. The **engine decision** half lives in the sibling doc above; the two converge.

---

## TL;DR

**Realism is a DATA-and-pipeline problem layered on standard real-time rendering — not a single shader trick.** A course reads as "paint on paper" when the *inputs* are flat (low-res elevation, billboard trees, flat turf albedo), not because the renderer is missing a magic effect. This directly confirms Open-Birdie's own QL1 field finding (real 1 m lidar fixed the "flat/ink-on-paper" terrain — it was a data problem, not a shader one).

The verified end-to-end pipeline:

```
Real elevation (USGS 3DEP lidar, 1 m where QL2+)        Real imagery (NAIP/satellite aerial)
        │                                                        │
        ▼                                                        ▼
  PDAL ingest (JSON: ELM→outlier→SMRF ground→class 2→GeoTIFF DEM)   macro albedo / masks
        │                                                        │
        ▼                                                        │
  Heightmap ──► GPU geometry clipmaps (vertex-texture displacement, ◄┘
               toroidal updates, morph + degenerate-triangle seams)
               — or — Cesium ion quantized-mesh quadtree (web-native streaming)
        │
        ├──► Vegetation: SpeedTree LOD (volumetric near → billboard impostor far);
        │     leaf cards camera-facing + 3D leaf meshes; **alpha-to-coverage, NOT MSAA**
        │     hero turf: per-blade GPU-compute Bézier grass (indirect draw) / shell texturing
        │
        └──► (Real-course replication) aerial LIDAR drones/helis/planes + photogrammetry + GPS
              → point cloud → procedural → heightfield + masks → engine editor
```

**Engine reality (the only verified web-vs-native fact):** every confirmed shipping reference product runs on a **native** engine — EA Sports PGA Tour on **Frostbite**, GSPro on **Unity**. The research did **not** prove web can't reach parity; the market simply chose native. The honest verdict is **camera-dependent** (see [Part 4](#part-4--the-engine-question-verified-fact--reasoned-read)).

---

## Part 1 — Terrain & slope (the backbone)

| Stage | What the pros do | Confidence | Source |
|---|---|---|---|
| **Data source** | USGS **3DEP**: 1 m DEM where QL2+ lidar exists (1 m seamless "S1M" product in production since mid-2025, coverage expanding); raw point clouds (LAZ/LAS) streamable as Entwine tiles on AWS Open Data. **Fidelity is gated by Quality Level/vintage** — 2014+ usually meets QL2, pre-2014 often does not. | ✅ 3-0 | [USGS 3DEP](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services), [AWS](https://registry.opendata.aws/usgs-lidar/) |
| **Ingestion (open-source)** | **PDAL** (BSD) JSON pipeline: noise removal (ELM, class 7) → outlier filter → **SMRF ground classification** (Pingel 2013) → keep class-2 ground → rasterize to georeferenced GeoTIFF DEM (`writers.gdal`, GTiff) at configurable resolution (e.g. 1.0 m). No proprietary GIS required. | ✅ 3-0 (medium — blog head source, mechanism corroborated by primary PDAL docs + peer-reviewed paper) | [PDAL](https://pdal.io/), [tutorial](https://opensourceoptions.com/how-to-create-a-dem-or-raster-from-a-lidar-point-cloud/), [SMRF paper](https://www.sciencedirect.com/science/article/pii/S0924271613000026) |
| **Render — continuous LOD** | **GPU geometry clipmaps**: nested regular grids centered on the viewer, incrementally shifted via **toroidal/wraparound** addressing; elevation applied by **vertex-texture displacement** — z sampled from a single-channel 2D height texture in the vertex shader (x,y are constant vertex data; no filtering, vertices map 1:1 to texels). | ✅ 3-0 | [GPU Gems 2, Ch.2](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry) (Asirvatham & Hoppe, the inventors) |
| **Crack-free seams** | Morph geometry/textures toward the next-coarser level in a transition ring at each level's perimeter (`z' = (1−α)·z_fine + α·z_coarse`, α ramps over ~n/10 grid units) **+ a string of zero-area (degenerate) triangles** to eliminate T-junctions between levels. | ✅ 3-0 | GPU Gems 2, Ch.2 (corroborated by Losasso & Hoppe, SIGGRAPH 2004) |
| **Web-native alternative** | **Cesium ion** quantized-mesh / quadtree: raster heightmaps → tiled streamed 3D terrain, coarse tiles seamlessly replaced as the viewer approaches. Ingests GeoTIFF, USGS ASCII DEM/CDED, DTED, Arc/Info ASCII Grid, FLT — anything GDAL supports. (Caveat: output is quantized-mesh 3D Tiles for CesiumJS, not arbitrary Three.js; resolution still gates fidelity.) | ✅ 3-0 / 2-1 | [Cesium ion](https://cesium.com/learn/3d-tiling/ion-tile-terrain/), [quantized-mesh spec](https://github.com/CesiumGS/quantized-mesh) |

---

## Part 2 — Vegetation & turf (why trees/grass read as real or flat)

1. **Trees = LOD-driven volumetric → impostor.** SpeedTree renders full geometry up close, then swaps to **billboard impostors** (~4 triangles, slice-cutout atlases generated by the Compiler) at distance. Vendor docs, verbatim: *"LOD is King — no other single adjustment will impact the frame rate as much as scaling the LOD parameters down"* (global `world::tree_lod_scalar`). Draw distance mostly drives billboard count. ✅ 3-0 — [SpeedTree GPU](https://docs.speedtree.com/doku.php?id=gpu_topics), [billboards](https://docs.speedtree.com/doku.php?id=compiler_billboards)
2. **Leaf detail = camera-facing leaf cards used *alongside* 3D leaf meshes** (not instead of). SpeedTree: *"Leaf cards always turn to face the camera... parallel to the view plane."* ✅ 3-0 — [GPU Gems 3, Ch.4](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-4-next-generation-speedtree-rendering)
3. **THE foliage/grass gotcha (likely biting Open-Birdie):** standard **MSAA does NOT anti-alias alpha-tested cutout edges** (leaves, grass blades) — the visible silhouette is the alpha-texture boundary *inside* the quad, not the geometric polygon edge. MSAA shades once per triangle per pixel, so the alpha-test decision applies uniformly to all samples. **You must use alpha-to-coverage (A2C / ATOC).** ✅ 3-0 — [GPU Gems 3, Ch.4](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-4-next-generation-speedtree-rendering), [Ben Golus](https://bgolus.medium.com/anti-aliased-alpha-test-the-esoteric-alpha-to-coverage-8b177335ae4f)
4. **Hero/foreground turf = real per-blade GPU geometry.** A compute pass turns a "lane ID" into a jittered tile-grid position, applies distance/frustum/occlusion culling, reads grass type/height from a texture, and emits per-blade instance data for an **indirect draw**. Each blade is a **cubic-Bézier** mesh (control points = height/tilt/bend/side-curve); the vertex shader steps vertices in the width direction off the curve. LOD drops blade vertices 15 → 7 (Ghost of Tsushima). ✅ 3-0 — [Sucker Punch, GDC 2021](https://archive.thedatadungeon.com/ghost_of_tsushima_2020/documents/gdc_2021/gdc_2021_procedural_grass_in_got.pdf)
5. **Cheaper dense grass = shell texturing** — stack multiple geometry shells along the base-mesh normal (compute shader), discard fragments where shell height exceeds a mask-texture value. Trade-offs: overdraw, artifacts, scalability. ✅ 3-0 (medium — traces to the peer-reviewed [Lengyel/Praun/Finkelstein/Hoppe fur paper](https://hhoppe.com/fur.pdf))

> ⚠️ **Open-Birdie-specific caveat (from our own prior testing, not this research):** per-blade/shell *geometry* grass is the **wrong lever for our elevated orbit camera** — blades go sub-pixel at distance and read as rough. The lever at that camera is turf **albedo/value/normal + satellite albedo**. Treat techniques 4–5 as **foreground-only** for golf.

---

## Part 3 — Replicating a real course

EA Sports PGA Tour's documented pipeline (the concrete reference): **LiDAR-equipped drones, helicopters and planes** map each course's terrain; high-density point clouds + photogrammetry + survey-grade GPS + on-site ground photography are processed through **procedural software to extract heightfield maps and masks**, which are imported into the Frostbite Editor and refined by artists. Not pure manual sculpting; not pure automation — **capture → procedural → artist**. ✅ 3-0 — [EA Frostbite blog](https://www.ea.com/frostbite/news/procedural-terrain-in-ea-sports-pga-tour), [Xbox Wire](https://news.xbox.com/en-us/2023/01/19/ea-sports-pga-tour-preview/)

---

## Part 4 — The engine question (verified fact + reasoned read)

**Verified fact — the only hard web-vs-native data point:** every shipping reference product the research could confirm runs on a **native engine**, not web:

| Product | Engine | Course pipeline | Confidence |
|---|---|---|---|
| **EA Sports PGA Tour** (consumer AAA) | **Frostbite** (proprietary) | aerial LIDAR → procedural → heightfield+masks → Frostbite Editor | ✅ 3-0 |
| **GSPro** (launch-monitor sim) | **Unity** | LIDAR → Unity via OPCD toolset; "GSPro Unity course file V4" | ✅ 3-0 |

This is a real signal — the market chose native — but the research **did not** produce a verified head-to-head proving web *cannot* reach parity. The rest of this section is **engineering reasoning, not verified research.**

The web-vs-native gap is **camera-dependent**, and Open-Birdie's documented camera (elevated orbit) is the favorable case:

| "Reality" lever | Web/Three.js | Native (UE5 Nanite+Lumen) | Matters at elevated orbit cam? |
|---|---|---|---|
| Accurate LIDAR relief | ✅ identical (data, not engine) | ✅ identical | **Decisive** |
| Macro aerial/satellite albedo | ✅ fully achievable | ✅ | **Decisive** |
| Tree silhouettes (instanced + impostors) | ✅ good | ✅ better tooling (Nanite foliage) | Yes |
| Realtime GI / area shadows | ⚠️ limited (baked + SSAO/GTAO + IBL; WebGPU closing) | ✅ Lumen, clearly ahead | Moderate |
| Dense per-blade grass / ground foliage | ⚠️ costly | ✅ Nanite/virtualized | **Sub-pixel — irrelevant** |
| Draw distance / asset budget | ⚠️ RAM + download-size capped | ✅ streaming, far more headroom | Moderate |

**Verdict:**
- **Elevated broadcast/orbit camera** → the gap narrows sharply (everything native is best at goes sub-pixel). **Web stays defensible** — consistent with the sibling engine-path-decision doc (stay web; decisive factor = the AI-agent text stack).
- **Ground-level, walk-the-fairway, first-person photoreal** turf + realtime GI → **native UE5 (Nanite + Lumen) is the rational choice.** This is where web genuinely can't match it today.

**Reality alone doesn't pick the engine; the target camera does.**

---

## Refuted claims (killed by the verifier — do not repeat)

- ❌ **"GSPro's 2,500+ courses are *all* LIDAR-based."** Refuted 0-3. Many are hand-authored. — [gsprogolf.com](https://gsprogolf.com/)
- ❌ **"EA's helicopter LiDAR produced data 30× denser than public data."** Refuted 0-3 (marketing, unverifiable). — [Xbox Wire](https://news.xbox.com/en-us/2023/01/19/ea-sports-pga-tour-preview/)

---

## Scope gaps & open questions (the research came up empty here)

These were explicitly requested but produced **no surviving verified claims** (fetched sources were blog/forum-tier and got filtered). A focused round-2 with narrower queries (UE5 docs, SIGGRAPH water/sky talks, sim-vendor engineering posts) could fill them:

1. **Water** — planar reflections, SSR, refraction, foam, depth.
2. **Sky & atmosphere** — physically-based sky models, HDRI, volumetric clouds, time-of-day.
3. **Bunkers/sand & clubhouse/architecture assets.**
4. **Lighting & GI specifics** — baked lightmaps vs realtime GI (Lumen/SSGI), GTAO/HBAO, PBR + mowing-stripe authoring.
5. **A rigorous web-vs-UE5 fidelity head-to-head**, and the engines behind **TrackMan / Foresight / Full Swing / Uneekor** (only GSPro = Unity was verified here; Foresight = Unity is verified in the sibling doc).

---

## Sources (verified; primary unless noted)

- Terrain LOD / clipmaps / vegetation cards (primary) — <https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry>, <https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-4-next-generation-speedtree-rendering>
- SpeedTree LOD/billboards (primary) — <https://docs.speedtree.com/doku.php?id=gpu_topics>, <https://docs.speedtree.com/doku.php?id=compiler_billboards>
- Per-blade GPU grass (primary, GDC) — <https://archive.thedatadungeon.com/ghost_of_tsushima_2020/documents/gdc_2021/gdc_2021_procedural_grass_in_got.pdf>
- Alpha-to-coverage vs MSAA (primary + canonical write-up) — <https://bgolus.medium.com/anti-aliased-alpha-test-the-esoteric-alpha-to-coverage-8b177335ae4f>
- Shell texturing (peer-reviewed origin) — <https://hhoppe.com/fur.pdf>
- USGS 3DEP elevation data (primary) — <https://www.usgs.gov/3d-elevation-program/about-3dep-products-services>, <https://registry.opendata.aws/usgs-lidar/>
- PDAL LIDAR→DEM (primary docs + peer-reviewed SMRF; blog tutorial head) — <https://pdal.io/>, <https://www.sciencedirect.com/science/article/pii/S0924271613000026>, <https://opensourceoptions.com/how-to-create-a-dem-or-raster-from-a-lidar-point-cloud/>
- Cesium ion terrain (primary) — <https://cesium.com/learn/3d-tiling/ion-tile-terrain/>, <https://github.com/CesiumGS/quantized-mesh>
- EA PGA Tour = Frostbite + capture pipeline (primary + secondary) — <https://www.ea.com/frostbite/news/procedural-terrain-in-ea-sports-pga-tour>, <https://news.xbox.com/en-us/2023/01/19/ea-sports-pga-tour-preview/>
- GSPro = Unity + OPCD (primary) — <https://gsprogolf.com/>, <https://zerosandonesgcd.com/open-platform-course-designer/>

---

## Caveats

- **Source strength:** terrain-LOD and vegetation findings rest on top-tier primary sources (NVIDIA GPU Gems, the geometry-clipmap inventors; Sucker Punch GDC; vendor SpeedTree/Cesium/USGS docs). The PDAL pipeline and shell-texturing findings have blog-tier *head* sources (held at medium confidence) though their mechanisms are corroborated by primary docs / peer-reviewed papers.
- **Time-sensitivity:** USGS 3DEP coverage and the 1 m S1M product are actively expanding (S1M production from mid-2025; ~99% national lidar coverage targeted by end of FY2025). Per-course coverage must be checked live. SpeedTree (v10) and Cesium pipelines continue to evolve. EA capture details are a fixed 2023 record.
- **Data-ceiling reality:** accepting a GIS format or having a 1 m product nominally available is necessary but **not** sufficient — achievable fidelity is gated by lidar Quality Level/vintage at the specific site, which is why honest 1 m realism is partly a **site-selection** problem, not purely an engineering one (matches the Bandon ~3.4 m vs Chambers Bay 1 m field findings).
- **The engine finding reports which engines two reference *products* chose — it does NOT prove web cannot reach parity, nor that native is necessary.** Parts (1)–(5) of the Scope Gaps remain genuinely open.
