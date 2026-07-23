const TRACKER_KEY = Symbol.for('open-birdie.visual-capture-loader-tracker');

const clone = (value) => JSON.parse(JSON.stringify(value));

export class CaptureReadinessTimeout extends Error {
  constructor(timeoutMs, lastSnapshot, outstanding) {
    super(`Visual capture readiness timed out after ${timeoutMs}ms: ${outstanding.join(', ') || 'unknown'}`);
    this.name = 'CaptureReadinessTimeout';
    this.code = 'VISUAL_CAPTURE_TIMEOUT';
    this.timeoutMs = timeoutMs;
    this.lastSnapshot = clone(lastSnapshot);
    this.outstanding = [...outstanding];
  }
}

export function createLoaderTracker(now = () => Date.now()) {
  const active = new Map();
  const failures = [];
  let started = 0;
  let completed = 0;
  let lastEventAt = null;

  return {
    begin(url) {
      const key = String(url);
      active.set(key, (active.get(key) || 0) + 1);
      started += 1;
      lastEventAt = now();
    },
    end(url) {
      const key = String(url);
      const count = active.get(key) || 0;
      if (count <= 1) active.delete(key);
      else active.set(key, count - 1);
      completed += 1;
      lastEventAt = now();
    },
    error(url, error) {
      failures.push({ url: String(url), message: error?.message || String(error || 'load failed') });
      lastEventAt = now();
    },
    status() {
      return {
        active: [...active.entries()].flatMap(([url, count]) => Array(count).fill(url)),
        started,
        completed,
        failures: clone(failures),
        lastEventAt,
      };
    },
  };
}

// LoadingManager invokes itemError before itemEnd. Tracking those primitive
// transitions keeps failures observable while the matching itemEnd balances the
// active count. Calling the originals preserves all existing manager callbacks.
export function installLoadingTracker(manager, { now } = {}) {
  if (manager[TRACKER_KEY]) return manager[TRACKER_KEY];
  const tracker = createLoaderTracker(now);
  const original = {
    itemStart: manager.itemStart.bind(manager),
    itemEnd: manager.itemEnd.bind(manager),
    itemError: manager.itemError.bind(manager),
  };
  manager.itemStart = (url) => {
    tracker.begin(url);
    return original.itemStart(url);
  };
  manager.itemEnd = (url) => {
    tracker.end(url);
    return original.itemEnd(url);
  };
  manager.itemError = (url) => {
    tracker.error(url);
    return original.itemError(url);
  };
  Object.defineProperty(manager, TRACKER_KEY, { value: tracker });
  return tracker;
}

export function outstandingSubsystems(snapshot) {
  const outstanding = [];
  if (!snapshot?.course?.name || !Number.isInteger(snapshot?.course?.revision)) outstanding.push('course');
  if (!snapshot?.runtimeReady) outstanding.push('runtime');
  if (!['ready', 'fallback'].includes(snapshot?.environment?.state)) outstanding.push('environment');
  if ((snapshot?.loader?.active || []).length) outstanding.push('loader');
  const hd = snapshot?.hd || {};
  const advertised = Number(hd.advertised || 0);
  const accounted = Number(hd.loaded || 0) + Number(hd.failures?.length || 0);
  if (accounted < advertised) outstanding.push('hd-assets');
  if (advertised > 0 && !hd.ack?.ok) outstanding.push('hd-ack');
  if (snapshot?.postfx !== 'effect-composer') outstanding.push('postfx');
  return outstanding;
}

export async function waitForCaptureReady({
  status,
  nextFrame,
  now = () => Date.now(),
  timeoutMs = 15_000,
  requiredSettledFrames = 3,
} = {}) {
  if (typeof status !== 'function' || typeof nextFrame !== 'function') {
    throw new TypeError('status and nextFrame functions are required');
  }
  const startedAt = now();
  let settledFrames = 0;
  let lastSnapshot = null;
  let outstanding = ['not-polled'];
  for (;;) {
    lastSnapshot = await status();
    outstanding = outstandingSubsystems(lastSnapshot);
    settledFrames = outstanding.length ? 0 : settledFrames + 1;
    if (settledFrames >= requiredSettledFrames) {
      return { snapshot: clone(lastSnapshot), settledFrames, elapsedMs: now() - startedAt };
    }
    if (now() - startedAt >= timeoutMs) {
      throw new CaptureReadinessTimeout(timeoutMs, lastSnapshot, outstanding);
    }
    await nextFrame();
  }
}
