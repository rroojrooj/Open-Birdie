// Bounded filesystem paths for the HD compiler.
//
// `safeLeaf` validates a single path segment as a plain filename (string-level,
// identical on Windows and POSIX). `resolveWithin` joins validated segments under
// a root and additionally follows symlinks/junctions on the longest existing
// ancestor to confirm the real location never escapes the root.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HdCompileError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DATA_DIR = process.env.BIRDIE_DATA_DIR || path.join(REPO_ROOT, 'data');

const DRIVE_LETTER = /^[A-Za-z]:/;

export function safeLeaf(name) {
  if (typeof name !== 'string' || name.length === 0 ||
      name === '.' || name === '..' ||
      name.includes('/') || name.includes('\\') ||
      name.includes('\0') || DRIVE_LETTER.test(name)) {
    throw new HdCompileError('paths', 'HD_PATH_TRAVERSAL', { name: String(name) });
  }
  return name;
}

export function resolveWithin(root, ...segments) {
  const base = path.resolve(root);
  const candidate = path.join(base, ...segments.map(safeLeaf));

  let realRoot;
  try { realRoot = fs.realpathSync(base); } catch { realRoot = base; }

  // Follow the longest existing ancestor through any symlink/junction.
  let probe = candidate;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  let realProbe;
  try { realProbe = fs.realpathSync(probe); } catch { realProbe = probe; }

  const rel = path.relative(realRoot, realProbe);
  if (rel !== '' && (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))) {
    throw new HdCompileError('paths', 'HD_PATH_TRAVERSAL', { root: base, candidate });
  }
  return candidate;
}

export function dataRoot() { return DATA_DIR; }
export function hdCoursesRoot() { return path.join(DATA_DIR, 'hd-courses'); }
export function hdBuildCacheRoot() { return path.join(DATA_DIR, 'hd-build-cache'); }
