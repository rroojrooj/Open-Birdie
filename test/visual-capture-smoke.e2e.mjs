import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

function filesNamed(root, name) {
  if (!fs.existsSync(root)) return [];
  const matches = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name === name) matches.push(absolute);
    }
  };
  visit(root);
  return matches;
}

function ownedRunnerProcesses(outputRoot) {
  if (process.platform !== 'win32') return [];
  const escaped = outputRoot.replaceAll("'", "''");
  const script = [
    `$needle = '${escaped}'`,
    '$matches = @(Get-CimInstance Win32_Process | Where-Object {',
    "  $_.ProcessId -ne $PID -and $_.CommandLine -like '*electron-runner.cjs*' -and $_.CommandLine -like ('*' + $needle + '*')",
    '} | Select-Object ProcessId, CommandLine)',
    '$matches | ConvertTo-Json -Compress',
  ].join('; ');
  const query = childProcess.spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout: 15000, windowsHide: true },
  );
  assert.equal(query.status, 0, query.stderr);
  const text = query.stdout.trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

test('real synthetic visual smoke produces qualifying evidence or a typed capability skip', (t) => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-visual-smoke-e2e-'));
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  assert.equal(fs.existsSync(npmCli), true, `npm CLI not found beside Node: ${npmCli}`);
  const run = childProcess.spawnSync(
    process.execPath,
    [npmCli, 'run', 'visual:smoke', '--', '--output', outputRoot],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 300000,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    },
  );

  assert.equal(run.error, undefined, run.error?.stack);
  assert.notEqual(run.error?.code, 'ETIMEDOUT', 'visual smoke must not hang');
  assert.deepEqual(
    ownedRunnerProcesses(outputRoot),
    [],
    'the CLI must not leave an Electron runner whose exact job belongs to this output root',
  );

  if (run.status !== 0) {
    const failureFiles = filesNamed(outputRoot, 'failure.json');
    assert.ok(failureFiles.length > 0, `failed smoke must preserve failure.json\n${run.stderr}`);
    const failures = failureFiles.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
    const capabilityFailure = failures.find((failure) => failure.code === 'CAPABILITY_NON_QUALIFYING');
    assert.ok(
      capabilityFailure,
      `only a typed renderer capability failure may be skipped\n${run.stderr}`,
    );
    assert.equal(filesNamed(outputRoot, 'manifest.json').length, 0);
    t.skip(`non-qualifying renderer: ${capabilityFailure.message}`);
    return;
  }

  const summaryLine = run.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  const summary = JSON.parse(summaryLine);
  assert.equal(summary.ok, true);
  assert.equal(summary.suite, 'synthetic-smoke');
  assert.ok(path.isAbsolute(summary.output));
  assert.equal(path.dirname(summary.output), outputRoot);

  const manifestFile = path.join(summary.output, 'manifest.json');
  const resultFile = path.join(summary.output, 'synthetic-visual', 'result.json');
  const pngFile = path.join(summary.output, 'synthetic-visual', 'overview.png');
  for (const file of [manifestFile, resultFile, pngFile]) {
    assert.equal(fs.statSync(file).isFile(), true, `missing ${file}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.ok, true);
  assert.equal(manifest.capture.width, 1280);
  assert.equal(manifest.capture.height, 720);
  assert.equal(manifest.capture.deviceScaleFactor, 1);
  assert.deepEqual(manifest.selection, {
    requestedCourse: null,
    courseIds: ['synthetic-visual'],
  });
  assert.deepEqual(manifest.inputs.map(({ courseId }) => courseId), ['synthetic-visual']);
  assert.equal(manifest.results.length, 1);
  const result = manifest.results[0];
  assert.equal(result.course, 'synthetic-visual');
  assert.equal(result.environment.capability.qualifying, true);
  assert.equal(result.environment.page.devicePixelRatio, 1);
  assert.equal(typeof result.environment.webgl.webglVersion, 'string');
  assert.equal(typeof result.performance.cpu.averageMs, 'number');
  assert.equal(typeof result.performance.gpu.supported, 'boolean');
  assert.deepEqual(result.pageConsole.filter(({ level }) => level === 'error'), []);
  assert.deepEqual(result.fatalEvents, []);
  assert.deepEqual(result.frames.map(({ file }) => file), ['overview.png']);
  assert.equal(filesNamed(summary.output, 'failure.json').length, 0);
  assert.equal(filesNamed(summary.output, 'synthetic-visual.job.json').length, 0);
});
