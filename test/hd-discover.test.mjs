import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveManifest } from '../tools/hd-course/discover.mjs';
import { canonicalCourseFingerprint } from '../tools/hd-course/course-source.mjs';
import { parseManifest, isBuildable } from '../tools/hd-course/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const course = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'hd-course', 'course.json'), 'utf8'));

// A pending manifest, exactly as the committed Bandon one ships it.
function pendingManifest() {
  return {
    schemaVersion: 1,
    course: { name: course.name, cacheVersion: 3, fingerprint: 'pending' },
    hole: 1,
    padding: 30,
    terrain: { targetSpacingM: 3.0, crs: 'EPSG:3857' },
    imagery: { collection: 'naip', date: '2022-06-23', gsdM: 1.5, itemIds: ['item-a', 'item-b'] },
    providers: { elevation: 'https://e.test', imagery: 'https://i.test' },
    limits: { maxPixels: 80000000, maxDownloadBytes: 3221225472, maxBundleBytes: 157286400 },
    normalization: { format: 'webp', quality: 90 },
    discovered: { state: 'pending' },
  };
}

// A NAIP STAC feature whose properties satisfy selectPinnedAcquisition's pins.
function feature(id) {
  return {
    id,
    properties: { datetime: '2022-06-23T19:02:00Z', gsd: 1.5, 'proj:epsg': 26910 },
    assets: { image: { href: `https://naipeuwest.blob.core.windows.net/naip/${id}.tif` } },
  };
}

// Injected offline providers — return the two pinned items (unordered) + fixed drift.
function providers() {
  return {
    searchNaipCandidates: async ({ bbox, endpoint }) => {
      assert.equal(endpoint, 'https://i.test');
      for (const k of ['west', 'south', 'east', 'north']) assert.ok(Number.isFinite(bbox[k]), `bbox.${k}`);
      assert.ok(bbox.west < bbox.east && bbox.south < bbox.north, 'bbox ordering');
      return [feature('item-b'), feature('item-a')];
    },
    assertCogDrift: async ({ url }) => ({ total: 1_400_000_000, etag: `"etag-${url.slice(-12, -4)}"` }),
  };
}

// Prove the resolver touches no real network: the injected providers never call fetch.
const withNoNetwork = async (fn) => {
  const real = global.fetch;
  global.fetch = () => { throw new Error('network forbidden in offline discover test'); };
  try { return await fn(); } finally { global.fetch = real; }
};

test('resolveManifest fills fingerprint, bounds and per-asset drift → buildable', async () => {
  const next = await withNoNetwork(() => resolveManifest({ manifest: pendingManifest(), course, providers: providers() }));

  // fingerprint pins the exact cached course
  assert.equal(next.course.fingerprint, canonicalCourseFingerprint(course));
  assert.match(next.course.fingerprint, /^[a-f0-9]{64}$/);

  // discovered flips to resolved with exactly the schema's four bound keys
  assert.equal(next.discovered.state, 'resolved');
  assert.deepEqual(Object.keys(next.discovered.bounds).sort(), ['maxX', 'maxY', 'minX', 'minY']);
  for (const k of ['minX', 'minY', 'maxX', 'maxY']) assert.ok(Number.isFinite(next.discovered.bounds[k]));

  // one asset per pinned item, in deterministic (sorted) order, each with real drift
  assert.equal(next.discovered.assets.length, 2);
  assert.deepEqual(next.discovered.assets.map((a) => a.url), [
    'https://naipeuwest.blob.core.windows.net/naip/item-a.tif',
    'https://naipeuwest.blob.core.windows.net/naip/item-b.tif',
  ]);
  for (const a of next.discovered.assets) {
    assert.ok(a.url.startsWith('https://'));
    assert.ok(Number.isInteger(a.contentLength) && a.contentLength >= 1);
    assert.ok(typeof a.etag === 'string' && a.etag.length >= 1);
  }

  // the resolved manifest is schema-valid and now buildable
  assert.doesNotThrow(() => parseManifest(next));
  assert.equal(isBuildable(next), true);

  // the input is not mutated (pure resolve)
  assert.equal(pendingManifest().discovered.state, 'pending');
});

test('a missing pinned NAIP item is rejected (fail closed)', async () => {
  const prov = providers();
  prov.searchNaipCandidates = async () => [feature('item-a')]; // item-b absent
  await assert.rejects(
    () => resolveManifest({ manifest: pendingManifest(), course, providers: prov }),
    /HD_NAIP_MISSING_ITEM/,
  );
});

test('a missing content-length / etag from drift is rejected', async () => {
  const prov = providers();
  prov.assertCogDrift = async () => ({ total: null, etag: null });
  await assert.rejects(
    () => resolveManifest({ manifest: pendingManifest(), course, providers: prov }),
    /HD_DISCOVER_ASSET_META/,
  );
});
