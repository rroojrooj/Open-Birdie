import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localToWgs84, wgs84ToLocal, wgs84ToUtm, utmToWgs84, lonToMerc, latToMerc,
} from '../tools/hd-course/coordinates.mjs';

const origin = { lat: 43.188372, lon: -124.391261 }; // Bandon Dunes

test('local -> WGS84 -> local round-trips within 0.05 m', () => {
  for (const local of [{ x: 0, y: 0 }, { x: 155.02, y: 258.26 }, { x: -80, y: -120 }, { x: 300, y: -50 }]) {
    const ll = localToWgs84(local, origin);
    const rt = wgs84ToLocal(ll, origin);
    assert.ok(Math.hypot(rt.x - local.x, rt.y - local.y) < 0.05, `round-trip ${JSON.stringify(rt)} vs ${JSON.stringify(local)}`);
  }
});

test('the origin maps to local (0,0)', () => {
  const ll = localToWgs84({ x: 0, y: 0 }, origin);
  assert.ok(Math.abs(ll.lat - origin.lat) < 1e-9);
  assert.ok(Math.abs(ll.lon - origin.lon) < 1e-9);
});

test('north-up: +y is north (greater lat), +x is east (greater lon)', () => {
  assert.ok(localToWgs84({ x: 0, y: 100 }, origin).lat > origin.lat);
  assert.ok(localToWgs84({ x: 100, y: 0 }, origin).lon > origin.lon);
});

test('WGS84 <-> UTM zone 10N (EPSG:26910) round-trips and lands in range', () => {
  const utm = wgs84ToUtm(origin, 'EPSG:26910');
  assert.ok(utm.x > 0 && utm.x < 1_000_000, `easting ${utm.x}`);
  assert.ok(utm.y > 4_000_000 && utm.y < 5_500_000, `northing ${utm.y}`);
  const back = utmToWgs84(utm, 'EPSG:26910');
  assert.ok(Math.abs(back.lat - origin.lat) < 1e-6);
  assert.ok(Math.abs(back.lon - origin.lon) < 1e-6);
});

test('an unknown CRS is rejected', () => {
  assert.throws(() => wgs84ToUtm(origin, 'EPSG:99999'), /HD_CRS_UNKNOWN/);
});

test('Web Mercator helpers match the lidar convention (R=6378137)', () => {
  assert.ok(Math.abs(lonToMerc(0)) < 1e-6);
  assert.ok(Math.abs(latToMerc(0)) < 1e-6);
  assert.ok(lonToMerc(180) > 2e7);
});

test('non-finite input is rejected', () => {
  assert.throws(() => wgs84ToLocal({ lat: NaN, lon: 0 }, origin), /HD_COORD/);
});
