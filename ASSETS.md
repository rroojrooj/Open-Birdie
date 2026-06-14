# Bundled CC0 Assets

All assets below are CC0 (public domain) unless noted. No attribution is legally
required for CC0; recorded here for provenance.

## HDRIs
- `public/assets/hdri/puresky_4k.hdr` — "Kloofendal 48d Partly Cloudy (Pure Sky)" by
  Poly Haven (CC0). Source: https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
  Environment map (image-based lighting) + sky background (Tier 0). A pure-sky HDRI so
  the backdrop reads as real sky, not a photographed tree-line; GroundedSkybox is
  disabled with it (it has no ground detail to project).

## Trees (Tier 1)
- `public/assets/trees/conifer.glb` — decimated from "Fir Tree 01" by Poly Haven (CC0).
  Source: https://polyhaven.com/a/fir_tree_01
  The original ~7M-triangle film model was decimated with gltf-transform to ~80k tris
  (textures 1k) for GPU instancing. Used as the photoreal conifer model.

## Turf textures (Tier 2)
- `public/assets/turf/grass_{color,normal,rough}.jpg` — "Grass 004" by ambientCG (CC0).
  Source: https://ambientcg.com/view?id=Grass004
  Tiled PBR grass: albedo blade detail, normal, and roughness, blended under the painted
  surface splat and modulated by shader mowing stripes (`public/render/turf.js`).
- `public/assets/turf/sand_{color,normal,rough}.jpg` — "Coast Sand 02" by Poly Haven (CC0).
  Source: https://polyhaven.com/a/coast_sand_02
  Tiled bunker sand, brightened in-shader and mixed in on the bunker mask.
