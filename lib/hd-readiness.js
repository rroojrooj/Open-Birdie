'use strict';
// Security core for the course-revision readiness handshake. A revision is
// activated only on an acknowledgement from the loopback primary client that
// carries the server's secret nonce (constant-time compared) and the CURRENT
// revision. LAN/SSE mirrors can render but never activate. Pure + Node-testable;
// the server owns the stateful held-terrain + timeout flow around it.

const crypto = require('node:crypto');

function makeNonce() {
  return crypto.randomBytes(32).toString('hex');
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba); // keep the comparison cost ~constant on length mismatch
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// Order-independent equality of two non-empty bundle-id sets. Multi-patch HD
// activates N bundles at once, so the loopback ack must name exactly the active
// set (no missing/extra ids) before physics flips to HD.
function sameBundleSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i += 1) {
    if (!timingSafeEqualStr(sa[i], sb[i])) return false;
  }
  return true;
}

function verifyReadinessAck(ack, { currentRevision, currentBundleIds, serverNonce, isLoopback }) {
  if (!isLoopback) return { ok: false, code: 'HD_NOT_LOOPBACK' };
  if (!ack || !timingSafeEqualStr(ack.primaryNonce, serverNonce)) return { ok: false, code: 'HD_BAD_NONCE' };
  if (ack.courseRevision !== currentRevision) return { ok: false, code: 'HD_STALE_REVISION' };
  if (ack.mode !== 'hd' && ack.mode !== 'procedural') return { ok: false, code: 'HD_BAD_MODE' };
  if (ack.mode === 'hd' && !sameBundleSet(ack.bundleIds, currentBundleIds)) return { ok: false, code: 'HD_BUNDLE_MISMATCH' };
  return { ok: true, mode: ack.mode };
}

module.exports = { makeNonce, timingSafeEqualStr, verifyReadinessAck, sameBundleSet };
