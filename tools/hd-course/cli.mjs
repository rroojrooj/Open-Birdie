// HD hole compiler CLI: `node tools/hd-course/cli.mjs build --manifest <path>`.
//
// `build` wires the LIVE providers (3DEP + NAIP) into the compiler — this is the
// opt-in network path. It fails fast on a pending manifest before touching the
// network. The offline compile path (compiler.mjs with injected providers) is
// what the test suite exercises; this live wiring is validated by the deferred
// smoke/build capstone.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadManifest, assertBuildable, assertCourseMatches } from './config.mjs';
import { loadCourseFile } from './course-source.mjs';
import { resolveManifest } from './discover.mjs';
import { compileHole } from './compiler.mjs';
import { acquireElevation as liveAcquireElevation } from './three-dep.mjs';
import { searchNaipCandidates, selectPinnedAcquisition, assetHref } from './naip.mjs';
import { openPinnedCog, makeSemaphore, assertCogDrift } from './cog-source.mjs';
import { fetchBounded } from './http.mjs';
import { wgs84ToUtm, localToWgs84 } from './coordinates.mjs';
import { hdCoursesRoot, hdBuildCacheRoot } from './paths.mjs';
import { makeReport } from './report.mjs';
import lidar from '../../lib/lidar.js';
import elevation from '../../lib/elevation.js';
import { HdCompileError } from './errors.mjs';

const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function parse(argv) {
  const cmd = argv[0];
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const flag = (n) => argv.includes(`--${n}`);
  return { cmd, opt, flag };
}

function boundsUtmExtent(bounds, origin, epsg) {
  const pts = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.minX, bounds.maxY], [bounds.maxX, bounds.maxY]]
    .map(([x, y]) => wgs84ToUtm(localToWgs84({ x, y }, origin), epsg));
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  return { minU: Math.min(...xs), maxU: Math.max(...xs), minV: Math.min(...ys), maxV: Math.max(...ys) };
}

// Adapt the Plan 1 bounded HTTP into the geotiff client's fetch shape.
const boundedFetch = (manifest) => async (url, { headers, signal } = {}) => {
  const r = await fetchBounded(url, {
    range: headers && (headers.Range || headers.range),
    allowedHosts: [new URL(url).hostname],
    maxBytes: manifest.limits.maxDownloadBytes,
  });
  return {
    status: r.status,
    headers: r.headers,
    arrayBuffer: async () => r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength),
  };
};

// The HD patch edge ring + any 3DEP NoData cells must blend to the COARSE course
// terrain, not to 0, or the patch boundary steps off a cliff against the coarse
// surround. Reuse the runtime's own gridSampler so the compiler's edge target is
// byte-identical to the coarse mesh the runtime draws (continuous seam). Heights
// are relative to course baseM — the same frame resampleTerrain stores HD in.
export function coarseBaseHeight(course) {
  if (!course || !course.elevation) return () => 0;
  const s = elevation.gridSampler(course.elevation);
  return (x, y) => s.h(x, y);
}

function liveProviders(manifest, course) {
  return {
    acquireElevation: async ({ bbox, origin }) => {
      const { patch, stats } = await liveAcquireElevation(bbox, {
        targetM: manifest.terrain.targetSpacingM,
        nativeSpacingM: 3.4, // Gate 1.5 measured native ≈3.4 m at Bandon
      });
      const sampler = lidar.makePatchSampler(patch);
      const baseM = course.elevation ? course.elevation.baseM : 0;
      return { sampler, baseM, baseHeightAt: coarseBaseHeight(course), stats };
    },
    acquireImagery: async ({ bbox, bounds, origin }) => {
      const features = await searchNaipCandidates({ bbox, endpoint: manifest.providers.imagery });
      const picked = selectPinnedAcquisition(features, manifest);
      const sem = makeSemaphore(2);
      const sources = [];
      let epsg;
      for (const f of picked) {
        epsg = `EPSG:${f.properties['proj:epsg']}`;
        const tiff = await openPinnedCog({ url: assetHref(f), fetchImpl: boundedFetch(manifest), semaphore: sem });
        const image = await tiff.getImage();
        const [ox, oy] = image.getOrigin();
        const [rx, ry] = image.getResolution(); // ry is negative (north-up)
        const ext = boundsUtmExtent(bounds, origin, epsg);
        const px = (u, v) => [Math.floor((u - ox) / rx), Math.floor((v - oy) / ry)];
        const [x0, y0] = px(ext.minU, ext.maxV);
        const [x1, y1] = px(ext.maxU, ext.minV);
        const win = [Math.max(0, x0), Math.max(0, y0), Math.min(image.getWidth(), x1 + 1), Math.min(image.getHeight(), y1 + 1)];
        const data = await image.readRasters({ window: win, interleave: true, samples: [0, 1, 2] });
        sources.push({
          rgb: Buffer.from(data.buffer || data),
          width: win[2] - win[0],
          height: win[3] - win[1],
          geo: { originX: ox + win[0] * rx, originY: oy + win[1] * ry, pixelW: rx, pixelH: -ry, epsg },
        });
      }
      return { sources, epsg };
    },
  };
}

export async function main(argv) {
  const { cmd, opt, flag } = parse(argv);

  if (cmd === 'discover') {
    const manifestPath = opt('manifest');
    const manifest = loadManifest(manifestPath);
    const course = loadCourseFile(opt('course'));
    const next = await resolveManifest({ manifest, course, providers: { searchNaipCandidates, assertCogDrift } });
    if (flag('write')) {
      fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
      process.stdout.write(`Resolved manifest written: ${manifestPath}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(next, null, 2)}\n`);
    }
    return next;
  }

  if (cmd === 'build') {
    const manifest = loadManifest(opt('manifest'));
    assertBuildable(manifest); // throws HD_MANIFEST_PENDING before any network
    const course = loadCourseFile(opt('course'));
    assertCourseMatches(manifest, course);
    const courseDir = path.join(hdCoursesRoot(), slug(manifest.course.name));
    const stagingDir = path.join(hdBuildCacheRoot(), 'staging', `${slug(manifest.course.name)}-h${manifest.hole}`);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });
    const report = makeReport();
    const result = await compileHole({ manifest, course, stagingDir, courseDir, ...liveProviders(manifest, course), report });
    process.stdout.write(`Published bundle ${result.bundleId}\n${report.toString()}\n`);
    return result;
  }

  throw new HdCompileError('cli', 'HD_CLI_USAGE', { cmd: cmd ?? null });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.stack || e}\n`); process.exit(1); });
}
