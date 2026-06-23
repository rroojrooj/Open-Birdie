import test from 'node:test';
import assert from 'node:assert/strict';
import lidar from '../lib/lidar.js';
import { acquireElevation } from '../tools/hd-course/three-dep.mjs';

const { fetchPatchStrict, fetchPatch } = lidar;

const f32le = (arr) => {
  const b = Buffer.alloc(arr.length * 4);
  arr.forEach((v, i) => b.writeFloatLE(v, i * 4));
  return b;
};
const mock3dep = ({ meta, image, imageStatus = 200, metaStatus = 200 }) => async (url) => (
  String(url).includes('f=json')
    ? new Response(JSON.stringify(meta), { status: metaStatus })
    : new Response(image, { status: imageStatus })
);

const okMeta = { width: 2, height: 2, extent: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 } };
const bbox = { west: -124.40, south: 43.18, east: -124.39, north: 43.19 };

test('fetchPatchStrict decodes little-endian Float32 on a good response', async () => {
  const patch = await fetchPatchStrict(bbox, { fetchImpl: mock3dep({ meta: okMeta, image: f32le([1, 2, 3, 4]) }) });
  assert.equal(patch.width, 2);
  assert.deepEqual([...patch.heights], [1, 2, 3, 4]);
});

test('fetchPatchStrict throws stage-coded errors; fetchPatch wraps them to null', async () => {
  const truncated = mock3dep({ meta: okMeta, image: Buffer.alloc(4) }); // need 16 bytes
  await assert.rejects(() => fetchPatchStrict(bbox, { fetchImpl: truncated }),
    (e) => e.code === 'HD_3DEP_TRUNCATED' && e.stage === 'download-elevation');
  assert.equal(await fetchPatch(bbox, { fetchImpl: truncated }), null);

  const nodata = mock3dep({ meta: okMeta, image: f32le([-3.4e38, -3.4e38, -3.4e38, -3.4e38]) });
  await assert.rejects(() => fetchPatchStrict(bbox, { fetchImpl: nodata }), (e) => e.code === 'HD_3DEP_NODATA');
  assert.equal(await fetchPatch(bbox, { fetchImpl: nodata }), null);

  await assert.rejects(() => fetchPatchStrict(bbox, { fetchImpl: mock3dep({ meta: { foo: 1 }, image: f32le([1, 2, 3, 4]) }) }),
    (e) => e.code === 'HD_3DEP_META');

  await assert.rejects(() => fetchPatchStrict(bbox, { fetchImpl: mock3dep({ meta: okMeta, image: Buffer.alloc(0), imageStatus: 500 }) }),
    (e) => e.code === 'HD_3DEP_HTTP');
});

test('acquireElevation wraps provider errors as HdCompileError', async () => {
  await assert.rejects(
    () => acquireElevation(bbox, { fetchImpl: mock3dep({ meta: okMeta, image: Buffer.alloc(4) }), nativeSpacingM: 3.4 }),
    (e) => e.name === 'HdCompileError' && e.stage === 'download-elevation' && e.code === 'HD_3DEP_TRUNCATED',
  );
});

test('acquireElevation rejects data coarser than the pinned native spacing', async () => {
  // width 2 over a ~27.45 m mercator extent => ~20 m ground spacing at this latitude
  const coarse = { width: 2, height: 2, extent: { xmin: 0, ymin: 0, xmax: 27.45, ymax: 27.45 } };
  await assert.rejects(
    () => acquireElevation(bbox, { fetchImpl: mock3dep({ meta: coarse, image: f32le([10, 11, 12, 13]) }), nativeSpacingM: 3.4 }),
    (e) => e.code === 'HD_3DEP_COARSE',
  );
});

test('acquireElevation returns patch + stats on acceptable data', async () => {
  const fine = { width: 2, height: 2, extent: { xmin: 0, ymin: 0, xmax: 4.1, ymax: 4.1 } };
  const { patch, stats } = await acquireElevation(bbox, { fetchImpl: mock3dep({ meta: fine, image: f32le([10, 12, 14, 16]) }), nativeSpacingM: 3.4 });
  assert.equal(patch.width, 2);
  assert.equal(stats.validRatio, 1);
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 16);
  assert.ok(stats.groundSpacingM <= 3.4 * 1.5);
});
