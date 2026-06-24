import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest, loadManifest, isBuildable, assertBuildable } from '../tools/hd-course/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bandonPath = path.join(HERE, '..', 'tools', 'hd-course', 'manifests', 'bandon-dunes-hole-01.json');
const resolved = JSON.parse(
  fs.readFileSync(path.join(HERE, 'fixtures', 'hd-course', 'manifest-resolved.json'), 'utf8'),
);

test('the committed Bandon manifest loads, validates, and is pending', () => {
  const m = loadManifest(bandonPath);
  assert.equal(m.hole, 1);
  assert.equal(m.imagery.date, '2022-06-23');
  assert.equal(m.discovered.state, 'pending');
  assert.equal(isBuildable(m), false);
  assert.throws(() => assertBuildable(m), /HD_MANIFEST_PENDING/);
});

test('a resolved manifest is buildable', () => {
  const m = parseManifest(resolved);
  assert.equal(m.discovered.state, 'resolved');
  assert.equal(isBuildable(m), true);
  assert.doesNotThrow(() => assertBuildable(m));
});

test('unknown top-level keys are rejected (fail closed)', () => {
  assert.throws(() => parseManifest({ ...resolved, surpriseKey: 1 }), /HD_MANIFEST_INVALID/);
});

test('an unsupported CRS is rejected', () => {
  const bad = { ...resolved, terrain: { ...resolved.terrain, crs: 'EPSG:9999' } };
  assert.throws(() => parseManifest(bad), /HD_MANIFEST_INVALID/);
});

test('an out-of-range terrain spacing is rejected', () => {
  const bad = { ...resolved, terrain: { ...resolved.terrain, targetSpacingM: 999 } };
  assert.throws(() => parseManifest(bad), /HD_MANIFEST_INVALID/);
});

test('a resolved manifest missing its discovered assets is rejected', () => {
  const bad = { ...resolved, discovered: { state: 'resolved', bounds: resolved.discovered.bounds } };
  assert.throws(() => parseManifest(bad), /HD_MANIFEST_INVALID/);
});

test('an oversized manifest file is rejected before parse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-mani-'));
  const big = path.join(dir, 'big.json');
  fs.writeFileSync(big, JSON.stringify({ pad: 'x'.repeat(300 * 1024) }));
  assert.throws(() => loadManifest(big), /HD_MANIFEST_TOO_LARGE/);
});
