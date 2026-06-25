'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { serveHdAsset, publicHdMetadata, ASSET_KEYS } = require('../lib/hd-http');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-srv-'));
  const write = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };
  const terrainBytes = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  return {
    terrainBytes,
    descriptor: {
      metadata: { bundleId: 'a'.repeat(64), hole: 1, assetKeys: ASSET_KEYS.slice() },
      assetPaths: {
        terrain: write('terrain.f32', terrainBytes),
        orthophoto: write('o.webp', Buffer.from('RIFF0000WEBP')),
        surfaces: write('s.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])),
        coverage: write('c.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      },
    },
  };
}

async function withServer(descriptor, fn) {
  const server = http.createServer((req, res) => {
    const m = /^\/api\/hd-assets\/([^/]+)\/([^/]+)$/.exec(req.url);
    if (!m) { res.writeHead(404); res.end(); return; }
    serveHdAsset(req, res, descriptor, m[2]);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

test('GET serves the mapped asset with MIME + length', async () => {
  const { descriptor, terrainBytes } = fixture();
  await withServer(descriptor, async (base) => {
    const r = await fetch(`${base}/api/hd-assets/abc/terrain`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/octet-stream');
    assert.equal(r.headers.get('content-length'), String(terrainBytes.length));
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(terrainBytes));
  });
});

test('HEAD returns headers, no body; webp MIME', async () => {
  const { descriptor } = fixture();
  await withServer(descriptor, async (base) => {
    const r = await fetch(`${base}/api/hd-assets/abc/orthophoto`, { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/webp');
    assert.equal((await r.arrayBuffer()).byteLength, 0);
  });
});

test('a single byte range returns 206 + Content-Range', async () => {
  const { descriptor } = fixture();
  await withServer(descriptor, async (base) => {
    const r = await fetch(`${base}/api/hd-assets/abc/terrain`, { headers: { Range: 'bytes=0-3' } });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), 'bytes 0-3/8');
    assert.equal((await r.arrayBuffer()).byteLength, 4);
  });
});

test('multi-range and out-of-range return 416', async () => {
  const { descriptor } = fixture();
  await withServer(descriptor, async (base) => {
    assert.equal((await fetch(`${base}/api/hd-assets/abc/terrain`, { headers: { Range: 'bytes=0-1,4-5' } })).status, 416);
    assert.equal((await fetch(`${base}/api/hd-assets/abc/terrain`, { headers: { Range: 'bytes=100-200' } })).status, 416);
  });
});

test('an unknown asset key is 404', async () => {
  const { descriptor } = fixture();
  await withServer(descriptor, async (base) => {
    assert.equal((await fetch(`${base}/api/hd-assets/abc/secret`)).status, 404);
  });
});

test('cache headers are private + immutable', async () => {
  const { descriptor } = fixture();
  await withServer(descriptor, async (base) => {
    const r = await fetch(`${base}/api/hd-assets/abc/surfaces`);
    assert.match(r.headers.get('cache-control'), /immutable/);
    assert.equal(r.headers.get('content-type'), 'image/png');
  });
});

test('publicHdMetadata exposes only sanitized fields (no paths)', () => {
  const { descriptor } = fixture();
  const meta = publicHdMetadata(descriptor);
  assert.deepEqual(meta.assetKeys, ASSET_KEYS);
  assert.ok(!JSON.stringify(meta).includes('assetPaths'));
});
