'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  validateRuntimeIndex,
  validateRuntimeManifest,
} = require('../../lib/generated/course-art-pack-validator');

function safeJoin(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes(':') ||
      relative.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('COURSE_ART_SMOKE_PATH');
  }
  const target = path.resolve(root, ...relative.split('/'));
  const rel = path.relative(path.resolve(root), target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error('COURSE_ART_SMOKE_PATH');
  }
  return target;
}

function smokeRuntimeCourseArt({ runtimeRoot }) {
  const index = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'index.json'), 'utf8'));
  if (!validateRuntimeIndex(index)) {
    throw new Error(`COURSE_ART_SMOKE_INDEX: ${JSON.stringify(validateRuntimeIndex.errors)}`);
  }
  for (const entry of index.packs) {
    const manifest = JSON.parse(fs.readFileSync(safeJoin(runtimeRoot, entry.manifest), 'utf8'));
    if (!validateRuntimeManifest(manifest)) {
      throw new Error(`COURSE_ART_SMOKE_MANIFEST: ${JSON.stringify(validateRuntimeManifest.errors)}`);
    }
    if (manifest.packId !== entry.packId || manifest.courseId !== entry.courseId) {
      throw new Error('COURSE_ART_SMOKE_IDENTITY');
    }
  }
  return { status: 'valid', packCount: index.packs.length };
}

if (require.main === module) {
  const runtimeRoot = process.argv[2] || process.env.BIRDIE_ART_DIR;
  if (!runtimeRoot) throw new Error('Usage: packaged-smoke.cjs <runtime-root>');
  process.stdout.write(`${JSON.stringify(smokeRuntimeCourseArt({ runtimeRoot }))}\n`);
}

module.exports = { smokeRuntimeCourseArt };
