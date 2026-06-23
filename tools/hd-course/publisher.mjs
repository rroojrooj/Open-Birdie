// Atomic, immutable bundle publication.
//
// Layout: courseDir/{ active.json, bundles/<bundleId>/... }. A validated staged
// bundle is moved into bundles/<manifest-sha256> (immutable, hash-named), then
// the tiny active.json pointer is swapped atomically. A failed or interrupted
// publish never destroys the last known-good bundle: only active.json moves, and
// a populated live bundle directory is never overwritten.

import fs from 'node:fs';
import path from 'node:path';
import { HdCompileError } from './errors.mjs';
import { safeLeaf } from './paths.mjs';

const HEX64 = /^[a-f0-9]{64}$/;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function readActive(courseDir) {
  const active = path.join(courseDir, 'active.json');
  if (!fs.existsSync(active)) return null;
  try { return JSON.parse(fs.readFileSync(active, 'utf8')); }
  catch { return null; }
}

// Recover from a crash mid-activation. The rename is atomic, so active.json is
// never partial — a leftover active.json.tmp is either stale (active exists) or a
// complete pointer that lost its rename (active missing). Promote only the latter.
export function recoverActivePointer(courseDir) {
  const active = path.join(courseDir, 'active.json');
  const tmp = `${active}.tmp`;
  if (!fs.existsSync(tmp)) return;
  if (fs.existsSync(active)) { fs.rmSync(tmp, { force: true }); return; }
  try {
    const ptr = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    if (ptr && typeof ptr.bundleId === 'string' && HEX64.test(ptr.bundleId) &&
        fs.existsSync(path.join(courseDir, 'bundles', ptr.bundleId))) {
      fs.renameSync(tmp, active);
      return;
    }
  } catch { /* fall through to discard */ }
  fs.rmSync(tmp, { force: true });
}

async function moveBundleDir(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      // Staging landed on another volume — copy then remove the source.
      fs.cpSync(src, dest, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true });
    } else {
      throw new HdCompileError('publish', 'HD_PUBLISH_MOVE', { dest }, e);
    }
  }
}

// Replace dest with tmp. POSIX rename is atomic-replace; Windows can transiently
// fail with EPERM/EBUSY if a reader holds the handle, so retry, then fall back to
// a (non-atomic) copy as a last resort.
async function atomicReplace(tmp, dest, retries = 5) {
  for (let attempt = 0; ; attempt += 1) {
    try { fs.renameSync(tmp, dest); return; }
    catch (e) {
      const transient = ['EPERM', 'EACCES', 'EBUSY', 'EEXIST'].includes(e.code);
      if (transient && attempt < retries) { await delay(10 * (attempt + 1)); continue; }
      try { fs.copyFileSync(tmp, dest); fs.rmSync(tmp, { force: true }); return; }
      catch (e2) { throw new HdCompileError('publish', 'HD_PUBLISH_ACTIVATE', { dest }, e2); }
    }
  }
}

function fsyncDirBestEffort(dir) {
  let fd;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); }
  catch { /* directory fsync is unsupported on some platforms (Windows) */ }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } } }
}

async function writeActivePointer(courseDir, pointer) {
  const active = path.join(courseDir, 'active.json');
  const tmp = `${active}.tmp`;
  const data = Buffer.from(JSON.stringify(pointer, null, 2) + '\n', 'utf8');
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  await atomicReplace(tmp, active);
  fsyncDirBestEffort(courseDir);
}

export async function publishBundle({ stagedDir, courseDir, validate }) {
  const result = await validate(stagedDir);
  if (!result || result.status !== 'valid') {
    throw new HdCompileError('publish', 'HD_PUBLISH_INVALID', { status: result && result.status, code: result && result.code });
  }
  const bundleId = result.descriptor && result.descriptor.manifestSha256;
  if (typeof bundleId !== 'string' || !HEX64.test(bundleId)) {
    throw new HdCompileError('publish', 'HD_PUBLISH_BADID', { bundleId: String(bundleId) });
  }

  const bundlesDir = path.join(courseDir, 'bundles');
  fs.mkdirSync(bundlesDir, { recursive: true });
  const targetDir = path.join(bundlesDir, safeLeaf(bundleId));

  if (fs.existsSync(targetDir)) {
    // Immutable + hash-named: already published. Discard the redundant staging.
    fs.rmSync(stagedDir, { recursive: true, force: true });
  } else {
    await moveBundleDir(stagedDir, targetDir);
  }

  await writeActivePointer(courseDir, {
    bundleId,
    bundle: `bundles/${bundleId}`,
    hole: result.descriptor.hole ?? null,
  });
  return { bundleId, descriptor: result.descriptor };
}
