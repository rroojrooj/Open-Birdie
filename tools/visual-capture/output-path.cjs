'use strict';

const fs = require('node:fs');
const path = require('node:path');

function canonicalizeWithMissing(input, {
  existsSync = fs.existsSync,
  realpathSync = fs.realpathSync.native,
} = {}) {
  let cursor = path.resolve(input);
  const missing = [];
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`OUTPUT_PATH_UNRESOLVABLE ${input}`);
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.resolve(realpathSync(cursor), ...missing);
}

function resolveTask0Output(ownedRoot, requested, options) {
  const root = canonicalizeWithMissing(ownedRoot, options);
  const candidate = canonicalizeWithMissing(requested, options);
  if (candidate === root) throw new Error(`OUTPUT_PATH_ROOT ${candidate}`);
  if (!candidate.startsWith(root + path.sep)) {
    throw new Error(`OUTPUT_PATH_ESCAPE ${candidate}`);
  }
  return candidate;
}

module.exports = { canonicalizeWithMissing, resolveTask0Output };
