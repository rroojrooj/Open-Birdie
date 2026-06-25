// Verified browser loader for an HD bundle's four assets.
//
// All-or-nothing: every asset's SHA-256 + byte length + dimensions are verified
// (and the terrain is decoded as exact little-endian Float32) BEFORE any texture
// is handed to the scene. On any failure — or a stale course revision — partial
// resources are released and the loader throws. The returned handle owns its
// textures/ImageBitmaps; dispose() frees them exactly once. fetchImpl/imageDecoder
// are injectable so the loader is testable headless (createImageBitmap is
// browser-only; crypto.subtle is available in both).

import * as THREE from 'three';

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function loadHdBundle(meta, { fetchImpl = fetch, imageDecoder, expectedRevision, signal } = {}) {
  if (expectedRevision != null && meta.courseRevision != null && meta.courseRevision !== expectedRevision) {
    throw new Error('HD_STALE_REVISION');
  }
  const url = (key) => `/api/hd-assets/${meta.bundleId}/${key}`;

  const fetchVerified = async (key, expectedSha, expectedBytes) => {
    const res = await fetchImpl(url(key), { signal });
    if (!res.ok) throw new Error(`HD_FETCH_${key}: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (expectedBytes != null && bytes.length !== expectedBytes) throw new Error(`HD_LENGTH_${key}`);
    if (await sha256Hex(bytes) !== expectedSha) throw new Error(`HD_HASH_${key}`);
    return bytes;
  };

  const created = []; // { tex, bitmap } — released on partial failure or dispose()
  try {
    const tBytes = await fetchVerified('terrain', meta.terrain.sha256, meta.terrain.bytes);
    const { nx, ny, cellM } = meta.terrain;
    if (tBytes.length !== nx * ny * 4) throw new Error('HD_TERRAIN_LENGTH');
    const view = new DataView(tBytes.buffer, tBytes.byteOffset, tBytes.byteLength);
    const heights = new Float32Array(nx * ny);
    for (let i = 0; i < heights.length; i += 1) {
      const v = view.getFloat32(i * 4, true); // little-endian
      if (!Number.isFinite(v)) throw new Error('HD_TERRAIN_NONFINITE');
      heights[i] = v;
    }

    const loadTexture = async (key, descr, colorSpace) => {
      const bytes = await fetchVerified(key, descr.sha256, descr.bytes);
      const bitmap = await imageDecoder(bytes, { premultiplyAlpha: 'none' });
      if (bitmap.width !== descr.width || bitmap.height !== descr.height) {
        bitmap.close?.();
        throw new Error(`HD_DIM_${key}`);
      }
      const tex = new THREE.Texture(bitmap);
      tex.colorSpace = colorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      created.push({ tex, bitmap });
      return tex;
    };

    const orthophoto = await loadTexture('orthophoto', meta.image, THREE.SRGBColorSpace);
    const surfaces = await loadTexture('surfaces', meta.surfaces, THREE.NoColorSpace);
    const coverage = await loadTexture('coverage', meta.coverage, THREE.NoColorSpace);

    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const { tex, bitmap } of created) { tex.dispose(); bitmap.close?.(); }
    };

    return {
      bundleId: meta.bundleId,
      terrain: { heights, nx, ny, cellM, bounds: meta.bounds, edgeBlendM: 0, kind: 'hd-hole' },
      orthophoto, surfaces, coverage, dispose,
    };
  } catch (err) {
    for (const { tex, bitmap } of created) { tex.dispose(); bitmap.close?.(); }
    throw err;
  }
}
