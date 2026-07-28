'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CourseCacheError,
  createCourseAcquisitionCoordinator,
  migrateLegacyCourseCache,
  ownedTempPath,
  publishSourceKeyedCourseCache,
  readSourceKeyedCache,
} = require('../lib/course');
const { normalizeCourseSource } = require('../lib/course-identity');

function tempCache() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-course-identity-'));
}

function legacyCourse() {
  return {
    version: 4,
    name: 'Twin Links',
    origin: { lat: 47.1, lon: -122.4 },
    holes: [{ ref: 1 }],
    surfaces: [],
    aerial: {
      file: 'twin-links.aerial.jpg',
      classFile: 'twin-links.classmap.png',
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    },
  };
}

function writeLegacy(cacheDir) {
  const course = legacyCourse();
  fs.writeFileSync(path.join(cacheDir, 'twin-links.json'), JSON.stringify(course));
  fs.writeFileSync(path.join(cacheDir, course.aerial.file), Buffer.from('aerial'));
  fs.writeFileSync(path.join(cacheDir, course.aerial.classFile), Buffer.from('classmap'));
  return course;
}

function instrumentedFs(events, overrides = {}) {
  return {
    ...fs,
    copyFileSync(source, destination) {
      events.push(`copy:${path.basename(destination)}`);
      return fs.copyFileSync(source, destination);
    },
    writeFileSync(file, bytes) {
      events.push(`write:${path.basename(file)}`);
      return fs.writeFileSync(file, bytes);
    },
    renameSync(source, destination) {
      events.push(`rename:${path.basename(destination)}`);
      return fs.renameSync(source, destination);
    },
    ...overrides,
  };
}

test('legacy migration copies referenced assets, publishes JSON last, and preserves legacy bytes', async () => {
  const cacheDir = tempCache();
  const legacy = writeLegacy(cacheDir);
  const legacyBytes = new Map(
    fs.readdirSync(cacheDir).map((name) => [name, fs.readFileSync(path.join(cacheDir, name))]),
  );
  const source = normalizeCourseSource({ osmType: 'way', osmId: 92001 });
  const events = [];

  const migrated = await migrateLegacyCourseCache({
    request: {
      name: ' Twin Links ',
      lat: 47.1,
      lon: -122.4,
    },
    source,
    cacheDir,
    fsImpl: instrumentedFs(events),
    nonce: 'migration-a',
  });

  assert.equal(migrated.status, 'migrated');
  assert.deepEqual(migrated.course.source, source);
  assert.equal(migrated.course.aerial.file, 'osm-way-92001.aerial.jpg');
  assert.equal(migrated.course.aerial.classFile, 'osm-way-92001.classmap.png');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(cacheDir, 'osm-way-92001.json'), 'utf8')),
    migrated.course,
  );
  assert.equal(events.at(-1), 'rename:osm-way-92001.json');
  assert.ok(events.indexOf('rename:osm-way-92001.aerial.jpg') < events.length - 1);
  assert.ok(events.indexOf('rename:osm-way-92001.classmap.png') < events.length - 1);

  for (const [name, bytes] of legacyBytes) {
    assert.deepEqual(fs.readFileSync(path.join(cacheDir, name)), bytes, `${name} remains unchanged`);
  }
  assert.equal(legacy.source, undefined);
});

test('missing origin or wrong geography refuses migration without publishing keyed JSON', async () => {
  const cacheDir = tempCache();
  writeLegacy(cacheDir);
  const source = normalizeCourseSource({ osmType: 'way', osmId: 92001 });

  for (const request of [
    { name: 'Twin Links' },
    { name: 'Twin Links', lat: 48, lon: -122.4 },
  ]) {
    const result = await migrateLegacyCourseCache({ request, source, cacheDir });
    assert.equal(result.status, 'rejected');
    assert.equal(result.code, 'CACHE_LEGACY_MIGRATION_REJECTED');
    assert.equal(fs.existsSync(path.join(cacheDir, 'osm-way-92001.json')), false);
  }
  assert.equal((await migrateLegacyCourseCache({
    request: { name: 'Other Links', lat: 47.1, lon: -122.4 },
    source,
    cacheDir,
  })).status, 'absent');
});

