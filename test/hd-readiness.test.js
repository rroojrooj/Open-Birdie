'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeNonce, timingSafeEqualStr, verifyReadinessAck } = require('../lib/hd-readiness');

const NONCE = 'n'.repeat(64);
const ctx = (over = {}) => ({ currentRevision: 7, currentBundleId: 'a'.repeat(64), serverNonce: NONCE, isLoopback: true, ...over });
const ack = (over = {}) => ({ courseRevision: 7, bundleId: 'a'.repeat(64), mode: 'hd', primaryNonce: NONCE, ...over });

test('makeNonce returns a unique 64-char hex token', () => {
  const a = makeNonce(); const b = makeNonce();
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, b);
});

test('timingSafeEqualStr: equal true, different/length-mismatch false', () => {
  assert.equal(timingSafeEqualStr('abc', 'abc'), true);
  assert.equal(timingSafeEqualStr('abc', 'abd'), false);
  assert.equal(timingSafeEqualStr('abc', 'abcd'), false);
  assert.equal(timingSafeEqualStr('abc', undefined), false);
});

test('a valid HD ack is accepted', () => {
  const r = verifyReadinessAck(ack(), ctx());
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'hd');
});

test('a valid procedural ack is accepted', () => {
  const r = verifyReadinessAck(ack({ mode: 'procedural', bundleId: null }), ctx());
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'procedural');
});

test('non-loopback is rejected', () => {
  assert.equal(verifyReadinessAck(ack(), ctx({ isLoopback: false })).code, 'HD_NOT_LOOPBACK');
});

test('a wrong nonce is rejected', () => {
  assert.equal(verifyReadinessAck(ack({ primaryNonce: 'x'.repeat(64) }), ctx()).code, 'HD_BAD_NONCE');
});

test('a stale revision is rejected', () => {
  assert.equal(verifyReadinessAck(ack({ courseRevision: 6 }), ctx()).code, 'HD_STALE_REVISION');
});

test('an HD ack for the wrong bundle is rejected', () => {
  assert.equal(verifyReadinessAck(ack({ bundleId: 'b'.repeat(64) }), ctx()).code, 'HD_BUNDLE_MISMATCH');
});

test('an unknown mode is rejected', () => {
  assert.equal(verifyReadinessAck(ack({ mode: 'sneaky' }), ctx()).code, 'HD_BAD_MODE');
});
