import { RENDER_CONFIG } from './config.js';

const BASE = '/assets/';
export const ASSETS = {
  hdri: () => `${BASE}hdri/${RENDER_CONFIG.hdriFile}`,
  trees: {
    conifer: `${BASE}trees/conifer.glb`,
  },
};
