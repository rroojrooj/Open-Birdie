'use strict';
// Validate the currently-active HD bundle for a course.
//   node tools/validate-hd-bundle.js --course bandon-dunes
// Uses the dependency-light runtime validator (no compiler deps).

const fs = require('node:fs');
const path = require('node:path');
const { validateBundleDirectory } = require('../lib/hd-bundle');

function opt(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const course = opt('course');
  if (!course) { console.error('usage: validate-hd-bundle --course <slug>'); process.exit(2); }

  const dataDir = process.env.BIRDIE_DATA_DIR || path.join(__dirname, '..', 'data');
  const courseDir = path.join(dataDir, 'hd-courses', course);
  const activePath = path.join(courseDir, 'active.json');
  if (!fs.existsSync(activePath)) { console.error(`no active bundle for "${course}" (${activePath})`); process.exit(1); }

  const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
  const res = validateBundleDirectory(path.join(courseDir, active.bundle));
  console.log(`bundle ${active.bundleId}: ${res.status}${res.code ? ` (${res.code}: ${res.message})` : ''}`);
  process.exit(res.status === 'valid' ? 0 : 1);
}

main();
