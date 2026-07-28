import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = path.resolve('.');

function tempData() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-server-race-'));
  fs.mkdirSync(path.join(dataDir, 'courses'));
  return dataDir;
}

function course(osmId, overrides = {}) {
  return {
    version: 4,
    name: `Course ${osmId}`,
    source: {
      courseId: `osm:way:${osmId}`,
      osmType: 'way',
      osmId,
    },
    origin: { lat: 47, lon: -122 },
    surfaces: [],
    boundary: null,
    holes: [{
      ref: 1,
      par: 4,
      tee: [0, 0],
      pin: [0, 100],
      line: [[0, 0], [0, 100]],
      lengthYd: 109,
    }],
    elevation: null,
    ...overrides,
  };
}

test('server integration keeps cached B active when older network A fails late', async () => {
  const dataDir = tempData();
  fs.writeFileSync(
    path.join(dataDir, 'courses', 'osm-way-2.json'),
    JSON.stringify(course(2)),
  );
  fs.writeFileSync(
    path.join(dataDir, 'courses', 'legacy-v3.json'),
    JSON.stringify(course(3, { version: 3 })),
  );
  process.env.BIRDIE_PORT = '0';
  process.env.BIRDIE_OC_PORT = '0';
  process.env.BIRDIE_NO_AUTOLOAD = '1';
  process.env.BIRDIE_NO_WATCH = '1';
  process.env.BIRDIE_DATA_DIR = dataDir;
  process.env.BIRDIE_ART_DIR = path.join(dataDir, 'missing-art');

  const nativeFetch = globalThis.fetch;
  const failedResponse = {
    ok: false,
    status: 400,
    text: async () => 'injected old-request failure',
  };
  let fetchReleased = false;
  let releaseFetch;
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
  globalThis.fetch = () => {
    if (fetchReleased) return Promise.resolve(failedResponse);
    return new Promise((resolve) => {
      markFetchStarted();
      releaseFetch = () => {
        fetchReleased = true;
        resolve(failedResponse);
      };
    });
  };

  const server = require('../server.js');
  await server.ready;
  try {
    const activateA = server.activationManager.activate({
      name: 'Slow A',
      osmType: 'way',
      osmId: 1,
      bbox: [46.9, 47.1, -122.1, -121.9],
    });
    await fetchStarted;
    const activateB = server.activationManager.activate({ cached: 'osm-way-2.json' });
    const resultB = await activateB;
    releaseFetch();
    const resultA = await activateA;

    assert.equal(resultB.status, 'committed');
    assert.equal(resultB.courseRevision, 1);
    assert.equal(resultA.status, 'superseded');
    assert.equal(server.activationManager.current().courseId, 'osm:way:2');

    const geometry = await nativeFetch(
      `http://127.0.0.1:${(await server.ready).httpPort}/api/course-geometry`,
    ).then((response) => response.json());
    assert.equal(geometry.courseId, 'osm:way:2');
    assert.equal(geometry.courseRevision, 1);
    assert.equal(geometry.name, 'Course 2');
    assert.doesNotMatch(JSON.stringify(geometry), /ob-server-race-|[A-Za-z]:\\/u);

    const legacyResult = await server.activationManager.activate({ cached: 'legacy-v3.json' });
    assert.equal(legacyResult.status, 'committed');
    assert.equal(legacyResult.package.courseId, 'osm:way:3');
    assert.equal(server.activationManager.current().courseId, 'osm:way:3');

    const rejectedResponse = await nativeFetch(
      `http://127.0.0.1:${(await server.ready).httpPort}/api/load-course`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'No stable identity',
          unsafe: 'C:\\Users\\alice\\secret?token=hunter2',
        }),
      },
    );
    const rejected = await rejectedResponse.json();
    assert.equal(rejectedResponse.status, 500);
    assert.equal(rejected.diagnostic.code, 'ACTIVATION_PREPARE_FAILED');
    assert.doesNotMatch(JSON.stringify(rejected), /alice|hunter2|secret|stack|[A-Za-z]:\\/iu);
    assert.equal(server.activationManager.current().courseId, 'osm:way:3');
  } finally {
    server.close();
    globalThis.fetch = nativeFetch;
  }
});

test('successful startup autoload is committed before the HTTP server reports ready', () => {
  const dataDir = tempData();
  fs.writeFileSync(
    path.join(dataDir, 'courses', 'osm-way-49.json'),
    JSON.stringify(course(49)),
  );
  const script = `
    (async () => {
      const server = require('./server.js');
      const ready = await server.ready;
      const geometry = await fetch(
        'http://127.0.0.1:' + ready.httpPort + '/api/course-geometry'
      ).then((response) => response.json());
      server.close();
      console.log('__BOOTSTRAP_RESULT__' + JSON.stringify({
        courseId: geometry && geometry.courseId,
        courseRevision: geometry && geometry.courseRevision,
        name: geometry && geometry.name,
      }));
      setTimeout(() => process.exit(0), 20);
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  const run = childProcess.spawnSync(process.execPath, ['-e', script], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      BIRDIE_PORT: '0',
      BIRDIE_OC_PORT: '0',
      BIRDIE_NO_AUTOLOAD: '',
      BIRDIE_NO_WATCH: '1',
      BIRDIE_DATA_DIR: dataDir,
      BIRDIE_ART_DIR: path.join(dataDir, 'missing-art'),
    },
  });
  assert.equal(run.status, 0, run.stderr);
  const line = run.stdout.split(/\r?\n/u)
    .find((entry) => entry.startsWith('__BOOTSTRAP_RESULT__'));
  assert.deepEqual(
    JSON.parse(line.slice('__BOOTSTRAP_RESULT__'.length)),
    { courseId: 'osm:way:49', courseRevision: 1, name: 'Course 49' },
  );
  assert.doesNotMatch(run.stderr, /\[course\] cache load failed:/u);
});

test('failed startup autoload logs one redacted diagnostic and listens unloaded', () => {
  const dataDir = tempData();
  fs.writeFileSync(
    path.join(dataDir, 'courses', 'osm-way-50.json'),
    JSON.stringify(course(50, {
      holes: [{ ref: 1, par: 4, tee: [0], pin: [0, 100] }],
    })),
  );
  const script = `
    (async () => {
      const server = require('./server.js');
      const ready = await server.ready;
      const geometry = await fetch(
        'http://127.0.0.1:' + ready.httpPort + '/api/course-geometry'
      ).then((response) => response.json());
      server.close();
      console.log('__BOOTSTRAP_RESULT__' + JSON.stringify({ geometry }));
      setTimeout(() => process.exit(0), 20);
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  const run = childProcess.spawnSync(process.execPath, ['-e', script], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      BIRDIE_PORT: '0',
      BIRDIE_OC_PORT: '0',
      BIRDIE_NO_AUTOLOAD: '',
      BIRDIE_NO_WATCH: '1',
      BIRDIE_DATA_DIR: dataDir,
      BIRDIE_ART_DIR: path.join(dataDir, 'missing-art'),
    },
  });
  assert.equal(run.status, 0, run.stderr);
  const line = run.stdout.split(/\r?\n/u)
    .find((entry) => entry.startsWith('__BOOTSTRAP_RESULT__'));
  assert.deepEqual(
    JSON.parse(line.slice('__BOOTSTRAP_RESULT__'.length)),
    { geometry: null },
  );
  assert.equal((run.stderr.match(/\[course\] cache load failed:/gu) || []).length, 1);
  assert.match(run.stderr, /ACTIVATION_PREPARE_FAILED/u);
  assert.doesNotMatch(run.stderr, /Users[\\/]|ob-server-race-|stack/iu);
});
