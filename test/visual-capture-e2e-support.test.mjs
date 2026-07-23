import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  cleanupOwnedRunnerProcesses,
  inspectCapabilityOnlyFailure,
} from './visual-capture-e2e-support.mjs';

function writeFailure(root, relative, code) {
  const file = path.join(root, relative, 'failure.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ok: false, code, message: code }));
  return file;
}

test('capability skip requires the top-level staging failure and no compound failure code', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-e2e-capability-'));
  writeFailure(output, 'run.staging-123', 'CAPABILITY_NON_QUALIFYING');
  writeFailure(output, path.join('run.staging-123', 'course'), 'CAPABILITY_NON_QUALIFYING');
  const capability = inspectCapabilityOnlyFailure(output);
  assert.equal(capability.skip, true);
  assert.equal(capability.rootFailure.code, 'CAPABILITY_NON_QUALIFYING');

  writeFailure(output, path.join('run.staging-123', 'other-course'), 'PAGE_CONSOLE_ERROR');
  const compound = inspectCapabilityOnlyFailure(output);
  assert.equal(compound.skip, false);
  assert.deepEqual(compound.codes, ['CAPABILITY_NON_QUALIFYING', 'PAGE_CONSOLE_ERROR']);
});

test('capability skip rejects missing or non-capability terminal failure', () => {
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-e2e-no-root-'));
  writeFailure(missingRoot, path.join('run.staging-123', 'course'), 'CAPABILITY_NON_QUALIFYING');
  assert.equal(inspectCapabilityOnlyFailure(missingRoot).skip, false);

  const wrongRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-e2e-wrong-root-'));
  writeFailure(wrongRoot, 'run.staging-123', 'CHILD_TIMEOUT');
  writeFailure(wrongRoot, path.join('run.staging-123', 'course'), 'CAPABILITY_NON_QUALIFYING');
  assert.equal(inspectCapabilityOnlyFailure(wrongRoot).skip, false);
});

test('cleanup terminates only discovered owned PID trees with exact Windows taskkill arguments', () => {
  const calls = [];
  const processSnapshots = [
    [{ ProcessId: 4321, CommandLine: 'electron runner exact-output-root' }],
    [],
  ];
  const remaining = cleanupOwnedRunnerProcesses('C:\\exact-output-root', {
    platform: 'win32',
    findProcesses: () => processSnapshots.shift(),
    taskkill: (file, args) => {
      calls.push([file, args]);
      return { status: 0, stderr: '' };
    },
  });
  assert.deepEqual(calls, [['taskkill', ['/PID', '4321', '/T', '/F']]]);
  assert.deepEqual(remaining, []);
});
