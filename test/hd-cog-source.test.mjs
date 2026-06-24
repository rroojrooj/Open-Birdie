import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeArrayBuffer } from 'geotiff';
import { makeSemaphore, BoundedCogClient, openPinnedCog, assertCogDrift } from '../tools/hd-course/cog-source.mjs';

test('makeSemaphore bounds concurrency to its limit', async () => {
  const sem = makeSemaphore(2);
  let active = 0; let peak = 0;
  const task = async () => {
    await sem.acquire();
    active += 1; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active -= 1; sem.release();
  };
  await Promise.all(Array.from({ length: 6 }, task));
  assert.ok(peak <= 2, `peak concurrency ${peak}`);
  assert.equal(sem.active, 0);
});

test('BoundedCogClient rejects a non-range (full-object) request', async () => {
  const client = new BoundedCogClient('https://x.test/a.tif', { fetchImpl: async () => new Response('x'), semaphore: makeSemaphore(2) });
  await assert.rejects(() => client.request({ headers: {} }), /HD_COG_FULL_READ/);
});

test('BoundedCogClient rejects a server that ignores Range (200)', async () => {
  const client = new BoundedCogClient('https://x.test/a.tif', { fetchImpl: async () => new Response('full', { status: 200 }), semaphore: makeSemaphore(2) });
  await assert.rejects(() => client.request({ headers: { Range: 'bytes=0-10' } }), /HD_COG_RANGE_IGNORED/);
});

test('assertCogDrift accepts matching pins and rejects drift', async () => {
  const ok = async () => new Response(Buffer.from([0]), { status: 206, headers: { 'content-range': 'bytes 0-0/12345', etag: '"abc"' } });
  await assert.doesNotReject(() => assertCogDrift({ url: 'https://x.test/a.tif', fetchImpl: ok, expectedContentLength: 12345, expectedEtag: '"abc"' }));
  await assert.rejects(() => assertCogDrift({ url: 'https://x.test/a.tif', fetchImpl: ok, expectedContentLength: 999 }), /HD_COG_LENGTH_DRIFT/);
  await assert.rejects(() => assertCogDrift({ url: 'https://x.test/a.tif', fetchImpl: ok, expectedEtag: '"zzz"' }), /HD_COG_ETAG_DRIFT/);
});

async function makeTiff(W = 64, H = 64) {
  const values = new Uint8Array(W * H);
  for (let i = 0; i < values.length; i += 1) values[i] = i % 251;
  return Buffer.from(await writeArrayBuffer(values, { width: W, height: H }));
}

function serveWithRange(buf, log) {
  return http.createServer((req, res) => {
    log.requests += 1;
    log.inflight += 1; log.peakInflight = Math.max(log.peakInflight, log.inflight);
    log.ranges.push(req.headers.range || null);
    const finish = () => { log.inflight -= 1; };
    setTimeout(() => {
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        const start = Number(m[1]); const end = m[2] ? Number(m[2]) : buf.length - 1;
        const slice = buf.subarray(start, end + 1);
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${buf.length}`,
          'Content-Length': slice.length, 'Accept-Ranges': 'bytes', ETag: '"srv"',
        });
        res.end(slice, finish);
      } else {
        res.writeHead(200, { 'Content-Length': buf.length });
        res.end(buf, finish);
      }
    }, 5);
  });
}

test('openPinnedCog reads a window over Range only, throttled by the semaphore', async () => {
  const buf = await makeTiff();
  const log = { requests: 0, ranges: [], inflight: 0, peakInflight: 0 };
  const server = serveWithRange(buf, log);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/cog.tif`;
  try {
    const tiff = await openPinnedCog({ url, fetchImpl: (u, opts) => fetch(u, opts), semaphore: makeSemaphore(2) });
    const image = await tiff.getImage();
    assert.equal(image.getWidth(), 64);
    const rasters = await image.readRasters({ window: [0, 0, 8, 8] });
    assert.equal(rasters[0].length, 8 * 8);
    assert.ok(log.requests > 0);
    assert.ok(log.ranges.every((r) => r !== null), 'every request must use Range');
    assert.ok(log.peakInflight <= 2, `peak in-flight ${log.peakInflight}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
