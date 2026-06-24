// Bounded HTTP for the HD compiler's provider adapters.
//
// `fetchBounded` is the only sanctioned network primitive: https-only, host
// allow-listed, loopback/private-IP-literal blocked, timeout- and size-bounded,
// with strict range handling and retries limited to transient failures. It fails
// closed (HdCompileError) rather than silently degrading. Redirects are rejected
// outright in the prototype — provider COG/DEM URLs are direct.

import { HdCompileError, redactUrl } from './errors.mjs';

const RETRY_STATUS = new Set([429, 502, 503, 504]);

function isForbiddenHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '[::1]') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]); const b = Number(m[2]);
    if (a === 0 || a === 127) return true;               // wildcard / loopback
    if (a === 10) return true;                            // private
    if (a === 192 && b === 168) return true;              // private
    if (a === 172 && b >= 16 && b <= 31) return true;     // private
    if (a === 169 && b === 254) return true;              // link-local
  }
  return false;
}

function assertUrlAllowed(rawUrl, allowedHosts) {
  let u;
  try { u = new URL(rawUrl); }
  catch (cause) { throw new HdCompileError('http', 'HD_HTTP_URL', { url: String(rawUrl) }, cause); }
  if (u.protocol !== 'https:') throw new HdCompileError('http', 'HD_HTTP_SCHEME', { url: u.href });
  if (!allowedHosts || !allowedHosts.includes(u.hostname)) {
    throw new HdCompileError('http', 'HD_HOST_NOT_ALLOWED', { host: u.hostname });
  }
  if (isForbiddenHost(u.hostname)) throw new HdCompileError('http', 'HD_HOST_FORBIDDEN', { host: u.hostname });
  return u;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchBounded(url, {
  fetchImpl = fetch,
  allowedHosts,
  timeoutMs = 20_000,
  maxBytes,
  range,
  retries = 3,
  backoffMs = 250,
} = {}) {
  assertUrlAllowed(url, allowedHosts);

  for (let attempt = 1; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      const headers = {};
      if (range) headers.Range = range;
      res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers });
    } catch (cause) {
      clearTimeout(timer);
      if (attempt <= retries) { await sleep(backoffMs * attempt); continue; }
      throw new HdCompileError('http', 'HD_HTTP_FETCH', { url, attempt }, cause);
    }
    clearTimeout(timer);

    const status = res.status;

    if (status >= 300 && status < 400) {
      const loc = res.headers.get('location');
      throw new HdCompileError('http', 'HD_HTTP_REDIRECT', { url, status, location: loc ? redactUrl(loc) : null });
    }
    if (RETRY_STATUS.has(status) && attempt <= retries) {
      await sleep(backoffMs * attempt);
      continue;
    }
    if (status !== 200 && status !== 206) {
      throw new HdCompileError('http', 'HD_HTTP_STATUS', { url, status });
    }
    // A required range that returned a full 200 is rejected before the body —
    // possibly multiple gigabytes — is ever read.
    if (range && status === 200) {
      throw new HdCompileError('http', 'HD_HTTP_RANGE_IGNORED', { url });
    }

    const declared = res.headers.get('content-length');
    if (maxBytes != null && declared != null) {
      const n = Number(declared);
      if (Number.isFinite(n) && n > maxBytes) {
        throw new HdCompileError('http', 'HD_HTTP_TOO_LARGE', { url, declared: n, maxBytes });
      }
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (maxBytes != null && bytes.length > maxBytes) {
      throw new HdCompileError('http', 'HD_HTTP_TOO_LARGE', { url, got: bytes.length, maxBytes });
    }
    return { status, bytes, headers: res.headers };
  }
}
