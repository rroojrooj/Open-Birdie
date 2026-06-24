import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { safeLeaf, resolveWithin, hdCoursesRoot, hdBuildCacheRoot } from '../tools/hd-course/paths.mjs';

test('safeLeaf accepts plain filenames', () => {
  assert.equal(safeLeaf('terrain.f32'), 'terrain.f32');
  assert.equal(safeLeaf('01'), '01');
});

test('safeLeaf rejects traversal, absolute, drive, UNC, separators, NUL', () => {
  // These assertions must hold identically on Windows and POSIX — no platform gating.
  for (const bad of [
    '', '.', '..', '../x', 'a/b', 'a\\b',
    'C:\\temp\\x', 'C:/temp/x', '/etc/passwd',
    '\\\\server\\share\\x', 'x\0y',
  ]) {
    assert.throws(() => safeLeaf(bad), /HD_PATH_TRAVERSAL/, `expected reject: ${JSON.stringify(bad)}`);
  }
});

test('resolveWithin validates each segment and stays under root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-paths-'));
  const p = resolveWithin(root, 'bundles', 'abc', 'terrain.f32');
  assert.equal(p, path.join(root, 'bundles', 'abc', 'terrain.f32'));
  assert.ok(p.startsWith(root + path.sep));
  assert.throws(() => resolveWithin(root, '..', 'escape'), /HD_PATH_TRAVERSAL/);
  assert.throws(() => resolveWithin(root, 'a/b'), /HD_PATH_TRAVERSAL/);
});

test('resolveWithin blocks symlink/junction escapes when creatable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-out-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
  let linked = false;
  // Junctions need no privilege on Windows; fall back to a dir symlink elsewhere.
  try { fs.symlinkSync(outside, path.join(root, 'link'), 'junction'); linked = true; }
  catch { try { fs.symlinkSync(outside, path.join(root, 'link'), 'dir'); linked = true; } catch { /* skip */ } }
  if (linked) {
    assert.throws(() => resolveWithin(root, 'link', 'secret.txt'), /HD_PATH_TRAVERSAL/);
  }
});

test('hd roots resolve under the data directory', () => {
  assert.ok(hdCoursesRoot().endsWith(path.join('data', 'hd-courses')));
  assert.ok(hdBuildCacheRoot().endsWith(path.join('data', 'hd-build-cache')));
});
