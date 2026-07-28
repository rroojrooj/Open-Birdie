'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CourseIdentityError,
  courseCacheStem,
  deriveRequestedOrigin,
  legacyIdentityMatches,
  normalizeCourseSource,
  normalizeDisplayName,
} = require('../lib/course-identity');

test('normalizes node, way, and relation identities to stable course IDs and cache stems', () => {
  for (const [osmType, osmId] of [['node', 1], ['way', 26787026], ['relation', '42']]) {
    const source = normalizeCourseSource({ osmType, osmId });
    assert.deepEqual(source, {
      courseId: `osm:${osmType}:${Number(osmId)}`,
      osmType,
      osmId: Number(osmId),
    });
    assert.equal(courseCacheStem(source), `osm-${osmType}-${Number(osmId)}`);
    assert.deepEqual(normalizeCourseSource(source), source);
  }
});

test('rejects malformed, non-positive, fractional, overflow, and contradictory identities', () => {
  for (const value of [
    null,
    {},
    { osmType: 'area', osmId: 1 },
    { osmType: 'way', osmId: 0 },
    { osmType: 'way', osmId: -1 },
    { osmType: 'way', osmId: 1.5 },
    { osmType: 'way', osmId: Number.MAX_SAFE_INTEGER + 1 },
    { osmType: 'way', osmId: '1.0' },
    { osmType: 'way', osmId: '1e3' },
    { osmType: 'way', osmId: ' 1' },
    { osmType: 'way', osmId: 1, courseId: 'osm:way:2' },
  ]) {
    assert.throws(
      () => normalizeCourseSource(value),
      (error) => error instanceof CourseIdentityError && error.code === 'COURSE_IDENTITY_INVALID',
    );
  }
});

test('display names normalize Unicode, case, and whitespace without becoming identity', () => {
  assert.equal(normalizeDisplayName('  CHAMBERS   Bay  '), 'chambers bay');
  assert.equal(normalizeDisplayName('Cafe\u0301 Links'), normalizeDisplayName('Café Links'));
  assert.equal(normalizeDisplayName(''), '');
});

test('requested origin prefers explicit coordinates and otherwise uses bbox center', () => {
  assert.deepEqual(
    deriveRequestedOrigin({ lat: 47.2, lon: -122.5, bbox: [0, 1, 2, 3] }),
    { lat: 47.2, lon: -122.5 },
  );
  assert.deepEqual(
    deriveRequestedOrigin({ bbox: ['47', '47.2', '-122.6', '-122.4'] }),
    { lat: 47.1, lon: -122.5 },
  );
  assert.equal(deriveRequestedOrigin({ lat: 91, lon: 0 }), null);
  assert.equal(deriveRequestedOrigin({ bbox: [47, 46, -122, -123] }), null);
  assert.equal(deriveRequestedOrigin({}), null);
});

test('legacy identity requires normalized alias equality and the inclusive 250 m boundary', () => {
  const requestedOrigin = { lat: 0, lon: 0 };
  const latitudeForDistance = (metres) => metres / 6371008.8 * 180 / Math.PI;
  const matchesAt = (metres) => legacyIdentityMatches({
    requestedName: ' Twin   Links ',
    requestedOrigin,
    cachedName: 'twin links',
    cachedOrigin: { lat: latitudeForDistance(metres), lon: 0 },
    toleranceM: 250,
  });

  assert.equal(matchesAt(249.9), true);
  assert.equal(matchesAt(250), true);
  assert.equal(matchesAt(250.1), false);
  assert.equal(legacyIdentityMatches({
    requestedName: 'Twin Links',
    requestedOrigin: null,
    cachedName: 'Twin Links',
    cachedOrigin: requestedOrigin,
  }), false);
  assert.equal(legacyIdentityMatches({
    requestedName: 'Twin Links',
    requestedOrigin,
    cachedName: 'Other Links',
    cachedOrigin: requestedOrigin,
  }), false);
});
