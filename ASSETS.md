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
- `public/assets/trees/foliage_diff.jpg`, `foliage_alpha.jpg`, `bark_diff.jpg` — from
  "Fir Tree 01" by Poly Haven (CC0). Source: https://polyhaven.com/a/fir_tree_01
  The original is a ~7M-triangle film model whose foliage is millions of geometric
  needles — decimating that to an instanceable budget collapses the needles into bare
  sticks. Instead we reuse the model's **needle-sprig atlas** (`twig_diff` color +
  `twig_alpha` cutout) and **bark** (`bark_diff`) on procedurally-built foliage cards:
  a tapered bark trunk + a conical canopy of cross-fan cards (`public/render/tree-cards.js`).
  Lush and cheap to instance (~800 tris/tree vs ~80k for the decimated model).
- `public/assets/trees/broadleaf_{diff,alpha,bark}.jpg` — from "Jacaranda Tree" by Poly
  Haven (CC0). Source: https://polyhaven.com/a/jacaranda_tree
  Its `leaves_diff`/`leaves_alpha` is a true leaf-CLUSTER atlas (3 bipinnate fronds) and
  `branches_diff` is the bark. Used the same card technique for a feathery deciduous
  canopy (rounded), mixed ~30% into the conifer stand for an Augusta-style mixed tree line.

## Turf textures (Tier 2)
- `public/assets/turf/grass_{color,normal,rough}.jpg` — "Grass 004" by ambientCG (CC0).
  Source: https://ambientcg.com/view?id=Grass004
  Tiled PBR grass: albedo blade detail, normal, and roughness, blended under the painted
  surface splat and modulated by shader mowing stripes (`public/render/turf.js`).
- `public/assets/turf/sand_{color,normal,rough}.jpg` — "Coast Sand 02" by Poly Haven (CC0).
  Source: https://polyhaven.com/a/coast_sand_02
  Tiled bunker sand, brightened in-shader and mixed in on the bunker mask.