test('injected migration copy failure preserves legacy files and cleans owned temporary files', async () => {
  const cacheDir = tempCache();
  const legacy = writeLegacy(cacheDir);
  const source = normalizeCourseSource({ osmType: 'way', osmId: 92001 });
  const throwingFs = instrumentedFs([], {
    copyFileSync(sourcePath, destination) {
      if (sourcePath.endsWith(legacy.aerial.classFile)) {
        fs.writeFileSync(destination, 'partial');
        throw new Error('injected copy failure');
      }
      return fs.copyFileSync(sourcePath, destination);
    },
  });

  await assert.rejects(
    migrateLegacyCourseCache({
      request: { name: 'Twin Links', lat: 47.1, lon: -122.4 },
      source,
      cacheDir,
      fsImpl: throwingFs,
      nonce: 'failed-migration',
    }),
    /injected copy failure/,
  );
  assert.equal(fs.existsSync(path.join(cacheDir, 'twin-links.json')), true);
  assert.equal(fs.existsSync(path.join(cacheDir, legacy.aerial.file)), true);
  assert.equal(fs.existsSync(path.join(cacheDir, legacy.aerial.classFile)), true);
  assert.equal(fs.existsSync(path.join(cacheDir, 'osm-way-92001.json')), false);
  assert.deepEqual(
    fs.readdirSync(cacheDir).filter((name) => name.includes('.tmp.failed-migration')),
    [],
  );
});

test('newer acquisition cancels a fresh-lock wait without blocking the event loop or leaking staged files', async () => {
  const cacheDir = tempCache();
  writeLegacy(cacheDir);
  const source = normalizeCourseSource({ osmType: 'way', osmId: 92001 });
  const lockPath = path.join(cacheDir, '.osm-way-92001.publish.lock');
  fs.mkdirSync(lockPath);
  let ticks = 0;
  const ticker = setInterval(() => { ticks += 1; }, 1);
  const coordinator = createCourseAcquisitionCoordinator((request, options) => {
    if (options.source.courseId !== source.courseId) {
      return { courseId: options.source.courseId };
    }
    return migrateLegacyCourseCache({
      request,
      source: options.source,
      cacheDir,
      signal: options.signal,
      nonce: 'cancelled-migration',
    });
  });
  const migration = coordinator.acquire(
    { name: 'Twin Links', lat: 47.1, lon: -122.4, osmType: 'way', osmId: 92001 },
    { abortDifferent: true },
  );
  await new Promise((resolve) => setTimeout(resolve, 35));
  const newer = coordinator.acquire(
    { name: 'Newer Course', osmType: 'way', osmId: 92002 },
    { abortDifferent: true },
  );

  try {
    await assert.rejects(migration, { name: 'AbortError' });
    assert.deepEqual(await newer, { courseId: 'osm:way:92002' });
  } finally {
    clearInterval(ticker);
  }
  assert.ok(ticks > 0, 'lock acquisition must yield to the event loop');
  assert.equal(fs.existsSync(lockPath), true, 'a fresh foreign lock is not removed');
  assert.deepEqual(
    fs.readdirSync(cacheDir).filter((name) => name.includes('.tmp.cancelled-migration')),
    [],
  );
});

test('partial staging write failure removes the owned temporary', async () => {
  const cacheDir = tempCache();
  const source = normalizeCourseSource({ osmType: 'way', osmId: 92005 });
  const course = {
    ...legacyCourse(),
    source,
    aerial: null,
  };
  const fsImpl = instrumentedFs([], {
    writeFileSync(file, bytes) {
      fs.writeFileSync(file, Buffer.from(String(bytes).slice(0, 8)));
      throw new Error('injected partial stage failure');
    },
  });

  await assert.rejects(
    publishSourceKeyedCourseCache({
      course,
      source,
      cacheDir,
      fsImpl,
      nonce: 'partial-stage',
    }),
    /injected partial stage failure/u,
  );
  assert.deepEqual(
    fs.readdirSync(cacheDir).filter((name) => name.includes('.tmp.partial-stage')),
    [],
  );
});

test('source-keyed cache hit verifies the exact embedded stable identity', () => {
  const cacheDir = tempCache();
  const source = normalizeCourseSource({ osmType: 'way', osmId: 92001 });
  fs.writeFileSync(path.join(cacheDir, 'osm-way-92001.json'), JSON.stringify({
    ...legacyCourse(),
    source: normalizeCourseSource({ osmType: 'way', osmId: 92002 }),
  }));

  assert.throws(
    () => readSourceKeyedCache({ cacheDir, source }),
    (error) => error instanceof CourseCacheError &&
      error.code === 'CACHE_IDENTITY_MISMATCH' &&
      !JSON.stringify(error).includes(cacheDir),
  );
});

