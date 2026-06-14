import { RENDER_CONFIG } from './config.js';

const BASE = '/assets/';
export const ASSETS = {
  hdri: () => `${BASE}hdri/${RENDER_CONFIG.hdriFile}`,
  trees: {
    foliageDiff: `${BASE}trees/foliage_diff.jpg`,
    foliageAlpha: `${BASE}trees/foliage_alpha.jpg`,
    bark: `${BASE}trees/bark_diff.jpg`,
    broadleafDiff: `${BASE}trees/broadleaf_diff.jpg`,
    broadleafAlpha: `${BASE}trees/broadleaf_alpha.jpg`,
    broadleafBark: `${BASE}trees/broadleaf_bark.jpg`,
  },
  turf: {
    color: `${BASE}turf/grass_color.jpg`,
    normal: `${BASE}turf/grass_normal.jpg`,
    rough: `${BASE}turf/grass_rough.jpg`,
    sand: `${BASE}turf/sand_color.jpg`,
  },
};
