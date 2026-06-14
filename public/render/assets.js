import { RENDER_CONFIG } from './config.js';

const BASE = '/assets/';
export const ASSETS = {
  hdri: () => `${BASE}hdri/${RENDER_CONFIG.hdriFile}`,
  foliage: {
    coniferDiff: `${BASE}foliage/fir_twig_diff_1k.png`,
    coniferAlpha: `${BASE}foliage/fir_twig_alpha_1k.png`,
    deciduousDiff: `${BASE}foliage/leaves_diff_1k.png`,
  },
};
