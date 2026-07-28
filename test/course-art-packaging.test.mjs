import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { main as prepareRuntime } from '../tools/course-art/prepare-runtime.mjs';

const require = createRequire(import.meta.url);
const { smokeRuntimeCourseArt } = require('../tools/course-art/packaged-smoke.cjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SOURCE = path.join(REPO, 'courses', 'curated');

function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function treeRecords(root) {
  const records = [];
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else {
        records.push([
          relative,
          crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
        ]);
      }
    }
  }
  walk(root);
  return records;
}

function treeDigest(root) {
  return crypto.createHash('sha256')
    .update(Buffer.from(JSON.stringify(treeRecords(root))))
    .digest('hex');
}

test('development and packaged fixture roots stage byte-identically and pass packaged smoke', async (t) => {
  const parent = temp('ob-course-art-package-roots-');
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const developmentRoot = path.join(parent, 'development', 'course-art');
  const packagedRoot = path.join(parent, 'resources', 'course-art');

  await prepareRuntime(['--source', SOURCE, '--output', developmentRoot]);
  await prepareRuntime(['--source', SOURCE, '--output', packagedRoot]);

  assert.equal(treeDigest(developmentRoot), treeDigest(packagedRoot));
  assert.deepEqual(
    smokeRuntimeCourseArt({ runtimeRoot: developmentRoot }),
    { status: 'valid', packCount: 1 },
  );
  assert.deepEqual(
    smokeRuntimeCourseArt({ runtimeRoot: packagedRoot }),
    { status: 'valid', packCount: 1 },
  );
  const packagedNames = treeRecords(packagedRoot).map(([relative]) => relative);
  assert.equal(packagedNames.some((name) => /references|profile|source/iu.test(name)), false);
});

test('--check stages two isolated trees deterministically without touching its output target', async (t) => {
  const parent = temp('ob-course-art-check-output-');
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const outputRoot = path.join(parent, 'owned-output');
  fs.mkdirSync(outputRoot);
  fs.writeFileSync(path.join(outputRoot, 'sentinel.txt'), 'do not replace');
  const before = treeDigest(outputRoot);

  const result = await prepareRuntime([
    '--check',
    '--source', SOURCE,
    '--output', outputRoot,
  ]);

  assert.equal(result.packCount, 1);
  assert.equal(treeDigest(outputRoot), before);
  assert.equal(fs.readFileSync(path.join(outputRoot, 'sentinel.txt'), 'utf8'), 'do not replace');
});

test('package scripts prepare runtime art and Electron copies only the staged tree', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['prepare:course-art'], 'node tools/course-art/prepare-runtime.mjs');
  assert.equal(pkg.scripts['check:course-art'], 'node tools/course-art/prepare-runtime.mjs --check');
  assert.equal(pkg.scripts.start, 'npm run prepare:course-art && electron .');
  assert.equal(pkg.scripts['start:server'], 'npm run prepare:course-art && node server.js');
  assert.equal(pkg.scripts.pack, 'npm run prepare:course-art && electron-builder --dir');
  assert.equal(pkg.scripts.dist, 'npm run prepare:course-art && electron-builder --win');
  assert.equal(pkg.scripts.prepack, undefined);
  assert.equal(pkg.scripts.predist, undefined);

  assert.deepEqual(pkg.build.extraResources, [{
    from: 'build/course-art',
    to: 'course-art',
    filter: ['**/*'],
  }]);
  assert.ok(pkg.build.files.includes('!lib/schemas/course-art-*.schema.json'));
  assert.ok(pkg.build.files.includes('tools/course-art/packaged-smoke.cjs'));
  assert.equal(pkg.build.files.some((entry) => /^courses(?:\/|$)/u.test(entry)), false);
  assert.equal(pkg.dependencies.ajv, undefined);
  assert.equal(pkg.dependencies.esbuild, undefined);
  assert.ok(pkg.devDependencies.ajv);
  assert.ok(pkg.devDependencies.esbuild);
});

test('packaged main assigns the resources course-art root before loading the server', () => {
  const source = fs.readFileSync(path.join(REPO, 'main.js'), 'utf8');
  const packagedBlock = source.indexOf('if (app.isPackaged)');
  const artAssignment = source.indexOf(
    "process.env.BIRDIE_ART_DIR = path.join(process.resourcesPath, 'course-art')",
  );
  const serverRequire = source.indexOf("require('./server')");
  assert.ok(packagedBlock >= 0);
  assert.ok(artAssignment > packagedBlock);
  assert.ok(serverRequire > artAssignment);
});

test('default preparation regenerates the ignored runtime stage without a Git-visible change', async () => {
  await prepareRuntime([]);
  const status = childProcess.spawnSync(
    'git',
    ['status', '--short', '--untracked-files=all', '--', 'build/course-art'],
    { cwd: REPO, encoding: 'utf8' },
  );
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stdout, '');

  const ignored = childProcess.spawnSync(
    'git',
    ['check-ignore', 'build/course-art/index.json'],
    { cwd: REPO, encoding: 'utf8' },
  );
  assert.equal(ignored.status, 0, ignored.stderr);
  assert.match(ignored.stdout, /build\/course-art\/index\.json/u);
  assert.deepEqual(
    smokeRuntimeCourseArt({ runtimeRoot: path.join(REPO, 'build', 'course-art') }),
    { status: 'valid', packCount: 1 },
  );
});
