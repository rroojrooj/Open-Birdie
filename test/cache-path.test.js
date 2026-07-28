'use strict';
// Regression (packaged-mode contract): the course cache must honor
// BIRDIE_DATA_DIR. A packaged build runs from a read-only app.asar, so main.js
// redirects the writable data dir to per-user AppData via this env var, and
// lib/course.js resolves CACHE_DIR from it at load time. Every cache read AND
// write derives from that single CACHE_DIR, so proving reads resolve under
// BIRDIE_DATA_DIR proves writes land there too. If this breaks, packaged
// installs silently fail to cache courses.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set BEFORE requiring course.js — CACHE_DIR is a load-time const.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-cache-'));
process.env.BIRDIE_DATA_DIR = dataDir;
const coursesDir = path.join(dataDir, 'courses');
fs.mkdirSync(coursesDir, { recursive: true });
const source = { courseId: 'osm:way:777', osmType: 'way', osmId: 777 };
const keyed = {
  version: 4,
  name: 'Test Course',
  origin: { lat: 47.1, lon: -122.4 },
  holes: [{}],
  source,
};
fs.writeFileSync(
  path.join(coursesDir, 'test-course.json'),
  JSON.stringify({ version: 4, name: 'Test Course', origin: keyed.origin, holes: [{}] })
);
fs.writeFileSync(path.join(coursesDir, 'osm-way-777.json'), JSON.stringify(keyed));

const course = require('../lib/course');

test('listCached reads from BIRDIE_DATA_DIR/courses, not the repo default', () => {
  // The repo default (lib/../data/courses) holds none of our temp files, so a
  // non-empty result here can only come from the env-redirected dir.
  assert.deepStrictEqual(course.listCached(), [
    { file: 'osm-way-777.json', name: 'Test Course', courseId: 'osm:way:777' },
  ]);
});

test('loadCached reads from BIRDIE_DATA_DIR/courses', () => {
  assert.strictEqual(course.loadCached('test-course.json').name, 'Test Course');
  assert.deepStrictEqual(course.loadCached('osm-way-777.json').source, source);
});

test('packaged main sets cache and staged course-art roots before requiring the server', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const dataAssignment = main.indexOf('process.env.BIRDIE_DATA_DIR');
  const artAssignment = main.indexOf('process.env.BIRDIE_ART_DIR');
  const serverRequire = main.indexOf("require('./server')");
  assert.ok(dataAssignment >= 0);
  assert.ok(artAssignment > dataAssignment);
  assert.ok(serverRequire > artAssignment);
  assert.match(main, /path\.join\(process\.resourcesPath,\s*'course-art'\)/u);
});

after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
});
