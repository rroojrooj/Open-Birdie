import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function failureFiles(root) {
  if (!fs.existsSync(root)) return [];
  const matches = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name === 'failure.json') matches.push(absolute);
    }
  };
  visit(root);
  return matches.sort((left, right) => left.localeCompare(right));
}

export function inspectCapabilityOnlyFailure(outputRoot) {
  const files = failureFiles(outputRoot);
  const failures = files.map((file) => {
    try {
      return { file, record: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (error) {
      return { file, record: null, error: error.message };
    }
  });
  const roots = failures.filter(({ file }) => {
    const relativeParts = path.relative(outputRoot, file).split(path.sep);
    return relativeParts.length === 2 &&
      relativeParts[0].includes('.staging-') &&
      relativeParts[1] === 'failure.json';
  });
  const codes = [...new Set(failures.map(({ record }) => record?.code || '<invalid>'))].sort();
  const rootFailure = roots.length === 1 ? roots[0].record : null;
  return {
    skip: failures.length > 0 &&
      roots.length === 1 &&
      rootFailure?.code === 'CAPABILITY_NON_QUALIFYING' &&
      codes.length === 1 &&
      codes[0] === 'CAPABILITY_NON_QUALIFYING',
    rootFailure,
    codes,
    failures,
  };
}

export function findOwnedRunnerProcesses(outputRoot, {
  platform = process.platform,
  spawnSync = childProcess.spawnSync,
} = {}) {
  if (platform !== 'win32') return [];
  const escaped = path.resolve(outputRoot).replaceAll("'", "''");
  const script = [
    `$needle = '${escaped}'`,
    "$matches = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('electron-runner.cjs') -and $_.CommandLine.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object ProcessId, CommandLine)",
    '$matches | ConvertTo-Json -Compress',
  ].join('; ');
  const query = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout: 15000, windowsHide: true },
  );
  if (query.error || query.status !== 0) {
    throw new Error(`Could not inspect owned Electron runners: ${query.error?.message || query.stderr}`);
  }
  const text = query.stdout.trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter(({ ProcessId }) => Number.isInteger(ProcessId) && ProcessId > 0)
    .sort((left, right) => left.ProcessId - right.ProcessId);
}

export function cleanupOwnedRunnerProcesses(outputRoot, {
  platform = process.platform,
  findProcesses = (root) => findOwnedRunnerProcesses(root, { platform }),
  taskkill = (file, args) => childProcess.spawnSync(
    file,
    args,
    { encoding: 'utf8', timeout: 15000, windowsHide: true },
  ),
} = {}) {
  const owned = findProcesses(outputRoot);
  if (platform === 'win32') {
    for (const { ProcessId: pid } of owned) {
      if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Refusing invalid owned runner PID: ${pid}`);
      taskkill('taskkill', ['/PID', String(pid), '/T', '/F']);
    }
  }
  return findProcesses(outputRoot);
}
