import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { publishBundle, readActive, recoverActivePointer } from '../tools/hd-course/publisher.mjs';

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function stagedBundle() {
  const d = tmp('hd-staged-');
  fs.mkdirSync(path.join(d, 'holes', '01'), { recursive: true });
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ schemaVersion: 1 }));
  fs.writeFileSync(path.join(d, 'holes', '01', 'terrain.f32'), Buffer.alloc(4));
  return d;
}

const validatesAs = (id) => async () => ({
  status: 'valid',
  descriptor: { manifestSha256: id, hole: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
});
const rejects = async () => ({ status: 'rejected', code: 'HD_BAD', message: 'nope' });

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);

test('publishBundle moves a validated bundle in and activates it', async () => {
  const courseDir = tmp('hd-course-');
  const { bundleId } = await publishBundle({ stagedDir: stagedBundle(), courseDir, validate: validatesAs(ID_A) });
  assert.equal(bundleId, ID_A);
  assert.ok(fs.existsSync(path.join(courseDir, 'bundles', ID_A, 'manifest.json')));
  assert.equal(readActive(courseDir).bundleId, ID_A);
});

test('a failed publish leaves the previous active bundle intact', async () => {
  const courseDir = tmp('hd-course-');
  await publishBundle({ stagedDir: stagedBundle(), courseDir, validate: validatesAs(ID_A) });
  await assert.rejects(
    publishBundle({ stagedDir: stagedBundle(), courseDir, validate: rejects }),
    /HD_PUBLISH_INVALID/,
  );
  assert.equal(readActive(courseDir).bundleId, ID_A);
  assert.ok(fs.existsSync(path.join(courseDir, 'bundles', ID_A, 'manifest.json')));
  assert.ok(!fs.existsSync(path.join(courseDir, 'bundles', ID_B)));
});

test('republishing the same immutable bundle id is idempotent', async () => {
  const courseDir = tmp('hd-course-');
  await publishBundle({ stagedDir: stagedBundle(), courseDir, validate: validatesAs(ID_A) });
  const again = await publishBundle({ stagedDir: stagedBundle(), courseDir, validate: validatesAs(ID_A) });
  assert.equal(again.bundleId, ID_A);
  assert.equal(readActive(courseDir).bundleId, ID_A);
});

test('recoverActivePointer drops a stale temp pointer and keeps active', async () => {
  const courseDir = tmp('hd-course-');
  await publishBundle({ stagedDir: stagedBundle(), courseDir, validate: validatesAs(ID_A) });
  fs.writeFileSync(path.join(courseDir, 'active.json.tmp'), '{ truncated');
  recoverActivePointer(courseDir);
  assert.ok(!fs.existsSync(path.join(courseDir, 'active.json.tmp')));
  assert.equal(readActive(courseDir).bundleId, ID_A);
});

test('recoverActivePointer promotes a complete temp pointer when active is missing', async () => {
  const courseDir = tmp('hd-course-');
  await publishBundle({ stagedDir: stagedBundle(), courseDir, validate: validatesAs(ID_A) });
  const active = path.join(courseDir, 'active.json');
  fs.copyFileSync(active, active + '.tmp');
  fs.rmSync(active);
  recoverActivePointer(courseDir);
  assert.ok(fs.existsSync(active));
  assert.equal(readActive(courseDir).bundleId, ID_A);
});

test('publishBundle refuses a non-hash bundle id', async () => {
  const courseDir = tmp('hd-course-');
  await assert.rejects(
    publishBundle({
      stagedDir: stagedBundle(),
      courseDir,
      validate: async () => ({ status: 'valid', descriptor: { manifestSha256: '../escape' } }),
    }),
    /HD_PUBLISH_BADID/,
  );
  assert.equal(readActive(courseDir), null);
});

test('publishBundle refuses an unvalidated staged dir', async () => {
  const courseDir = tmp('hd-course-');
  await assert.rejects(
    publishBundle({ stagedDir: stagedBundle(), courseDir, validate: async () => ({ status: 'absent' }) }),
    /HD_PUBLISH_INVALID/,
  );
});
