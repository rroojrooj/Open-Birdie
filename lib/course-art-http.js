'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LIMITS = require('./course-art-limits');
const { createCourseDiagnostic } = require('./course-diagnostics');

const CONTENT_REVISION = /^[a-f0-9]{64}$/u;
const ASSET_KEY = /^[a-z][a-z0-9._-]{0,63}$/u;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const ROUTE_PREFIX = '/api/course-art/';

const NOT_FOUND = createCourseDiagnostic({
  code: 'COURSE_ART_NOT_FOUND',
  severity: 'error',
  stage: 'course-art-http',
  message: 'The requested active course asset is unavailable.',
  recovery: 'Reload the active course and retry the asset request.',
});
const INVALID_REQUEST = createCourseDiagnostic({
  code: 'COURSE_ART_REQUEST_INVALID',
  severity: 'error',
  stage: 'course-art-http',
  message: 'The course asset request is invalid.',
  recovery: 'Reload the active course and use its published asset URL.',
});

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32'
    ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US')
    : a === b;
}

function validAssetKey(key) {
  return ASSET_KEY.test(key) &&
    !key.endsWith('.') &&
    !WINDOWS_RESERVED.test(key);
}

function parseRequestPath(rawUrl) {
  const rawPath = String(rawUrl || '').split('?', 1)[0];
  if (!rawPath.startsWith(ROUTE_PREFIX)) return { status: 'not-found' };
  const suffix = rawPath.slice(ROUTE_PREFIX.length);
  const segments = suffix.split('/');
  if (segments.length !== 2 || segments.some((segment) => !segment) ||
      segments.some((segment) => segment.includes('%'))) {
    return { status: 'not-found' };
  }
  const [contentRevision, assetKey] = segments;
  if (!CONTENT_REVISION.test(contentRevision)) return { status: 'not-found' };
  if (!validAssetKey(assetKey)) return { status: 'invalid' };
  return { status: 'valid', contentRevision, assetKey };
}

function manifestKeysAreSafe(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
  const folded = new Set();
  for (const key of Object.keys(manifest)) {
    const normalized = key.toLocaleLowerCase('en-US');
    if (!validAssetKey(key) || folded.has(normalized)) return false;
    folded.add(normalized);
  }
  return true;
}

function fileIdentity(stat) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  };
}

function sameFileIdentity(stat, expected) {
  if (!expected || typeof expected !== 'object') return false;
  const actual = fileIdentity(stat);
  return actual.device === expected.device &&
    actual.inode === expected.inode &&
    actual.birthtimeNs === expected.birthtimeNs;
}

function metadataMatches(publicEntry, privateEntry, contentRevision, assetKey) {
  return publicEntry && privateEntry &&
    publicEntry.url === `${ROUTE_PREFIX}${contentRevision}/${assetKey}` &&
    publicEntry.mime === privateEntry.mime &&
    publicEntry.bytes === privateEntry.bytes &&
    publicEntry.sha256 === privateEntry.sha256 &&
    Number.isInteger(privateEntry.bytes) &&
    privateEntry.bytes > 0 &&
    privateEntry.bytes <= LIMITS.MAX_SINGLE_ASSET_BYTES &&
    /^[a-f0-9]{64}$/u.test(privateEntry.sha256 || '') &&
    typeof privateEntry.absolutePath === 'string' &&
    path.isAbsolute(privateEntry.absolutePath) &&
    typeof privateEntry.realPath === 'string' &&
    path.isAbsolute(privateEntry.realPath) &&
    Buffer.isBuffer(privateEntry.verifiedBytes) &&
    privateEntry.verifiedBytes.length === privateEntry.bytes &&
    privateEntry.verifiedMime === privateEntry.mime &&
    privateEntry.verifiedSha256 === privateEntry.sha256;
}

async function rejectLinkedAncestors(root, candidate, fsPromises) {
  const relative = path.relative(root, candidate);
  if (!isInside(root, candidate)) throw new Error('outside runtime root');
  let cursor = root;
  const rootStat = await fsPromises.lstat(cursor);
  if (rootStat.isSymbolicLink()) throw new Error('linked runtime root');
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = await fsPromises.lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error('linked runtime path');
  }
}

