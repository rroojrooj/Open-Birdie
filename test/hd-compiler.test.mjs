import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileHole, STAGES } from '../tools/hd-course/compiler.mjs';
import { canonicalCourseFingerprint } from '../tools/hd-course/course-source.mjs';
import { readActive } from '../tools/hd-course/publisher.mjs';
import { localToWgs84, wgs84ToUtm } from '../tools/hd-course/coordinates.mjs';
import { main as cliMain } from '../tools/hd-course/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const course = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'hd-course', 'course.json'), 'utf8'));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function manifest() {
  return {
    schemaVersion: 1,
    course: { name: course.name, cacheVersion: 3, fingerprint: canonicalCourseFingerprint(course) },
    hole: 1,
    padding: 30,
    terrain: { targetSpacingM: 3.0, crs: 'EPSG:3857' },
    imagery: { collection: 'naip', date: '2022-06-23', gsdM: 1.5, itemIds: ['x'] },
    providers: { elevation: 'https://e', imagery: 'https://i' },
    limits: { maxPixels: 80000000, maxDownloadBytes: 3221225472, maxBundleBytes: 157286400 },
    normalization: { format: 'webp', quality: 90 },
    discovered: { state: 'resolved', bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, assets: [{ url: 'https://x.test/a.tif', contentLength: 1, etag: '"x"' }] },
  };
}

// Offline providers: synthetic flat terrain + a quad image covering the bounds.
const providers = {
  acquireElevation: async () => ({ sampler: () => 80, baseM: 12.5, baseHeightAt: () => 0, stats: { groundSpacingM: 3.0, nativeSpacingM: 3.4 } }),
  acquireImagery: async ({ bounds, origin }) => {
    const epsg = 'EPSG:26910';
    const pts = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.minX, bounds.maxY], [bounds.maxX, bounds.maxY]]
      .map(([x, y]) => wgs84ToUtm(localToWgs84({ x, y }, origin), epsg));
    const xs = pts.map((c) => c.x); const ys = pts.map((c) => c.y);
    const minU = Math.min(...xs) - 50; const maxU = Math.max(...xs) + 50;
    const minV = Math.min(...ys) - 50; const maxV = Math.max(...ys) + 50;
    const sz = 16; const rgb = Buffer.alloc(sz * sz * 3, 90);
    return { sources: [{ rgb, width: sz, height: sz, geo: { originX: minU, originY: maxV, pixelW: (maxU - minU) / sz, pixelH: (maxV - minV) / sz, epsg } }], epsg };
  },
};

const withNoNetwork = async (fn) => {
  const real = global.fetch;
  global.fetch = () => { throw new Error('network forbidden in offline compiler test'); };
  try { return await fn(); } finally { global.fetch = real; }
};

test('the stage list matches the documented pipeline', () => {
  assert.deepEqual(STAGES, [
    'resolve-course', 'compute-bounds', 'discover-elevation', 'download-elevation',
    'discover-imagery', 'download-imagery', 'reproject', 'rasterize-masks', 'encode', 'validate', 'publish',
  ]);
});

test('compiles a valid bundle end-to-end with zero network', async () => {
  await withNoNetwork(async () => {
    const courseDir = tmp('hd-cd-');
    const out = await compileHole({ manifest: manifest(), course, stagingDir: tmp('hd-st-'), courseDir, ...providers });
    assert.match(out.bundleId, /^[a-f0-9]{64}$/);
    assert.equal(readActive(courseDir).bundleId, out.bundleId);
    assert.ok(fs.existsSync(path.join(courseDir, 'bundles', out.bundleId, 'manifest.json')));
  });
});

test('two compiles are byte-identical (reproducible)', async () => {
  await withNoNetwork(async () => {
    const a = await compileHole({ manifest: manifest(), course, stagingDir: tmp('hd-st-'), courseDir: tmp('hd-cd-'), ...providers });
    const b = await compileHole({ manifest: manifest(), course, stagingDir: tmp('hd-st-'), courseDir: tmp('hd-cd-'), ...providers });
    assert.equal(a.bundleId, b.bundleId);
  });
});

test('a failure at any stage leaves the previous active bundle untouched', async () => {
  await withNoNetwork(async () => {
    const courseDir = tmp('hd-cd-');
    const first = await compileHole({ manifest: manifest(), course, stagingDir: tmp('hd-st-'), courseDir, ...providers });
    for (const failAt of ['compute-bounds', 'download-imagery', 'reproject', 'encode', 'validate']) {
      await assert.rejects(
        () => compileHole({ manifest: manifest(), course, stagingDir: tmp('hd-st-'), courseDir, ...providers, failAt }),
        /HD_STAGE_FAILED/,
      );
      assert.equal(readActive(courseDir).bundleId, first.bundleId, `active changed after failAt=${failAt}`);
    }
  });
});

test('a course fingerprint mismatch is rejected', async () => {
  await withNoNetwork(async () => {
    const bad = manifest(); bad.course.fingerprint = 'b'.repeat(64);
    await assert.rejects(
      () => compileHole({ manifest: bad, course, stagingDir: tmp('hd-st-'), courseDir: tmp('hd-cd-'), ...providers }),
      /HD_FINGERPRINT_MISMATCH/,
    );
  });
});

test('CLI build refuses a pending manifest before any network', async () => {
  await withNoNetwork(async () => {
    const m = manifest();
    m.course.fingerprint = 'pending';
    m.discovered = { state: 'pending' };
    const p = path.join(tmp('hd-mf-'), 'pending.json');
    fs.writeFileSync(p, JSON.stringify(m));
    await assert.rejects(() => cliMain(['build', '--manifest', p]), /HD_MANIFEST_PENDING/);
  });
});
