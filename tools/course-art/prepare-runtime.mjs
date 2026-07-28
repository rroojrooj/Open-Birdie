import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import courseArtAssets from '../../lib/course-art-assets.js';

const { stageSourceCourseArt } = courseArtAssets;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

function parse(argv) {
  const options = {
    sourceRoot: path.join(REPO, 'courses', 'curated'),
    outputRoot: path.join(REPO, 'build', 'course-art'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--source' && value) {
      options.sourceRoot = path.resolve(value);
      index += 1;
    } else if (argv[index] === '--output' && value) {
      options.outputRoot = path.resolve(value);
      index += 1;
    } else {
      throw new Error('Usage: prepare-runtime.mjs [--source <dir>] [--output <dir>]');
    }
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const result = await stageSourceCourseArt(parse(argv));
  process.stdout.write(`Staged ${result.packCount} course-art pack(s).\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.code || 'COURSE_ART_STAGE_FAILED'}: ${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
