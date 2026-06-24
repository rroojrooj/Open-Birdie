// NAIP imagery discovery + pinned-acquisition selection.
//
// Discovery queries the STAC API for candidates intersecting the hole bounds;
// selection then enforces the build manifest's pins (exact item IDs, one shared
// acquisition date, GSD, known CRS) so a build is reproducible and never silently
// mixes acquisition years. The committed manifest — not the live API — is
// authoritative; this stage just confirms reality still matches it.

import { HdCompileError } from './errors.mjs';

export function assetHref(feature) {
  const href = feature && feature.assets && feature.assets.image && feature.assets.image.href;
  if (!href) throw new HdCompileError('discover-imagery', 'HD_NAIP_NO_ASSET', { id: feature && feature.id });
  return href;
}

export async function searchNaipCandidates({ bbox, fetchImpl = fetch, endpoint }) {
  const body = JSON.stringify({
    collections: ['naip'],
    bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
    limit: 100,
  });
  let res;
  try {
    res = await fetchImpl(`${endpoint}/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  } catch (cause) {
    throw new HdCompileError('discover-imagery', 'HD_NAIP_SEARCH', { endpoint }, cause);
  }
  if (!res.ok) throw new HdCompileError('discover-imagery', 'HD_NAIP_SEARCH', { status: res.status });
  const json = await res.json();
  return json.features || [];
}

export function selectPinnedAcquisition(features, manifest) {
  const wanted = manifest.imagery.itemIds;
  const byId = new Map((features || []).map((f) => [f.id, f]));

  const picked = [];
  for (const id of wanted) {
    const f = byId.get(id);
    if (!f) throw new HdCompileError('discover-imagery', 'HD_NAIP_MISSING_ITEM', { id });
    picked.push(f);
  }

  for (const f of picked) {
    const props = f.properties || {};
    const date = String(props.datetime || '').slice(0, 10);
    if (date !== manifest.imagery.date) {
      throw new HdCompileError('discover-imagery', 'HD_NAIP_DATE_MISMATCH', { id: f.id, date, expected: manifest.imagery.date });
    }
    if (props.gsd == null || Math.abs(props.gsd - manifest.imagery.gsdM) > 0.05) {
      throw new HdCompileError('discover-imagery', 'HD_NAIP_GSD', { id: f.id, gsd: props.gsd, expected: manifest.imagery.gsdM });
    }
    if (props['proj:epsg'] == null) {
      throw new HdCompileError('discover-imagery', 'HD_NAIP_CRS', { id: f.id });
    }
  }

  // Deterministic order regardless of API ordering.
  return picked.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