test('owned temporary paths are unique per final artifact and operation nonce', () => {
  const cacheDir = tempCache();
  const jsonPath = path.join(cacheDir, 'osm-way-1.json');
  const aerialPath = path.join(cacheDir, 'osm-way-1.aerial.jpg');
  assert.notEqual(ownedTempPath(jsonPath, 'a'), ownedTempPath(aerialPath, 'a'));
  assert.notEqual(ownedTempPath(jsonPath, 'a'), ownedTempPath(jsonPath, 'b'));
  assert.equal(path.dirname(ownedTempPath(jsonPath, 'a')), cacheDir);
});

test('competing same-identity publishers commit one coherent artifact set with JSON last', async () => {
  const cacheDir = tempCache();
  const source = normalizeCourseSource({ osmType: 'way', osmId: 92003 });
  const stem = 'osm-way-92003';
  const events = [];
  const fsImpl = instrumentedFs(events);
  let stagedCount = 0;
  let releaseStaged;
  const bothStaged = new Promise((resolve) => { releaseStaged = resolve; });
  const beforeLock = async () => {
    stagedCount += 1;
    if (stagedCount === 2) releaseStaged();
    await bothStaged;
  };
  const candidate = (marker) => ({
    ...legacyCourse(),
    name: `Publisher ${marker}`,
    source,
    aerial: {
      file: `${stem}.aerial.jpg`,
      classFile: `${stem}.classmap.png`,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      marker,
    },
  });
  const publish = (marker) => publishSourceKeyedCourseCache({
    course: candidate(marker),
    source,
    cacheDir,
    fsImpl,
    nonce: `publisher-${marker}`,
    beforeLock,
    artifacts: [
      { file: `${stem}.aerial.jpg`, bytes: Buffer.from(`${marker}-aerial`) },
      { file: `${stem}.classmap.png`, bytes: Buffer.from(`${marker}-classmap`) },
    ],
  });

  const results = await Promise.all([publish('A'), publish('B')]);
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ['existing', 'published'],
  );

  const diskCourse = JSON.parse(
    fs.readFileSync(path.join(cacheDir, `${stem}.json`), 'utf8'),
  );
  const marker = diskCourse.aerial.marker;
  assert.equal(fs.readFileSync(path.join(cacheDir, diskCourse.aerial.file), 'utf8'), `${marker}-aerial`);
  assert.equal(fs.readFileSync(path.join(cacheDir, diskCourse.aerial.classFile), 'utf8'), `${marker}-classmap`);
  const publishedResult = results.find((result) => result.status === 'published');
  const existingResult = results.find((result) => result.status === 'existing');
  assert.equal(existingResult.course.name, publishedResult.course.name);

  const renames = events.filter((event) => event.startsWith('rename:'));
  assert.equal(renames.at(-1), `rename:${stem}.json`);
  assert.deepEqual(
    fs.readdirSync(cacheDir).filter((name) => name.includes('.tmp.') || name.endsWith('.publish.lock')),
    [],
  );
});

test('publication error releases its lock and cleans every owned staged temporary', async () => {
  const cacheDir = tempCache();
  const source = normalizeCourseSource({ osmType: 'way', osmId: 92004 });
  const stem = 'osm-way-92004';
  const course = {
    ...legacyCourse(),
    source,
    aerial: null,
  };
  const fsImpl = instrumentedFs([], {
    renameSync(sourcePath, destination) {
      if (destination.endsWith(`${stem}.json`)) throw new Error('injected publication failure');
      return fs.renameSync(sourcePath, destination);
    },
  });

  await assert.rejects(
    publishSourceKeyedCourseCache({
      course,
      source,
      cacheDir,
      fsImpl,
      nonce: 'failed-publication',
    }),
    /injected publication failure/u,
  );
  assert.deepEqual(
    fs.readdirSync(cacheDir).filter((name) =>
      name.includes('.tmp.failed-publication') || name.endsWith('.publish.lock')),
    [],
  );
});

