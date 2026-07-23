#!/usr/bin/env node
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  ROOT,
  VisualCaptureError,
  buildCourseInputManifest,
  buildSharedRootManifest,
  parseCliArgs,
  resolveSuite,
  validateJobPaths,
  validateSuite,
} from './config.mjs';

const execFileAsync = promisify(childProcess.execFile);

function atomicJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

export async function cleanupRecordedChild(pid, {
  platform = process.platform,
  execFile = execFileAsync,
  kill = process.kill,
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new VisualCaptureError('CLEANUP_FAILED', `Refusing invalid child PID: ${pid}`);
  }
  try {
    if (platform === 'win32') {
      await execFile('taskkill', ['/PID', String(pid), '/T', '/F']);
    } else {
      // Electron is spawned detached on POSIX, so the negative direct PID names
      // only its process group. No process-name scan is ever used.
      kill(-pid, 'SIGTERM');
    }
  } catch (cause) {
    if (cause?.code !== 'ESRCH' && cause?.code !== 128) {
      throw new VisualCaptureError('CLEANUP_FAILED', `Could not stop child PID ${pid}`, {
        stage: 'cleanup',
        details: { pid },
        cause,
      });
    }
  }
}

export function runCourseChild(job, {
  electronPath,
  runnerPath,
  spawnImpl = childProcess.spawn,
  env = process.env,
  timeoutMs,
  cleanup = cleanupRecordedChild,
  stderr = process.stderr,
} = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawnImpl(electronPath, [runnerPath, '--job', job.jobFile], {
      cwd: ROOT,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    let settled = false;
    let timer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    // stdout is deliberately treated as human noise, never as protocol.
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (chunk) => stderr.write(chunk));
    child.once('error', (cause) => finish(() => reject(new VisualCaptureError('CHILD_START_FAILED', 'Electron child failed to start', {
      stage: 'child', cause,
    }))));
    child.once('close', (code, signal) => finish(() => {
      if (!fs.existsSync(job.resultFile)) {
        reject(new VisualCaptureError('CHILD_RESULT_MISSING', `Child exited ${code ?? signal} without a result file`, {
          stage: 'child', details: { pid: child.pid, code, signal, resultFile: job.resultFile },
        }));
        return;
      }
      let result;
      try {
        result = JSON.parse(fs.readFileSync(job.resultFile, 'utf8'));
      } catch (cause) {
        reject(new VisualCaptureError('CHILD_RESULT_INVALID', 'Child result file is malformed', {
          stage: 'child', details: { resultFile: job.resultFile }, cause,
        }));
        return;
      }
      if (result?.ok && job.course) {
        const expectedFrames = new Set(job.course.frames.map((frame) => frame.id));
        const actualFrames = Array.isArray(result.frames) ? result.frames : [];
        const actualIds = new Set(actualFrames.map((frame) => frame?.id));
        const resultValid = result.course === job.course.id &&
          actualFrames.length === expectedFrames.size &&
          actualFrames.every((frame) => expectedFrames.has(frame?.id) &&
            typeof frame?.file === 'string' &&
            path.basename(frame.file) === frame.file &&
            fs.existsSync(path.join(job.courseOutputDir, frame.file)) &&
            fs.statSync(path.join(job.courseOutputDir, frame.file)).size > 0) &&
          actualIds.size === expectedFrames.size;
        if (!resultValid) {
          reject(new VisualCaptureError('CHILD_RESULT_INVALID', 'Child result does not match the requested course/frame contract', {
            stage: 'child',
            details: {
              expectedCourse: job.course.id,
              actualCourse: result.course,
              expectedFrames: [...expectedFrames],
              actualFrames: actualFrames.map((frame) => frame?.id),
            },
          }));
          return;
        }
      }
      if (code !== 0 || !result?.ok) {
        reject(new VisualCaptureError(result?.code || 'CHILD_FAILED', result?.message || `Child exited with code ${code}`, {
          stage: result?.stage || 'child', details: { pid: child.pid, code, signal, result },
        }));
        return;
      }
      resolve(result);
    }));
    timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      try {
        await cleanup(child.pid);
      } catch (cleanupError) {
        reject(cleanupError);
        return;
      }
      reject(new VisualCaptureError('CHILD_TIMEOUT', `Course child exceeded ${timeoutMs} ms`, {
        stage: 'child', details: { pid: child.pid, timeoutMs },
      }));
    }, timeoutMs);
  });
}

