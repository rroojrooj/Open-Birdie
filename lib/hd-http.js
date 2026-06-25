'use strict';
// Secure serving of validated HD bundle assets. The asset KEY is an enum mapped
// to a path already validated by lib/hd-bundle.js — a request never resolves a
// URL filename, so there is no traversal surface. GET/HEAD with correct MIME +
// length, a single byte range (206/Content-Range, 416 on bad/multi), and private
// immutable cache headers (the bundle id is content-addressed).

const fs = require('node:fs');

const MIME = {
  terrain: 'application/octet-stream',
  orthophoto: 'image/webp',
  surfaces: 'image/png',
  coverage: 'image/png',
};
const ASSET_KEYS = ['terrain', 'orthophoto', 'surfaces', 'coverage'];

function notFound(res) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); }
function rangeNotSatisfiable(res, total) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); res.end(); }

function serveHdAsset(req, res, descriptor, assetKey) {
  if (!ASSET_KEYS.includes(assetKey) || !descriptor || !descriptor.assetPaths || !descriptor.assetPaths[assetKey]) {
    return notFound(res);
  }
  const file = descriptor.assetPaths[assetKey];
  let stat;
  try { stat = fs.statSync(file); } catch { return notFound(res); }
  const total = stat.size;
  const headers = {
    'Content-Type': MIME[assetKey],
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
  };
  const isHead = req.method === 'HEAD';

  const range = req.headers && req.headers.range;
  if (range) {
    if (range.includes(',')) return rangeNotSatisfiable(res, total); // multi-range unsupported
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return rangeNotSatisfiable(res, total);
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? null : Number(m[2]);
    if (start === null && end === null) return rangeNotSatisfiable(res, total);
    if (start === null) { start = Math.max(0, total - end); end = total - 1; } // suffix range
    else if (end === null || end >= total) end = total - 1;
    if (start < 0 || start > end || start >= total) return rangeNotSatisfiable(res, total);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
    if (isHead) return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  res.writeHead(200, { ...headers, 'Content-Length': total });
  if (isHead) return res.end();
  return fs.createReadStream(file).pipe(res);
}

// Client-safe view of a resolved HD descriptor (no absolute paths, no heights).
function publicHdMetadata(descriptor) {
  return descriptor ? descriptor.metadata : null;
}

module.exports = { serveHdAsset, publicHdMetadata, ASSET_KEYS, MIME };
