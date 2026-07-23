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
import { inspectNonblankPng } from './metrics.mjs';

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
  force = true,
  commandTimeoutMs = 5000,
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new VisualCaptureError('CLEANUP_FAILED', `Refusing invalid child PID: ${pid}`);
  }
  try {
    if (platform === 'win32') {
      await execFile(
        'taskkill',
        ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
        { timeout: commandTimeoutMs, windowsHide: true },
      );
    } else {
      // Electron is spawned detached on POSIX, so the negative direct PID names
      // only its process group. No process-name scan is ever used.
      kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
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

function withDeadline(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} did not complete within ${timeoutMs} ms`)),
      timeoutMs,
    );
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function childResultInvalid(message, details = {}, cause) {
  return new VisualCaptureError('CHILD_RESULT_INVALID', message, {
    stage: 'child',
    details,
    cause,
  });
}

export function validateChildResult(job, result) {
  if (!result || result.ok !== true || !job?.course || !job?.capture || !job?.courseOutputDir) {
    throw childResultInvalid('Child result is missing its requested job contract', {
      expectedCourse: job?.course?.id,
      actualCourse: result?.course,
    });
  }
  if (result.course !== job.course.id || !Array.isArray(result.frames)) {
    throw childResultInvalid('Child result does not match the requested course/frame contract', {
      expectedCourse: job.course.id,
      actualCourse: result.course,
    });
  }
  const expectedFrames = job.course.frames;
  if (result.frames.length !== expectedFrames.length) {
    throw childResultInvalid('Child result frame count does not match the request', {
      expectedFrames: expectedFrames.map((frame) => frame.id),
      actualFrames: result.frames.map((frame) => frame?.id),
    });
  }
  const actualById = new Map();
  for (const frame of result.frames) {
    if (!frame?.id || actualById.has(frame.id)) {
      throw childResultInvalid('Child result contains a missing or duplicate frame id', {
        actualFrames: result.frames.map((item) => item?.id),
      });
    }
    actualById.set(frame.id, frame);
  }
  const validatedFrames = expectedFrames.map((expected) => {
    const actual = actualById.get(expected.id);
    const expectedTarget = expected.target || (expected.role === 'ui' ? 'page' : 'canvas');
    const expectedFile = `${expected.id}.png`;
    if (!actual ||
        actual.role !== expected.role ||
        actual.target !== expectedTarget ||
        actual.file !== expectedFile ||
        !Number.isFinite(actual.fixedTime) ||
        actual.renderPath !== 'postfx.render') {
      throw childResultInvalid('Child frame metadata does not exactly match the request', {
        frameId: expected.id,
        expected: {
          id: expected.id, role: expected.role, target: expectedTarget, file: expectedFile,
          fixedTime: 'finite', renderPath: 'postfx.render',
        },
        actual: actual && {
          id: actual.id, role: actual.role, target: actual.target, file: actual.file,
          fixedTime: actual.fixedTime, renderPath: actual.renderPath,
        },
      });
    }
    const artifactPath = path.join(job.courseOutputDir, expectedFile);
    let buffer;
    try {
      buffer = fs.readFileSync(artifactPath);
    } catch (cause) {
      throw childResultInvalid('Child frame artifact is missing or unreadable', {
        frameId: expected.id,
        expectedFile,
      }, cause);
    }
    let image;
    try {
      image = inspectNonblankPng(buffer, {
        expectedWidth: job.capture.width,
        expectedHeight: job.capture.height,
      });
    } catch (cause) {
      throw childResultInvalid('Child frame artifact failed PNG validation', {
        frameId: expected.id,
        expectedFile,
        imageError: cause.message,
      }, cause);
    }
    if (typeof actual.sha256 !== 'string' || actual.sha256 !== image.sha256) {
      throw childResultInvalid('Child frame artifact hash does not match the reported sha256', {
        frameId: expected.id,
        expectedFile,
        reportedSha256: actual.sha256,
        actualSha256: image.sha256,
      });
    }
    return { ...actual, ...image };
  });
  const evidenceValid =
    result.environment?.capability?.qualifying === true &&
    result.environment?.page?.devicePixelRatio === 1 &&
    typeof result.environment?.gpuFeatureStatus === 'object' &&
    typeof result.environment?.webgl?.webglVersion === 'string' &&
    result.performance?.renderer?.resetPoint?.name === 'after-warmup-before-timed-sample' &&
    result.performance?.renderer?.aggregation === 'cumulative-across-postfx-passes-during-timed-sample' &&
    typeof result.performance?.cpu === 'object' &&
    typeof result.performance?.gpu?.supported === 'boolean' &&
    Array.isArray(result.pageConsole) &&
    Array.isArray(result.fatalEvents);
  if (!evidenceValid) {
    throw childResultInvalid('Child result is missing required capability, renderer, timing, or event evidence', {
      expectedCourse: job.course.id,
    });
  }
  return { ...result, frames: validatedFrames };
}

export function runCourseChild(job, {
  electronPath,
  runnerPath,
  spawnImpl = childProcess.spawn,
  env = process.env,
  timeoutMs,
  cleanup = cleanupRecordedChild,
  cleanupGraceMs = 1000,
  escalationGraceMs = 1000,
  cleanupRequestTimeoutMs = 5000,
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
    let state = 'running';
    let timer;
    let closeOutcome = null;
    const closeWaiters = new Set();
    const observeClose = (code, signal) => {
      closeOutcome = { code, signal };
      for (const waiter of closeWaiters) waiter(closeOutcome);
      closeWaiters.clear();
    };
    const waitForClose = (graceMs) => {
      if (closeOutcome) return Promise.resolve(closeOutcome);
      return new Promise((resolveClose) => {
        const waiter = (outcome) => {
          clearTimeout(graceTimer);
          resolveClose(outcome);
        };
        const graceTimer = setTimeout(() => {
          closeWaiters.delete(waiter);
          resolveClose(null);
        }, graceMs);
        closeWaiters.add(waiter);
      });
    };
    const finishRunning = (callback) => {
      if (state !== 'running') return;
      state = 'done';
      clearTimeout(timer);
      callback();
    };
    // stdout is deliberately treated as human noise, never as protocol.
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (chunk) => stderr.write(chunk));
    let terminationChildError = null;
    child.once('error', (cause) => {
      if (state === 'terminating') {
        terminationChildError = cause;
        return;
      }
      finishRunning(() => reject(new VisualCaptureError('CHILD_START_FAILED', 'Electron child failed to start', {
        stage: 'child', cause,
      })));
    });
    child.once('close', (code, signal) => {
      observeClose(code, signal);
      finishRunning(() => {
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
        if (result?.ok) {
          try {
            result = validateChildResult(job, result);
          } catch (error) {
            reject(error);
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
      });
    });
    timer = setTimeout(async () => {
      if (state !== 'running') return;
      state = 'terminating';
      const diagnostics = {
        gracefulRequested: true,
        gracefulError: null,
        escalated: false,
        escalationError: null,
        terminationObserved: false,
        close: null,
        childError: null,
      };
      try {
        await withDeadline(
          cleanup(child.pid, { force: false, commandTimeoutMs: cleanupRequestTimeoutMs }),
          cleanupRequestTimeoutMs,
          'graceful cleanup request',
        );
      } catch (error) {
        diagnostics.gracefulError = error?.stack || String(error);
      }
      let observed = await waitForClose(cleanupGraceMs);
      if (!observed) {
        diagnostics.escalated = true;
        try {
          await withDeadline(
            cleanup(child.pid, { force: true, commandTimeoutMs: cleanupRequestTimeoutMs }),
            cleanupRequestTimeoutMs,
            'forced cleanup request',
          );
        } catch (error) {
          diagnostics.escalationError = error?.stack || String(error);
        }
        observed = await waitForClose(escalationGraceMs);
      }
      diagnostics.terminationObserved = Boolean(observed);
      diagnostics.close = observed;
      diagnostics.childError = terminationChildError?.stack || (terminationChildError && String(terminationChildError)) || null;
      state = 'done';
      reject(new VisualCaptureError('CHILD_TIMEOUT', `Course child exceeded ${timeoutMs} ms`, {
        stage: 'child',
        details: { pid: child.pid, timeoutMs, cleanup: diagnostics },
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
        mode: options.mode,
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