async function gitState({ cwd = ROOT } = {}) {
  try {
    const [{ stdout: sha }, { stdout: status }] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd }),
      execFileAsync('git', ['status', '--porcelain'], { cwd }),
    ]);
    return { sha: sha.trim(), dirty: Boolean(status.trim()) };
  } catch (cause) {
    throw new VisualCaptureError('GIT_STATE_UNAVAILABLE', 'Cannot determine Git revision/dirty state', { cause });
  }
}

function runId(suiteId) {
  return `${suiteId}-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}`;
}

export async function runCapture(options, {
  root = ROOT,
  electronPath = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
  runnerPath = path.join(root, 'tools', 'visual-capture', 'electron-runner.cjs'),
  spawnCourse = runCourseChild,
  gitStateImpl = gitState,
  runIdFactory = runId,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (options.mode === 'perf' || options.mode === 'compare') {
    throw new VisualCaptureError('MODE_NOT_IMPLEMENTED', `${options.mode} is parsed but is completed by a later SP-00 task`);
  }
  const resolvedSuite = resolveSuite(options.suite, { root });
  const suite = validateSuite(JSON.parse(fs.readFileSync(resolvedSuite.path, 'utf8')));
  const dataDir = path.resolve(root, options.dataDir || (options.mode === 'smoke'
    ? path.join('test', 'fixtures', 'visual-capture-data')
    : 'data'));
  const outputRoot = path.resolve(root, options.output || path.join('.shots', 'visual'));
  const git = await gitStateImpl({ cwd: root });
  if (options.requireClean && git.dirty) {
    throw new VisualCaptureError('WORKTREE_DIRTY', 'Release evidence requires a clean worktree', {
      stage: 'preflight',
      recovery: 'Commit or stash changes, then rerun with --require-clean.',
      details: git,
    });
  }
  const inputs = suite.courses.map((course) => buildCourseInputManifest(dataDir, course));
  fs.mkdirSync(outputRoot, { recursive: true });
  const id = runIdFactory(suite.id);
  const finalDir = path.join(outputRoot, id);
  const stagingRoot = path.join(outputRoot, `${id}.staging-${process.pid}`);
  fs.mkdirSync(stagingRoot);
  const results = [];
  try {
    for (const [index, course] of suite.courses.entries()) {
      stderr.write(`[visual] ${index + 1}/${suite.courses.length} ${course.id}\n`);
      const courseOutputDir = path.join(stagingRoot, course.id);
      const resultFile = path.join(courseOutputDir, 'result.json');
      const jobFile = path.join(stagingRoot, `${course.id}.job.json`);
      fs.mkdirSync(courseOutputDir);
      const job = validateJobPaths({
        version: 1,
        suiteId: suite.id,
        stagingRoot,
        courseOutputDir,
        resultFile,
        jobFile,
        root,
        dataDir,
        server: { port: options.port, ocPort: 0 },
        showWindow: options.showWindow,
        capture: suite.capture,
        course,
      });
      atomicJson(jobFile, job);
      results.push(await spawnCourse(job, { electronPath, runnerPath, timeoutMs: options.courseTimeoutMs, stderr }));
      // Jobs contain absolute process-local paths. They are control files, not
      // shareable evidence, so remove them before publishing a successful run.
      fs.unlinkSync(jobFile);
    }
    const manifest = {
      ok: true,
      schemaVersion: 1,
      suite: {
        id: suite.id,
        sourceKind: resolvedSuite.kind,
        basename: path.basename(resolvedSuite.path),
        sha256: crypto.createHash('sha256').update(fs.readFileSync(resolvedSuite.path)).digest('hex'),
      },
      git,
      evidence: git.dirty ? 'iteration-dirty' : 'clean',
      dataRoot: buildSharedRootManifest(dataDir, { sourceKind: options.dataDir ? 'explicit' : 'default' }),
      inputs,
      results,
    };
    atomicJson(path.join(stagingRoot, 'manifest.json'), manifest);
    fs.renameSync(stagingRoot, finalDir);
    const summary = { ok: true, output: finalDir, suite: suite.id, dirty: git.dirty };
    stdout.write(`${JSON.stringify(summary)}\n`);
    return summary;
  } catch (error) {
    const record = error instanceof VisualCaptureError
      ? error.toJSON()
      : new VisualCaptureError('CAPTURE_FAILED', error?.message || String(error), { cause: error }).toJSON();
    atomicJson(path.join(stagingRoot, 'failure.json'), { ...record, git, suite: suite.id });
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseCliArgs(argv);
    await runCapture(options);
  } catch (error) {
    const record = error instanceof VisualCaptureError
      ? error.toJSON()
      : new VisualCaptureError('CAPTURE_FAILED', error?.message || String(error), { cause: error }).toJSON();
    process.stderr.write(`${JSON.stringify(record, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
