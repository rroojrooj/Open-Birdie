'use strict';

const OSM_TYPES = new Set(['node', 'way', 'relation']);
const EARTH_RADIUS_M = 6371008.8;

class CourseIdentityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CourseIdentityError';
    this.code = 'COURSE_IDENTITY_INVALID';
  }

  toJSON() {
    return {
      code: this.code,
      stage: 'identity',
      recovery: 'Select the course again from a result with a valid OpenStreetMap source.',
    };
  }
}

function normalizeOsmId(value) {
  if (typeof value === 'string') {
    if (!/^[1-9][0-9]*$/.test(value)) throw new CourseIdentityError('Invalid OpenStreetMap ID');
    value = Number(value);
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CourseIdentityError('Invalid OpenStreetMap ID');
  }
  return value;
}

function normalizeCourseSource(input) {
  if (!input || typeof input !== 'object' || !OSM_TYPES.has(input.osmType)) {
    throw new CourseIdentityError('Invalid OpenStreetMap source type');
  }
  const osmId = normalizeOsmId(input.osmId);
  const courseId = `osm:${input.osmType}:${osmId}`;
  if (input.courseId != null && input.courseId !== courseId) {
    throw new CourseIdentityError('OpenStreetMap source fields disagree');
  }
  return Object.freeze({ courseId, osmType: input.osmType, osmId });
}

function validLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function deriveRequestedOrigin(input = {}) {
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  if (validLatLon(lat, lon)) return { lat, lon };

  if (!Array.isArray(input.bbox) || input.bbox.length !== 4) return null;
  const [south, north, west, east] = input.bbox.map(Number);
  if (!validLatLon(south, west) || !validLatLon(north, east) ||
      south > north || west > east) return null;
  return {
    lat: (south + north) / 2,
    lon: (west + east) / 2,
  };
}

function normalizeDisplayName(name) {
  if (typeof name !== 'string') return '';
  return name.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function haversineM(a, b) {
  if (!a || !b || !validLatLon(a.lat, a.lon) || !validLatLon(b.lat, b.lon)) return Infinity;
  const toRadians = Math.PI / 180;
  const lat1 = a.lat * toRadians;
  const lat2 = b.lat * toRadians;
  const dLat = (b.lat - a.lat) * toRadians;
  const dLon = (b.lon - a.lon) * toRadians;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function legacyIdentityMatches({
  requestedName,
  requestedOrigin,
  cachedName,
  cachedOrigin,
  toleranceM = 250,
}) {
  const normalizedRequested = normalizeDisplayName(requestedName);
  if (!normalizedRequested || normalizedRequested !== normalizeDisplayName(cachedName)) return false;
  if (!Number.isFinite(toleranceM) || toleranceM < 0) return false;
  return haversineM(requestedOrigin, cachedOrigin) <= toleranceM;
}

function courseCacheStem(input) {
  const source = normalizeCourseSource(input);
  return `osm-${source.osmType}-${source.osmId}`;
}

module.exports = {
  CourseIdentityError,
  courseCacheStem,
  deriveRequestedOrigin,
  haversineM,
  legacyIdentityMatches,
  normalizeCourseSource,
  normalizeDisplayName,
};