test('same stable identity shares one acquisition while different identities stay isolated', async () => {
  const pending = new Map();
  let calls = 0;
  const coordinator = createCourseAcquisitionCoordinator((request, { source, signal }) => {
    calls += 1;
    let resolve;
    const promise = new Promise((resolveValue) => { resolve = resolveValue; });
    pending.set(source.courseId, { resolve, request, signal });
    return promise;
  });

  const a1 = coordinator.acquire({ name: 'First Name', osmType: 'way', osmId: 1 });
  const a2 = coordinator.acquire({ name: 'Renamed Course', osmType: 'way', osmId: 1 });
  assert.equal(a1, a2);
  assert.equal(calls, 1);
  assert.equal(pending.get('osm:way:1').signal.aborted, false);
  pending.get('osm:way:1').resolve({ id: 'a' });
  assert.deepEqual(await a1, { id: 'a' });
  assert.equal(coordinator.inFlightCount(), 0);

  const b = coordinator.acquire({ name: 'Twin Links', osmType: 'way', osmId: 2 });
  const c = coordinator.acquire({ name: 'Twin Links', osmType: 'relation', osmId: 2 });
  assert.notEqual(b, c);
  assert.equal(calls, 3);
  pending.get('osm:way:2').resolve({ id: 'b' });
  pending.get('osm:relation:2').resolve({ id: 'c' });
  assert.deepEqual(await Promise.all([b, c]), [{ id: 'b' }, { id: 'c' }]);
});

test('X to Y to X never reuses an aborted promise and newest X cancels Y', async () => {
  const calls = [];
  const coordinator = createCourseAcquisitionCoordinator((request, { source, signal }) => {
    let resolve;
    let reject;
    const promise = new Promise((resolveValue, rejectValue) => {
      resolve = resolveValue;
      reject = rejectValue;
    });
    signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
    calls.push({ courseId: source.courseId, signal, resolve });
    return promise;
  });

  const firstX = coordinator.acquire(
    { osmType: 'way', osmId: 1 },
    { abortDifferent: true },
  );
  const y = coordinator.acquire(
    { osmType: 'way', osmId: 2 },
    { abortDifferent: true },
  );
  const newestX = coordinator.acquire(
    { osmType: 'way', osmId: 1 },
    { abortDifferent: true },
  );

  assert.equal(calls.length, 3);
  assert.notEqual(firstX, newestX);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(calls[2].signal.aborted, false);
  calls[2].resolve({ id: 'newest-x' });
  await assert.rejects(firstX, { name: 'AbortError' });
  await assert.rejects(y, { name: 'AbortError' });
  assert.deepEqual(await newestX, { id: 'newest-x' });
  assert.equal(coordinator.inFlightCount(), 0);
});

test('nested canonical source owns the acquisition request', async () => {
  let observed;
  const coordinator = createCourseAcquisitionCoordinator((request, options) => {
    observed = { request, options };
    return { courseId: options.source.courseId };
  });

  const result = await coordinator.acquire({
    name: 'Nested Source',
    bbox: [46.9, 47.1, -122.1, -121.9],
    source: { osmType: 'relation', osmId: '22' },
  });

  assert.deepEqual(result, { courseId: 'osm:relation:22' });
  assert.deepEqual(observed.request.source, {
    courseId: 'osm:relation:22',
    osmType: 'relation',
    osmId: 22,
  });
  assert.equal(observed.request.osmType, 'relation');
  assert.equal(observed.request.osmId, 22);
  assert.equal(observed.options.source, observed.request.source);
});

test('duplicate top-level and nested source identities must agree before acquisition', () => {
  let calls = 0;
  const coordinator = createCourseAcquisitionCoordinator(() => {
    calls += 1;
    return {};
  });

  assert.throws(
    () => coordinator.acquire({
      name: 'Contradictory Source',
      osmType: 'way',
      osmId: 23,
      source: { osmType: 'relation', osmId: 23 },
    }),
    (error) => error.code === 'COURSE_IDENTITY_INVALID',
  );
  assert.throws(
    () => coordinator.acquire({
      name: 'Partial Duplicate',
      osmType: 'way',
      source: { osmType: 'way', osmId: 23 },
    }),
    (error) => error.code === 'COURSE_IDENTITY_INVALID',
  );
  assert.throws(
    () => coordinator.acquire(
      {
        name: 'Contradictory Supplied Source',
        source: { osmType: 'way', osmId: 23 },
      },
      { source: { osmType: 'relation', osmId: 23 } },
    ),
    (error) => error.code === 'COURSE_IDENTITY_INVALID',
  );
  assert.equal(calls, 0);
});
