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
