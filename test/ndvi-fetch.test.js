'use strict';
// Offline tests for the runtime NDVI band fetch (two co-registered NAIPPlus
// exportImage requests, decoded with pngjs). The live network fetch is verified
// manually on a fresh course. Mirrors test/aerial.test.js.
const { test } = require('node:test');
const assert = require('node:assert');
const { PNG } = require('pngjs');
const { fetchNdviBands, NDVI_MAXPX } = require('../lib/ndvi-fetch');

// Build a real w x h PNG whose per-pixel RGB channels are set to fixed values, so
// pngjs actually decodes it (a fake JPEG buffer would NOT exercise the decode path).
// Alpha carries per-pixel noise: it keeps R/G/B (and the NIR fetch's ch0) fully
// deterministic while defeating zlib so the encoded PNG clears the ~2 KB no-data
// floor the fetch guards against. (fetchNdviBands ignores the alpha channel.)
function makePng(w, h, [r, g, b]) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    png.data[o] = r; png.data[o + 1] = g; png.data[o + 2] = b;
    png.data[o + 3] = (Math.random() * 256) | 0;
  }
  return PNG.sync.write(png);
}
function resp(buf, ok = true) {
  return { ok, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
}

const origin = { lat: 47.2, lon: -122.57 };
const bounds = { minX: -500, minY: -900, maxX: 500, maxY: 800 };

// Route the two-request protocol: bandIds=0,1,2 is the RGB fetch; bandIds=3,0,1 is the NIR fetch.
function router({ rgb, nir, onUrl } = {}) {
  return async (url) => {
    if (onUrl) onUrl(url);
    if (/bandIds=0,1,2/.test(url)) return resp(rgb);
    if (/bandIds=3,0,1/.test(url)) return resp(nir);
    throw new Error('unexpected url: ' + url);
  };
}

test('fetchNdviBands builds both request URLs correctly (format=png, bandIds, bbox, SR, capped size)', async () => {
  const urls = [];
  const rgb = makePng(473, 768, [10, 20, 30]);
  const nir = makePng(473, 768, [200, 11, 22]);
  const out = await fetchNdviBands({ origin, bounds, fetchImpl: router({ rgb, nir, onUrl: (u) => urls.push(u) }) });
  assert.ok(out, 'returns a result');
  assert.equal(urls.length, 2, 'exactly two requests');

  const rgbUrl = urls.find((u) => /bandIds=0,1,2/.test(u));
  const nirUrl = urls.find((u) => /bandIds=3,0,1/.test(u));
  assert.ok(rgbUrl && nirUrl, 'one RGB (0,1,2) and one NIR (3,0,1) request');

  for (const u of urls) {
    assert.match(u, /USGSNAIPPlus\/ImageServer\/exportImage/);
    assert.match(u, /[?&]format=png(&|$)/, 'format MUST be png');
    assert.doesNotMatch(u, /jpgpng/, 'format MUST NOT be jpgpng');
    assert.match(u, /bboxSR=4326&imageSR=4326/);
    // padded (+/-60 m) bbox: w=-122.5774..., e=-122.5626..., s=47.1913..., n=47.2077...
    assert.match(u, /[?&]bbox=-122\.577[^&]*,47\.191[^&]*,-122\.562[^&]*,47\.207[^&]*&/);
    // wm=1120, hm=1820; sc = min(1/0.3=3.333, 768/1820=0.42198) = 0.42198 -> W=473, H=768 (long axis capped by NDVI_MAXPX)
    assert.match(u, /[?&]size=473,768(&|$)/);
  }
});

test('NDVI_MAXPX caps the raster at 768 px on the long axis', () => {
  assert.equal(NDVI_MAXPX, 768);
});

test('fetchNdviBands interleaves [R,G,B,NIR] with NIR from the NIR fetch ch0 (real pngjs decode)', async () => {
  // RGB PNG: every pixel (40,80,120). NIR PNG: ch0=222 (the NIR value), ch1/ch2 are R/G echoes we must ignore.
  const W = 64, H = 64;
  const rgb = makePng(W, H, [40, 80, 120]);
  const nir = makePng(W, H, [222, 40, 80]);
  const out = await fetchNdviBands({ origin, bounds, fetchImpl: router({ rgb, nir }) });
  assert.ok(out, 'returns a result');
  assert.equal(out.width, W); assert.equal(out.height, H);
  assert.equal(out.bands.length, W * H * 4, '4 channels per pixel, interleaved');

  // Check a known interior pixel (17,9) -> index (9*W + 17) * 4.
  const p = (9 * W + 17) * 4;
  assert.equal(out.bands[p + 0], 40, 'R from RGB fetch');
  assert.equal(out.bands[p + 1], 80, 'G from RGB fetch');
  assert.equal(out.bands[p + 2], 120, 'B from RGB fetch');
  assert.equal(out.bands[p + 3], 222, 'NIR from NIR fetch ch0 (alpha must be ignored)');
});

test('fetchNdviBands returns null when the RGB fetch is non-ok', async () => {
  const nir = makePng(64, 64, [222, 0, 0]);
  const fetchImpl = async (url) => (/bandIds=0,1,2/.test(url) ? resp(Buffer.alloc(3000), false) : resp(nir));
  assert.equal(await fetchNdviBands({ origin, bounds, fetchImpl }), null);
});

test('fetchNdviBands returns null when the NIR fetch is non-ok', async () => {
  const rgb = makePng(64, 64, [1, 2, 3]);
  const fetchImpl = async (url) => (/bandIds=3,0,1/.test(url) ? resp(Buffer.alloc(3000), false) : resp(rgb));
  assert.equal(await fetchNdviBands({ origin, bounds, fetchImpl }), null);
});

test('fetchNdviBands returns null on a tiny/garbage body (non-US error blob)', async () => {
  const blob = Buffer.from('{"error":{"code":400}}');
  assert.equal(await fetchNdviBands({ origin, bounds, fetchImpl: async () => resp(blob) }), null);
});

test('fetchNdviBands returns null when a body is not a PNG (e.g. a JPEG slips through)', async () => {
  const jpg = Buffer.alloc(3000); jpg[0] = 0xff; jpg[1] = 0xd8; // JPEG magic, above the size floor
  assert.equal(await fetchNdviBands({ origin, bounds, fetchImpl: async () => resp(jpg) }), null);
});

test('fetchNdviBands returns null when the fetch throws', async () => {
  assert.equal(await fetchNdviBands({ origin, bounds, fetchImpl: async () => { throw new Error('network'); } }), null);
});

test('fetchNdviBands returns null when the two decodes disagree on width/height', async () => {
  const rgb = makePng(64, 64, [1, 2, 3]);
  const nir = makePng(64, 80, [222, 0, 0]); // both decode fine, but different height
  assert.equal(await fetchNdviBands({ origin, bounds, fetchImpl: router({ rgb, nir }) }), null);
});
