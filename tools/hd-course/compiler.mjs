// HD hole compiler orchestration.
//
// Runs the named stages in order, calling injectable elevation/imagery providers
// (real providers hit 3DEP/NAIP; tests inject synthetic ones for a fully offline,
// deterministic compile). The staged bundle is validated by the Plan 1 runtime
// validator BEFORE the atomic publisher swaps it in, so a failure at any stage
// leaves the previous active bundle untouched.

import { canonicalCourseFingerprint } from './course-source.mjs';
import { computeHoleBounds, snapHdBounds } from './bounds.mjs';
import { localToWgs84 } from './coordinates.mjs';
import { resampleTerrain } from './terrain.mjs';
import { reprojectImagery } from './imagery.mjs';
import { rasterizeMasks } from './masks.mjs';
import { writeBundle } from './encode.mjs';
import { publishBundle } from './publisher.mjs';
import { HdCompileError } from './errors.mjs';
import { makeReport } from './report.mjs';
import hdBundle from '../../lib/hd-bundle.js';

const { validateBundleDirectory } = hdBundle;

export const STAGES = [
  'resolve-course', 'compute-bounds', 'discover-elevation', 'download-elevation',
  'discover-imagery', 'download-imagery', 'reproject', 'rasterize-masks', 'encode', 'validate', 'publish',
];

function boundsToBbox(bounds, origin) {
  const sw = localToWgs84({ x: bounds.minX, y: bounds.minY }, origin);
  const ne = localToWgs84({ x: bounds.maxX, y: bounds.maxY }, origin);
  return { west: sw.lon, south: sw.lat, east: ne.lon, north: ne.lat };
}

function buildProvenance(manifest, course, terr) {
  return {
    course: course.name,
    sources: {
      elevation: { service: '3DEP', nativeSpacingM: terr.stats?.nativeSpacingM ?? null, targetSpacingM: manifest.terrain.targetSpacingM },
      imagery: { collection: manifest.imagery.collection, date: manifest.imagery.date, itemIds: manifest.imagery.itemIds, gsdM: manifest.imagery.gsdM },
    },
    licenses: { osm: 'ODbL', naip: 'US public domain', usgs3dep: 'US public domain' },
    tools: { node: process.version },
  };
}

export async function compileHole({
  manifest, course, stagingDir, courseDir,
  acquireElevation, acquireImagery,
  validate = validateBundleDirectory, publish = publishBundle,
  compilerVersion = '0.1.0', failAt = null, report = makeReport(),
}) {
  const run = async (name, fn) => {
    if (failAt === name) throw new HdCompileError(name, 'HD_STAGE_FAILED', { injected: true });
    const t0 = Date.now();
    const out = await fn();
    report.record(name, Date.now() - t0, out && out.__bytes);
    return out;
  };

  const fingerprint = canonicalCourseFingerprint(course);

  await run('resolve-course', () => {
    if (course.version !== 3) throw new HdCompileError('resolve-course', 'HD_COURSE_VERSION', { version: course.version });
    if (manifest.course.fingerprint !== 'pending' && manifest.course.fingerprint !== fingerprint) {
      throw new HdCompileError('resolve-course', 'HD_FINGERPRINT_MISMATCH', { expected: manifest.course.fingerprint, actual: fingerprint });
    }
    return null;
  });

  const bounds = await run('compute-bounds', () => snapHdBounds(
    computeHoleBounds(course, manifest.hole, manifest.padding),
    { coarse: course.elevation, targetSpacingM: manifest.terrain.targetSpacingM },
  ));
  const bbox = boundsToBbox(bounds, course.origin);

  await run('discover-elevation', () => null);
  const terr = await run('download-elevation', () => acquireElevation({ bbox, bounds, manifest, course, origin: course.origin }));

  await run('discover-imagery', () => null);
  const img = await run('download-imagery', () => acquireImagery({ bbox, bounds, manifest, course, origin: course.origin }));

  const gsd = manifest.imagery.gsdM;
  const imgW = Math.max(2, Math.round((bounds.maxX - bounds.minX) / gsd));
  const imgH = Math.max(2, Math.round((bounds.maxY - bounds.minY) / gsd));

  const rast = await run('reproject', () => {
    const t = resampleTerrain({ sampler: terr.sampler, snapped: bounds, origin: course.origin, baseM: terr.baseM, baseHeightAt: terr.baseHeightAt || (() => 0) });
    const im = reprojectImagery({ sources: img.sources, snapped: bounds, origin: course.origin, outW: imgW, outH: imgH, epsg: img.epsg });
    return { heights: t.heights, rgb: im.rgb, imgW: im.width, imgH: im.height };
  });

  const masks = await run('rasterize-masks', () => rasterizeMasks({ surfaces: course.surfaces, snapped: bounds, width: bounds.nx, height: bounds.ny }));

  await run('encode', () => writeBundle({
    stagingDir, course: course.name, hole: manifest.hole, snapped: bounds, baseM: terr.baseM,
    terrainHeights: rast.heights, rgb: rast.rgb, imgW: rast.imgW, imgH: rast.imgH,
    surfacesRgba: masks.surfaces, coverageRgba: masks.coverage, maskW: masks.width, maskH: masks.height,
    fingerprint, compilerVersion, provenance: buildProvenance(manifest, course, terr),
  }));

  const descriptor = await run('validate', () => {
    const res = validate(stagingDir);
    if (res.status !== 'valid') throw new HdCompileError('validate', 'HD_BUNDLE_INVALID', { code: res.code, message: res.message });
    return res.descriptor;
  });

  const published = await run('publish', () => publish({ stagedDir: stagingDir, courseDir, validate }));
  return { bundleId: published.bundleId, descriptor, report };
}
