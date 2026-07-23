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
