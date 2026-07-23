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

const sortedUnique = (values) => [...new Set((values || []).filter((value) => typeof value === 'string'))].sort();

export function buildHdAckEvidence(requestIds, response) {
  const ackRequestIds = sortedUnique(requestIds);
  if (!response?.ok) return { ackRequestIds, acknowledgedIds: [] };
  const responseIds = Array.isArray(response.acknowledgedIds)
    ? response.acknowledgedIds
    : Array.isArray(response.bundleIds)
      ? response.bundleIds
      : ackRequestIds;
  return { ackRequestIds, acknowledgedIds: sortedUnique(responseIds) };
}

export function validateHdPolicy(hd = {}, policy = 'optional') {
  if (!['required', 'optional', 'forbidden'].includes(policy)) {
    return { ok: false, policy, violations: ['HD_POLICY_UNKNOWN'] };
  }
  const advertisedIds = sortedUnique(hd.advertisedIds);
  const loadedIds = sortedUnique(hd.loadedIds);
  const ackRequestIds = sortedUnique(hd.ackRequestIds);
  const acknowledgedIds = sortedUnique(hd.acknowledgedIds);
  const failures = Array.isArray(hd.failures) ? hd.failures : [];
  const violations = [];
  if (policy === 'required') {
    if (!advertisedIds.length) violations.push('HD_REQUIRED_EMPTY');
    if (failures.length) violations.push('HD_FAILURES');
    const loadedMismatch = advertisedIds.length !== loadedIds.length ||
      advertisedIds.some((id, index) => id !== loadedIds[index]);
    const acknowledgedMismatch = advertisedIds.length !== acknowledgedIds.length ||
      advertisedIds.some((id, index) => id !== acknowledgedIds[index]);
    if (loadedMismatch || acknowledgedMismatch) {
      violations.push('HD_ID_SET_MISMATCH');
    }
    if (!hd.ack?.ok) violations.push('HD_ACK_REQUIRED');
  } else if (policy === 'forbidden') {
    if (advertisedIds.length) violations.push('HD_FORBIDDEN_ADVERTISED');
    if (loadedIds.length) violations.push('HD_FORBIDDEN_LOADED');
    if (ackRequestIds.length) violations.push('HD_FORBIDDEN_ACK_REQUEST');
    if (acknowledgedIds.length) violations.push('HD_FORBIDDEN_ACKNOWLEDGED');
    if (failures.length) violations.push('HD_FORBIDDEN_FAILURES');
    if (hd.ack != null) violations.push('HD_FORBIDDEN_ACK');
  }
  return {
    ok: violations.length === 0,
    policy,
    advertisedIds,
    loadedIds,
    ackRequestIds,
    acknowledgedIds,
    failures: clone(failures),
    ack: hd.ack == null ? null : clone(hd.ack),
    violations,
  };
}

export function outstandingSubsystems(snapshot, { hdPolicy = 'optional' } = {}) {
  const outstanding = [];
  if (!snapshot?.course?.name || !Number.isInteger(snapshot?.course?.revision)) outstanding.push('course');
  if (!snapshot?.runtimeReady) outstanding.push('runtime');
  if (!['ready', 'fallback'].includes(snapshot?.environment?.state)) outstanding.push('environment');
  if ((snapshot?.loader?.active || []).length) outstanding.push('loader');
  const hd = snapshot?.hd || {};
  const advertised = (hd.advertisedIds || []).length;
  const accounted = (hd.loadedIds || []).length + Number(hd.failures?.length || 0);
  if (accounted < advertised) outstanding.push('hd-assets');
  for (const violation of validateHdPolicy(hd, hdPolicy).violations) {
    outstanding.push(`hd-policy:${violation}`);
  }
  if (snapshot?.postfx !== 'effect-composer') outstanding.push('postfx');
  return outstanding;
}

export async function waitForCaptureReady({
  status,
  nextFrame,
  now = () => Date.now(),
  timeoutMs = 15_000,
  requiredSettledFrames = 3,
  hdPolicy = 'optional',
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
    outstanding = outstandingSubsystems(lastSnapshot, { hdPolicy });
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
