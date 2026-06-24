// Range-only Cloud-Optimized GeoTIFF reader for NAIP.
//
// NAIP COGs are large (~1.4 GB) so we never download the whole object: a custom
// geotiff client issues HTTP Range requests only, bounded by a shared semaphore
// (default/max 2 in flight). It refuses any request without a Range header and
// any server that answers a range with a full 200 body. geotiff's own
// RemoteSource also enforces range-only (allowFullFile=false); this is the
// stage-coded outer guard. assertCogDrift confirms the pinned object hasn't moved.

import { fromCustomClient, BaseClient, BaseResponse } from 'geotiff';
import { HdCompileError } from './errors.mjs';

export function makeSemaphore(max = 2) {
  let active = 0;
  const queue = [];
  const acquire = () => new Promise((resolve) => {
    if (active < max) { active += 1; resolve(); } else { queue.push(resolve); }
  });
  const release = () => {
    active -= 1;
    if (queue.length && active < max) { active += 1; queue.shift()(); }
  };
  return { acquire, release, get active() { return active; } };
}

class BoundedResponse extends BaseResponse {
  constructor(res) { super(); this._res = res; }
  get status() { return this._res.status; }
  getHeader(name) { return this._res.headers.get(name) ?? undefined; }
  async getData() { return this._res.arrayBuffer(); }
}

export class BoundedCogClient extends BaseClient {
  constructor(url, { fetchImpl = fetch, semaphore } = {}) {
    super(url);
    this._fetch = fetchImpl;
    this._sem = semaphore || makeSemaphore(2);
  }

  async request({ headers = {}, signal } = {}) {
    const range = headers.Range || headers.range;
    if (!range) throw new HdCompileError('download-imagery', 'HD_COG_FULL_READ', { url: this.url });
    await this._sem.acquire();
    try {
      const res = await this._fetch(this.url, { headers: { ...headers, Range: range }, signal });
      if (res.status === 200) throw new HdCompileError('download-imagery', 'HD_COG_RANGE_IGNORED', { url: this.url });
      return new BoundedResponse(res);
    } finally {
      this._sem.release();
    }
  }
}

export async function openPinnedCog({ url, fetchImpl, semaphore, headers, blockSize }) {
  const client = new BoundedCogClient(url, { fetchImpl, semaphore });
  return fromCustomClient(client, { headers, blockSize });
}

// Confirm the pinned object is unchanged: a 1-byte range read yields the total
// size (via Content-Range) and ETag, which must match the manifest pins.
export async function assertCogDrift({ url, fetchImpl = fetch, expectedContentLength, expectedEtag }) {
  const res = await fetchImpl(url, { headers: { Range: 'bytes=0-0' } });
  if (res.status !== 206) throw new HdCompileError('discover-imagery', 'HD_COG_RANGE_IGNORED', { url, status: res.status });
  await res.arrayBuffer().catch(() => {});
  const cr = res.headers.get('content-range');
  const total = cr ? Number(cr.split('/')[1]) : null;
  const etag = res.headers.get('etag');
  if (expectedContentLength != null && total !== expectedContentLength) {
    throw new HdCompileError('discover-imagery', 'HD_COG_LENGTH_DRIFT', { total, expectedContentLength });
  }
  if (expectedEtag != null && etag !== expectedEtag) {
    throw new HdCompileError('discover-imagery', 'HD_COG_ETAG_DRIFT', { etag, expectedEtag });
  }
  return { total, etag };
}