function etagMatches(header, etag) {
  if (typeof header !== 'string') return false;
  return header.split(',').some((value) => {
    const candidate = value.trim().replace(/^W\//u, '');
    return candidate === '*' || candidate === etag;
  });
}

function setAssetHeaders(res, entry) {
  res.setHeader('Content-Type', entry.mime);
  res.setHeader('Content-Length', String(entry.bytes));
  res.setHeader('ETag', `"sha256-${entry.sha256}"`);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendDiagnostic(res, statusCode, diagnostic) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = Buffer.from(JSON.stringify({ ok: false, diagnostic }));
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}

function activeEntry({ getActivePackage, lookupPrivateAsset }, contentRevision, assetKey) {
  const active = getActivePackage();
  if (!active || active.contentRevision !== contentRevision ||
      !manifestKeysAreSafe(active.assetManifest)) {
    return null;
  }
  const publicEntry = Object.prototype.hasOwnProperty.call(active.assetManifest, assetKey)
    ? active.assetManifest[assetKey]
    : null;
  const privateEntry = publicEntry
    ? lookupPrivateAsset(contentRevision, assetKey)
    : null;
  if (!metadataMatches(publicEntry, privateEntry, contentRevision, assetKey)) return null;
  return { active, publicEntry, privateEntry };
}

async function serveCourseArtRequest(req, res, {
  artRoot,
  getActivePackage,
  lookupPrivateAsset,
  fsPromises = fs.promises,
} = {}) {
  const parsed = parseRequestPath(req.url);
  if (parsed.status === 'invalid') {
    sendDiagnostic(res, 400, INVALID_REQUEST);
    return;
  }
  if (parsed.status !== 'valid' || !['GET', 'HEAD'].includes(req.method) ||
      typeof artRoot !== 'string' || typeof getActivePackage !== 'function' ||
      typeof lookupPrivateAsset !== 'function') {
    sendDiagnostic(res, 404, NOT_FOUND);
    return;
  }

  const initialActive = getActivePackage();
  if (initialActive?.contentRevision === parsed.contentRevision &&
      !manifestKeysAreSafe(initialActive.assetManifest)) {
    sendDiagnostic(res, 400, INVALID_REQUEST);
    return;
  }

  const selected = activeEntry(
    { getActivePackage, lookupPrivateAsset },
    parsed.contentRevision,
    parsed.assetKey,
  );
  if (!selected) {
    sendDiagnostic(res, 404, NOT_FOUND);
    return;
  }

  let handle = null;
  let closePromise = null;
  const closeOnce = () => {
    if (!handle) return Promise.resolve();
    if (!closePromise) closePromise = handle.close();
    return closePromise;
  };

  try {
    const rootAbsolute = path.resolve(artRoot);
    const candidate = path.resolve(selected.privateEntry.absolutePath);
    if (!isInside(rootAbsolute, candidate)) throw new Error('outside runtime root');
    await rejectLinkedAncestors(rootAbsolute, candidate, fsPromises);

    const [rootReal, currentReal] = await Promise.all([
      fsPromises.realpath(rootAbsolute),
      fsPromises.realpath(candidate),
    ]);
    if (!isInside(rootReal, currentReal) ||
        !samePath(currentReal, selected.privateEntry.realPath)) {
      throw new Error('runtime path identity changed');
    }

    handle = await fsPromises.open(currentReal, 'r');
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() ||
        before.size !== BigInt(selected.privateEntry.bytes) ||
        !sameFileIdentity(before, selected.privateEntry.fileIdentity)) {
      throw new Error('opened file identity changed');
    }

    const after = await handle.stat({ bigint: true });
    if (!after.isFile() ||
        after.size !== before.size ||
        !sameFileIdentity(after, selected.privateEntry.fileIdentity)) {
      throw new Error('opened asset identity changed');
    }

    const stillActive = activeEntry(
      { getActivePackage, lookupPrivateAsset },
      parsed.contentRevision,
      parsed.assetKey,
    );
    if (!stillActive ||
        stillActive.privateEntry !== selected.privateEntry ||
        stillActive.publicEntry !== selected.publicEntry) {
      throw new Error('active route changed');
    }

    setAssetHeaders(res, selected.publicEntry);
    const etag = `"sha256-${selected.publicEntry.sha256}"`;
    if (etagMatches(req.headers?.['if-none-match'], etag)) {
      res.statusCode = 304;
      res.end();
      return;
    }
    if (req.method === 'HEAD') {
      res.statusCode = 200;
      res.end();
      return;
    }

    res.statusCode = 200;
    res.end(selected.privateEntry.verifiedBytes);
  } catch {
    sendDiagnostic(res, 404, NOT_FOUND);
  } finally {
    try {
      await closeOnce();
    } catch {
      if (res.headersSent) res.destroy();
    }
  }
}

module.exports = {
  parseRequestPath,
  serveCourseArtRequest,
};
