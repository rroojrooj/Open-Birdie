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
fs.writeFileSync(
  path.join(coursesDir, 'test-course.json'),
  JSON.stringify({ version: 2, name: 'Test Course', holes: [{}] })
);

const course = require('../lib/course');

test('listCached reads from BIRDIE_DATA_DIR/courses, not the repo default', () => {
  // The repo default (lib/../data/courses) holds none of our temp files, so a
  // non-empty result here can only come from the env-redirected dir.
  assert.deepStrictEqual(course.listCached(), [
    { file: 'test-course.json', name: 'Test Course' },
  ]);
});

test('loadCached reads from BIRDIE_DATA_DIR/courses', () => {
  assert.strictEqual(course.loadCached('test-course.json').name, 'Test Course');
});

after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
});
