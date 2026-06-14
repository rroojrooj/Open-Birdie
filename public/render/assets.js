import { RENDER_CONFIG } from './config.js';

const BASE = '/assets/';
export const ASSETS = {
  hdri: () => `${BASE}hdri/${RENDER_CONFIG.hdriFile}`,
  trees: {
    conifer: `${BASE}trees/conifer.glb`,
  },
  turf: {
    color: `${BASE}turf/grass_color.jpg`,
    normal: `${BASE}turf/grass_normal.jpg`,
    rough: `${BASE}turf/grass_rough.jpg`,
    sand: `${BASE}turf/sand_color.jpg`,
  },
};
