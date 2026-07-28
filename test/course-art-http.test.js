'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');

const { serveCourseArtRequest } = require('../lib/course-art-http');

const REVISION = 'a'.repeat(64);

function pngBytes(color = [20, 120, 40, 255]) {
  const image = new PNG({ width: 2, height: 2 });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data.set(color, offset);
  }
  return PNG.sync.write(image);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function identity(file) {
  const stat = fs.statSync(file, { bigint: true });
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  });
}

function fixture(t, {
  key = 'turf',
  bytes = pngBytes(),
  mime = 'image/png',
  declaredBytes = bytes.length,
  declaredHash = sha256(bytes),
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-course-art-http-'));
  const packDir = path.join(root, 'packs', 'test');
  const file = path.join(packDir, 'turf.png');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(file, bytes);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const privateEntry = Object.freeze({
    absolutePath: path.resolve(file),
    realPath: fs.realpathSync(file),
    mime,
    bytes: declaredBytes,
    sha256: declaredHash,
    fileIdentity: identity(file),
    verifiedBytes: Buffer.from(bytes),
    verifiedMime: 'image/png',
    verifiedSha256: sha256(bytes),
  });
  const publicEntry = Object.freeze({
    url: `/api/course-art/${REVISION}/${key}`,
    mime,
    bytes: declaredBytes,
    sha256: declaredHash,
  });
  const active = Object.freeze({
    contentRevision: REVISION,
    assetManifest: Object.freeze({ [key]: publicEntry }),
  });
  const state = {
    active,
    privateEntry,
    getActivePackage: () => state.active,
    lookupPrivateAsset: (revision, requestedKey) => (
      revision === REVISION && requestedKey === key ? state.privateEntry : null
    ),
  };
  return { root, packDir, file, bytes, key, state, publicEntry, privateEntry };
}

async function startServer(t, item, overrides = {}) {
  const server = http.createServer((req, res) => serveCourseArtRequest(req, res, {
    artRoot: item.root,
    getActivePackage: item.state.getActivePackage,
    lookupPrivateAsset: item.state.lookupPrivateAsset,
    ...overrides,
  }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

function request(port, requestPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

function assetPath(item, revision = REVISION, key = item.key) {
  return `/api/course-art/${revision}/${key}`;
}

test('exact GET, HEAD, and verified conditional 304 publish immutable nosniff headers', async (t) => {
  const item = fixture(t);
  const port = await startServer(t, item);
  const expectedEtag = `"sha256-${sha256(item.bytes)}"`;

  const get = await request(port, assetPath(item));
  assert.equal(get.status, 200);
  assert.ok(get.body.equals(item.bytes));
  assert.equal(get.headers['content-type'], 'image/png');
  assert.equal(get.headers['content-length'], String(item.bytes.length));
  assert.equal(get.headers.etag, expectedEtag);
  assert.equal(get.headers['cache-control'], 'private, max-age=31536000, immutable');
  assert.equal(get.headers['x-content-type-options'], 'nosniff');

  const head = await request(port, assetPath(item), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  for (const header of ['content-type', 'content-length', 'etag', 'cache-control', 'x-content-type-options']) {
    assert.equal(head.headers[header], get.headers[header]);
  }

  const conditional = await request(port, assetPath(item), {
    headers: { 'If-None-Match': `W/${expectedEtag}` },
  });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.body.length, 0);
  assert.equal(conditional.headers.etag, expectedEtag);
  assert.equal(conditional.headers['x-content-type-options'], 'nosniff');
});

test('stale revision, unknown key, encoded traversal, malformed and reserved keys are typed and redacted', async (t) => {
  const item = fixture(t);
  const port = await startServer(t, item);
  const cases = [
    [assetPath(item, 'b'.repeat(64)), 404, 'COURSE_ART_NOT_FOUND'],
    [assetPath(item, REVISION, 'missing'), 404, 'COURSE_ART_NOT_FOUND'],
    [`/api/course-art/${REVISION}/%2e%2e%2fsecret`, 404, 'COURSE_ART_NOT_FOUND'],
    [`/api/course-art/${REVISION}/BadKey`, 400, 'COURSE_ART_REQUEST_INVALID'],
    [`/api/course-art/${REVISION}/con`, 400, 'COURSE_ART_REQUEST_INVALID'],
  ];
  for (const [url, status, code] of cases) {
    const response = await request(port, url);
    assert.equal(response.status, status, url);
    const body = JSON.parse(response.body.toString('utf8'));
    assert.equal(body.diagnostic.code, code);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.doesNotMatch(
      response.body.toString('utf8'),
      /ob-course-art-http-|Users[\\/]|stack|absolutePath|realPath/iu,
    );
  }
});

test('case-fold-colliding active keys fail closed with a generic 400', async (t) => {
  const item = fixture(t);
  item.state.active = {
    ...item.state.active,
    assetManifest: {
      tree: item.publicEntry,
      Tree: item.publicEntry,
    },
  };
  const port = await startServer(t, item);
  const response = await request(port, assetPath(item));
  assert.equal(response.status, 400);
  assert.equal(
    JSON.parse(response.body.toString('utf8')).diagnostic.code,
    'COURSE_ART_REQUEST_INVALID',
  );
});

test('active snapshot owns HEAD, conditional, and GET after same-inode disk mutation', async (t) => {
  const item = fixture(t);
  const port = await startServer(t, item);
  const original = await request(port, assetPath(item));
  const replacement = Buffer.from(item.bytes);
  replacement[replacement.length - 1] ^= 0xff;
  fs.writeFileSync(item.file, replacement);
  assert.equal(fs.statSync(item.file).size, item.bytes.length);
  assert.ok(replacement.subarray(0, 24).equals(item.bytes.subarray(0, 24)));

  const head = await request(port, assetPath(item), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.etag, original.headers.etag);
  const conditional = await request(port, assetPath(item), {
    headers: { 'If-None-Match': original.headers.etag },
  });
  assert.equal(conditional.status, 304);
  const get = await request(port, assetPath(item));
  assert.equal(get.status, 200);
  assert.equal(get.headers.etag, original.headers.etag);
  assert.ok(get.body.equals(item.bytes));
});

test('GET serves the verified bytes when the same inode mutates after validation', async (t) => {
  const item = fixture(t);
  const replacement = pngBytes([180, 30, 90, 255]);
  assert.equal(replacement.length, item.bytes.length);
  const originalIdentity = identity(item.file);
  const real = fs.promises;
  let statCalls = 0;
  const fsPromises = {
    lstat: (...args) => real.lstat(...args),
    realpath: (...args) => real.realpath(...args),
    async open(...args) {
      const handle = await real.open(...args);
      return {
        async stat(...statArgs) {
          const stat = await handle.stat(...statArgs);
          statCalls += 1;
          if (statCalls === 2) fs.writeFileSync(item.file, replacement);
          return stat;
        },
        readFile: (...readArgs) => handle.readFile(...readArgs),
        createReadStream: (...streamArgs) => handle.createReadStream(...streamArgs),
        close: () => handle.close(),
      };
    },
  };
  const port = await startServer(t, item, { fsPromises });
  const response = await request(port, assetPath(item));
  assert.equal(response.status, 200);
  assert.equal(response.headers.etag, `"sha256-${sha256(item.bytes)}"`);
  assert.ok(response.body.equals(item.bytes), 'body must match the bytes that own the ETag');
  assert.ok(fs.readFileSync(item.file).equals(replacement), 'mutation window was exercised');
  assert.deepEqual(identity(item.file), originalIdentity, 'mutation kept the same file identity');
});

test('unlink, rename, disallowed MIME, oversized declaration, and wrong hash fail closed', async (t) => {
  const renamed = fixture(t);
  let port = await startServer(t, renamed);
  fs.renameSync(renamed.file, `${renamed.file}.moved`);
  assert.equal((await request(port, assetPath(renamed))).status, 404);

  const disallowed = fixture(t, { mime: 'text/plain' });
  port = await startServer(t, disallowed);
  assert.equal((await request(port, assetPath(disallowed))).status, 404);

  const oversized = fixture(t, { declaredBytes: (128 * 1024 * 1024) + 1 });
  port = await startServer(t, oversized);
  assert.equal((await request(port, assetPath(oversized))).status, 404);

  const wrongHash = fixture(t, { declaredHash: 'f'.repeat(64) });
  port = await startServer(t, wrongHash);
  assert.equal((await request(port, assetPath(wrongHash))).status, 404);
});

test('file and ancestor symlink or junction swaps outside the staged root are rejected', async (t) => {
  const fileSwap = fixture(t);
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-course-art-outside-'));
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));
  const outsideFile = path.join(outsideRoot, 'outside.png');
  fs.writeFileSync(outsideFile, fileSwap.bytes);
  fs.rmSync(fileSwap.file);
  try {
    fs.symlinkSync(outsideFile, fileSwap.file, 'file');
  } catch (error) {
    t.skip(`file symlink unavailable: ${error.code}`);
    return;
  }
  let port = await startServer(t, fileSwap);
  assert.equal((await request(port, assetPath(fileSwap))).status, 404);

  const ancestorSwap = fixture(t);
  const outsidePack = path.join(outsideRoot, 'outside-pack');
  fs.mkdirSync(outsidePack);
  fs.writeFileSync(path.join(outsidePack, 'turf.png'), ancestorSwap.bytes);
  fs.rmSync(ancestorSwap.packDir, { recursive: true, force: true });
  try {
    fs.symlinkSync(
      outsidePack,
      ancestorSwap.packDir,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    t.skip(`directory link unavailable: ${error.code}`);
    return;
  }
  port = await startServer(t, ancestorSwap);
  assert.equal((await request(port, assetPath(ancestorSwap))).status, 404);
});

test('an activation route swap during verification cannot serve the prior asset', async (t) => {
  const item = fixture(t);
  const real = fs.promises;
  const fsPromises = {
    lstat: (...args) => real.lstat(...args),
    realpath: (...args) => real.realpath(...args),
    async open(...args) {
      const handle = await real.open(...args);
      item.state.active = null;
      return handle;
    },
  };
  const port = await startServer(t, item, { fsPromises });
  const response = await request(port, assetPath(item));
  assert.equal(response.status, 404);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('response failure closes the verified file handle exactly once', async (t) => {
  const item = fixture(t);
  const real = fs.promises;
  let opens = 0;
  let closes = 0;
  const fsPromises = {
    lstat: (...args) => real.lstat(...args),
    realpath: (...args) => real.realpath(...args),
    async open(...args) {
      opens += 1;
      const handle = await real.open(...args);
      return {
        stat: (...statArgs) => handle.stat(...statArgs),
        async close() {
          closes += 1;
          return handle.close();
        },
      };
    },
  };
  const response = {
    headers: {},
    headersSent: false,
    destroyed: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end() {
      this.headersSent = true;
      throw new Error('injected response failure');
    },
    destroy() {
      this.destroyed = true;
    },
  };
  await serveCourseArtRequest({
    method: 'GET',
    url: assetPath(item),
    headers: {},
  }, response, {
    artRoot: item.root,
    getActivePackage: item.state.getActivePackage,
    lookupPrivateAsset: item.state.lookupPrivateAsset,
    fsPromises,
  });
  assert.equal(opens, 1);
  assert.equal(closes, 1);
  assert.equal(response.destroyed, true);
});
