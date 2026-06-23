import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBounded } from '../tools/hd-course/http.mjs';

const HOST = 'planetarycomputer.microsoft.com';
const URL_OK = `https://${HOST}/data.tif`;

const once = (res) => async () => (typeof res === 'function' ? res() : res);

test('rejects non-https urls', async () => {
  await assert.rejects(
    fetchBounded('http://x.test/a', { allowedHosts: ['x.test'], fetchImpl: once(new Response('x')) }),
    /HD_HTTP_SCHEME/,
  );
});

test('rejects hosts not on the allow-list', async () => {
  await assert.rejects(
    fetchBounded('https://evil.test/a', { allowedHosts: [HOST], fetchImpl: once(new Response('x')) }),
    /HD_HOST_NOT_ALLOWED/,
  );
});

test('rejects loopback/private hosts even when allow-listed', async () => {
  await assert.rejects(
    fetchBounded('https://127.0.0.1/a', { allowedHosts: ['127.0.0.1'], fetchImpl: once(new Response('x')) }),
    /HD_HOST_FORBIDDEN/,
  );
});

test('returns bytes on a clean 200', async () => {
  const res = await fetchBounded(URL_OK, {
    allowedHosts: [HOST],
    fetchImpl: once(new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200, headers: { 'content-length': '4' },
    })),
  });
  assert.equal(res.status, 200);
  assert.equal(res.bytes.length, 4);
});

test('rejects a 200 to a required range request before reading the body', async () => {
  let read = false;
  const fake = {
    status: 200,
    headers: new Headers(),
    async arrayBuffer() { read = true; return new ArrayBuffer(8); },
  };
  await assert.rejects(
    fetchBounded(URL_OK, { range: 'bytes=0-1023', allowedHosts: [HOST], fetchImpl: once(fake) }),
    /HD_HTTP_RANGE_IGNORED/,
  );
  assert.equal(read, false, 'body must not be consumed when a range is ignored');
});

test('accepts a 206 to a range request', async () => {
  const res = await fetchBounded(URL_OK, {
    range: 'bytes=0-3', allowedHosts: [HOST],
    fetchImpl: once(new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 206, headers: { 'content-length': '4' },
    })),
  });
  assert.equal(res.status, 206);
  assert.equal(res.bytes.length, 4);
});

test('enforces maxBytes via content-length pre-check', async () => {
  await assert.rejects(
    fetchBounded(URL_OK, {
      maxBytes: 10, allowedHosts: [HOST],
      fetchImpl: once(new Response(new Uint8Array(100), {
        status: 200, headers: { 'content-length': '100' },
      })),
    }),
    /HD_HTTP_TOO_LARGE/,
  );
});

test('retries on 503 then succeeds', async () => {
  let calls = 0;
  const res = await fetchBounded(URL_OK, {
    allowedHosts: [HOST], backoffMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response('busy', { status: 503 });
      return new Response(new Uint8Array([9]), { status: 200, headers: { 'content-length': '1' } });
    },
  });
  assert.equal(calls, 2);
  assert.equal(res.bytes.length, 1);
});

test('does not retry a 404 and surfaces a status error', async () => {
  let calls = 0;
  await assert.rejects(
    fetchBounded(URL_OK, {
      allowedHosts: [HOST], backoffMs: 0,
      fetchImpl: async () => { calls += 1; return new Response('nope', { status: 404 }); },
    }),
    /HD_HTTP_STATUS/,
  );
  assert.equal(calls, 1, 'must not retry a 404');
});
