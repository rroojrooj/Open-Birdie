import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchNaipCandidates, selectPinnedAcquisition, assetHref } from '../tools/hd-course/naip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const search = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'hd-course', 'naip-search.json'), 'utf8'));

const NE = 'or_m_4312453_ne_10_030_20220623';
const SE = 'or_m_4312453_se_10_030_20220623';
const manifest = { imagery: { itemIds: [NE, SE], date: '2022-06-23', gsdM: 0.3 } };
const bbox = { west: -124.40, south: 43.18, east: -124.39, north: 43.19 };

test('searchNaipCandidates POSTs a STAC search and returns features', async () => {
  let url; let body;
  const fetchImpl = async (u, opts) => { url = String(u); body = JSON.parse(opts.body); return new Response(JSON.stringify(search), { status: 200 }); };
  const features = await searchNaipCandidates({ bbox, fetchImpl, endpoint: 'https://planetarycomputer.microsoft.com/api/stac/v1' });
  assert.ok(url.endsWith('/search'));
  assert.deepEqual(body.collections, ['naip']);
  assert.deepEqual(body.bbox, [-124.40, 43.18, -124.39, 43.19]);
  assert.equal(features.length, 3);
});

test('searchNaipCandidates rejects a non-OK STAC response', async () => {
  await assert.rejects(
    () => searchNaipCandidates({ bbox, endpoint: 'https://x.test', fetchImpl: async () => new Response('nope', { status: 500 }) }),
    /HD_NAIP_SEARCH/,
  );
});

test('selectPinnedAcquisition picks exactly the pinned items, sorted deterministically', () => {
  assert.deepEqual(selectPinnedAcquisition(search.features, manifest).map((f) => f.id), [NE, SE]);
});

test('selection is order-independent', () => {
  assert.deepEqual(selectPinnedAcquisition([...search.features].reverse(), manifest).map((f) => f.id), [NE, SE]);
});

test('a missing pinned item is rejected', () => {
  assert.throws(() => selectPinnedAcquisition(search.features.filter((f) => f.id !== SE), manifest), /HD_NAIP_MISSING_ITEM/);
});

test('a date mismatch is rejected', () => {
  const bad = search.features.map((f) => (f.id === NE ? { ...f, properties: { ...f.properties, datetime: '2021-06-23T00:00:00Z' } } : f));
  assert.throws(() => selectPinnedAcquisition(bad, manifest), /HD_NAIP_DATE_MISMATCH/);
});

test('a GSD mismatch is rejected', () => {
  const bad = search.features.map((f) => (f.id === NE ? { ...f, properties: { ...f.properties, gsd: 0.6 } } : f));
  assert.throws(() => selectPinnedAcquisition(bad, manifest), /HD_NAIP_GSD/);
});

test('a missing CRS is rejected', () => {
  const bad = search.features.map((f) => (f.id === NE ? { ...f, properties: { ...f.properties, 'proj:epsg': null } } : f));
  assert.throws(() => selectPinnedAcquisition(bad, manifest), /HD_NAIP_CRS/);
});

test('assetHref returns the cloud-optimized GeoTIFF url', () => {
  const ne = search.features.find((f) => f.id === NE);
  assert.ok(assetHref(ne).startsWith('https://') && assetHref(ne).endsWith('.tif'));
});
