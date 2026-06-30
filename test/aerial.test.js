'use strict';
// Offline tests for the runtime course-aerial fetch (single NAIPPlus request, no
// image deps). The live network fetch is verified manually on a fresh course.
const { test } = require('node:test');
const assert = require('node:assert');
const { fetchCourseAerial } = require('../lib/aerial');

// Minimal valid JPEG: SOI marker (FF D8) + filler past the 2 KB sanity floor.
function fakeJpeg(n = 2100) { const b = Buffer.alloc(n); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; return b; }
function resp(buf, ok = true) {
  return { ok, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
}

const origin = { lat: 47.2, lon: -122.57 };
const bounds = { minX: -500, minY: -900, maxX: 500, maxY: 800 };

test('fetchCourseAerial returns the image buffer + padded bounds, sized from gsd/cap', async () => {
  let seenUrl = '';
  const aer = await fetchCourseAerial({ origin, bounds, gsdM: 0.3, fetchImpl: async (url) => { seenUrl = url; return resp(fakeJpeg()); } });
  assert.ok(aer, 'returns a result');
  assert.deepEqual(aer.bounds, { minX: -560, minY: -960, maxX: 560, maxY: 860 }); // padded +/- 60 m
  assert.equal(aer.buf[0], 0xff); assert.equal(aer.buf[1], 0xd8);
  // wm=1120, hm=1820 (padded); sc = min(1/0.3, 4000/1820) = 2.19780 -> W=2462, H=4000 (long axis capped)
  assert.match(seenUrl, /USGSNAIPPlus\/ImageServer\/exportImage/);
  assert.match(seenUrl, /[?&]size=2462,4000(&|$)/);
  assert.match(seenUrl, /format=jpgpng/);
});

test('fetchCourseAerial caps small courses at the native gsd (0.3 m)', async () => {
  let seenUrl = '';
  // 600x400 m course -> max axis 600+120=720 m; 4096/720 > 1/0.3, so gsd 0.3 wins -> W=2400, H=1733
  await fetchCourseAerial({ origin, bounds: { minX: 0, minY: 0, maxX: 600, maxY: 400 }, gsdM: 0.3, fetchImpl: async (u) => { seenUrl = u; return resp(fakeJpeg()); } });
  assert.match(seenUrl, /[?&]size=2400,1733(&|$)/);
});

test('fetchCourseAerial returns null on a non-ok response', async () => {
  assert.equal(await fetchCourseAerial({ origin, bounds, fetchImpl: async () => resp(fakeJpeg(), false) }), null);
});

test('fetchCourseAerial returns null on a tiny/garbage body (non-US error blob)', async () => {
  assert.equal(await fetchCourseAerial({ origin, bounds, fetchImpl: async () => resp(Buffer.from('{"error":{"code":400}}')) }), null);
});

test('fetchCourseAerial returns null when the fetch throws', async () => {
  assert.equal(await fetchCourseAerial({ origin, bounds, fetchImpl: async () => { throw new Error('network'); } }), null);
});
