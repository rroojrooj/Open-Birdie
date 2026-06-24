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

function verifyReadinessAck(ack, { currentRevision, currentBundleId, serverNonce, isLoopback }) {
  if (!isLoopback) return { ok: false, code: 'HD_NOT_LOOPBACK' };
  if (!ack || !timingSafeEqualStr(ack.primaryNonce, serverNonce)) return { ok: false, code: 'HD_BAD_NONCE' };
  if (ack.courseRevision !== currentRevision) return { ok: false, code: 'HD_STALE_REVISION' };
  if (ack.mode !== 'hd' && ack.mode !== 'procedural') return { ok: false, code: 'HD_BAD_MODE' };
  if (ack.mode === 'hd' && ack.bundleId !== currentBundleId) return { ok: false, code: 'HD_BUNDLE_MISMATCH' };
  return { ok: true, mode: ack.mode };
}

module.exports = { makeNonce, timingSafeEqualStr, verifyReadinessAck };
