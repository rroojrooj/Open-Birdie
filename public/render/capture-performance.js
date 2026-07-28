export function normalizePerformanceRequest({
  durationMs = 2000,
  route = [],
  claim = 'diagnostic-only',
} = {}) {
  const performanceClaim = claim === 'performance';
  const requestedDuration = Number(durationMs) || 2000;
  return {
    sampleDuration: performanceClaim
      ? Math.max(60000, requestedDuration)
      : Math.max(250, requestedDuration),
    performanceClaim,
    routeFrames: Array.isArray(route) ? route : (Array.isArray(route?.frames) ? route.frames : []),
  };
}

export function classifyAnimationCadence({ samples = 0, medianMs, minimumFps = 4 } = {}) {
  const validMinimumFps = Number.isFinite(minimumFps) && minimumFps > 0 ? minimumFps : 4;
  const validMedian = Number.isFinite(medianMs) && medianMs > 0;
  const qualifying = samples > 0 && validMedian && medianMs < 1000 / validMinimumFps;
  return {
    qualifying,
    reason: qualifying
      ? null
      : samples > 0 && validMedian
        ? 'animation-cadence-throttled'
        : 'no-valid-raf-intervals',
    medianMs: validMedian ? medianMs : null,
    minimumFps: validMinimumFps,
  };
}

export function disjointQueryDisposition({ disjoint = false, pendingCount = 0 } = {}) {
  const count = Math.max(0, Number.isInteger(pendingCount) ? pendingCount : 0);
  return {
    discardAll: Boolean(disjoint),
    discardedDisjoint: disjoint ? count : 0,
  };
}
