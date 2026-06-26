// HD build-manifest discovery: resolve a "pending" manifest into a buildable one.
//
// The CLI `build` refuses a pending manifest (config.mjs assertBuildable). This
// fills the three discovery-derived fields it needs: the course fingerprint
// (pins the exact cached OSM parse), the snapped compilation bounds, and the
// per-asset NAIP content-length + ETag (so a build is reproducible and silent
// object drift is caught). The fingerprint + bounds are pure; only the NAIP STAC
// search and the 1-byte COG drift read touch the network — both are injected, so
// the resolver is unit-tested offline and cli.mjs wires the live providers.

import { canonicalCourseFingerprint } from './course-source.mjs';
import { computeHoleBounds, snapHdBounds } from './bounds.mjs';
import { localToWgs84 } from './coordinates.mjs';
import { selectPinnedAcquisition, assetHref } from './naip.mjs';
import { parseManifest } from './config.mjs';
import { HdCompileError } from './errors.mjs';

// The padded, grid-snapped hole rectangle (local metres) plus its WGS84 search
// bbox for NAIP. The build recomputes its own snapped bounds; the stored bounds
// are the provider-search extent / provenance.
export function holeExtent(course, manifest) {
  const raw = computeHoleBounds(course, manifest.hole, manifest.padding);
  const snapped = snapHdBounds(raw, { coarse: course.elevation, targetSpacingM: manifest.terrain.targetSpacingM });
  const corners = [
    [snapped.minX, snapped.minY], [snapped.maxX, snapped.minY],
    [snapped.minX, snapped.maxY], [snapped.maxX, snapped.maxY],
  ].map(([x, y]) => localToWgs84({ x, y }, course.origin));
  const lats = corners.map((c) => c.lat);
  const lons = corners.map((c) => c.lon);
  const bbox = { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };
  return { snapped, bbox };
}

export async function resolveManifest({ manifest, course, providers }) {
  const fingerprint = canonicalCourseFingerprint(course);
  const { snapped, bbox } = holeExtent(course, manifest);

  const features = await providers.searchNaipCandidates({ bbox, endpoint: manifest.providers.imagery });
  const picked = selectPinnedAcquisition(features, manifest);
  const assets = [];
  for (const f of picked) {
    const url = assetHref(f);
    const { total, etag } = await providers.assertCogDrift({ url });
    if (!Number.isInteger(total) || total < 1 || !etag) {
      throw new HdCompileError('discover-imagery', 'HD_DISCOVER_ASSET_META', { url, total, etag: etag ?? null });
    }
    assets.push({ url, contentLength: total, etag });
  }

  const next = {
    ...manifest,
    course: { ...manifest.course, fingerprint },
    discovered: {
      state: 'resolved',
      bounds: { minX: snapped.minX, minY: snapped.minY, maxX: snapped.maxX, maxY: snapped.maxY },
      assets,
    },
  };
  return parseManifest(next); // schema re-validate (fail closed); returns next
}
