import test from 'node:test';
import assert from 'node:assert/strict';
import { HdCompileError, redactUrl, sanitizeContext } from '../tools/hd-course/errors.mjs';

test('HdCompileError carries stage, code, and a composed message', () => {
  const err = new HdCompileError('download-imagery', 'HD_HTTP_TIMEOUT', { n: 1 });
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'HdCompileError');
  assert.equal(err.stage, 'download-imagery');
  assert.equal(err.code, 'HD_HTTP_TIMEOUT');
  assert.match(err.message, /download-imagery: HD_HTTP_TIMEOUT/);
});

test('HdCompileError appends and preserves the cause', () => {
  const cause = new Error('socket hang up');
  const err = new HdCompileError('download-elevation', 'HD_HTTP_FETCH', {}, cause);
  assert.match(err.message, /socket hang up/);
  assert.equal(err.cause, cause);
});

test('redactUrl masks sensitive query values and preserves the rest', () => {
  assert.equal(
    redactUrl('https://x.test/a?token=secret&x=1'),
    'https://x.test/a?token=REDACTED&x=1',
  );
  for (const key of ['sig', 'signature', 'api_key', 'credential']) {
    assert.equal(
      redactUrl(`https://x.test/a?${key}=zzz&keep=2`),
      `https://x.test/a?${key}=REDACTED&keep=2`,
    );
  }
});

test('redactUrl leaves innocuous keys that merely contain a secret substring', () => {
  assert.equal(redactUrl('https://x.test/a?design=ok'), 'https://x.test/a?design=ok');
});

test('redactUrl does not throw on an unparseable string but still redacts', () => {
  assert.match(redactUrl('garbage token=secret here'), /token=REDACTED/);
});

test('sanitizeContext redacts URL values and secret-named keys', () => {
  const ctx = sanitizeContext({ url: 'https://x.test/a?sig=abc', token: 'plain', n: 3 });
  assert.match(ctx.url, /sig=REDACTED/);
  assert.equal(ctx.token, 'REDACTED');
  assert.equal(ctx.n, 3);
});

test('HdCompileError sanitizes its context so tokens never leak', () => {
  const err = new HdCompileError('discover-imagery', 'HD_X', { url: 'https://x.test/a?token=leakme' });
  assert.match(err.context.url, /token=REDACTED/);
  assert.doesNotMatch(JSON.stringify(err.context), /leakme/);
});
