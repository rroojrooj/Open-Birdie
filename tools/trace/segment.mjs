// NDVI + texture pixel classifier. The pure implementation now lives in
// lib/segment-core.js (CommonJS) so the runtime (lib/classify-surfaces.js) can
// share the exact same math without an ESM import; this file is a thin ESM
// re-export shim so existing ESM consumers (tools/trace/*, test/segment.test.mjs)
// keep working unchanged.
export { ndvi, classifyPixel, textureStd, segmentWindow, maskOf } from '../../lib/segment-core.js';
