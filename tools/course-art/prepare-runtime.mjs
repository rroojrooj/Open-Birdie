import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import courseArtAssets from '../../lib/course-art-assets.js';

const { stageSourceCourseArt } = courseArtAssets;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

function parse(argv) {
  const options = {
    check: false,
    sourceRoot: path.join(REPO, 'courses', 'curated'),
    outputRoot: path.join(REPO, 'build', 'course-art'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--check') {
      options.check = true;
    } else if (argv[index] === '--source' && value) {
      options.sourceRoot = path.resolve(value);
      index += 1;
    } else if (argv[index] === '--output' && value) {
      options.outputRoot = path.resolve(value);
      index += 1;
    } else {
      throw new Error('Usage: prepare-runtime.mjs [--check] [--source <dir>] [--output <dir>]');
    }
  }
  return options;
}

function runtimeDigest(root) {
  const records = [];
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else if (entry.isFile()) {
        records.push([
          relative,
          crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
        ]);
      } else {
        throw new Error('COURSE_ART_CHECK_UNSAFE_ENTRY');
      }
    }
  }
  walk(root);
  return crypto.createHash('sha256')
    .update(Buffer.from(JSON.stringify(records)))
    .digest('hex');
}

export async function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (!options.check) {
    const result = await stageSourceCourseArt(options);
    process.stdout.write(`Staged ${result.packCount} course-art pack(s).\n`);
    return result;
  }

  const firstParent = fs.mkdtempSync(path.join(os.tmpdir(), 'open-birdie-course-art-check-a-'));
  const secondParent = fs.mkdtempSync(path.join(os.tmpdir(), 'open-birdie-course-art-check-b-'));
  try {
    const firstRoot = path.join(firstParent, 'course-art');
    const secondRoot = path.join(secondParent, 'course-art');
    const first = await stageSourceCourseArt({
      sourceRoot: options.sourceRoot,
      outputRoot: firstRoot,
    });
    const second = await stageSourceCourseArt({
      sourceRoot: options.sourceRoot,
      outputRoot: secondRoot,
    });
    if (runtimeDigest(firstRoot) !== runtimeDigest(secondRoot)) {
      throw new Error('COURSE_ART_STAGE_NONDETERMINISTIC');
    }
    process.stdout.write(`Checked ${first.packCount} deterministic course-art pack(s).\n`);
    return first;
  } finally {
    fs.rmSync(firstParent, { recursive: true, force: true });
    fs.rmSync(secondParent, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.code || 'COURSE_ART_STAGE_FAILED'}: ${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
