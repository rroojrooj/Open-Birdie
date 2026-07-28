'use strict';

function buildPerformanceRequest(job, route = []) {
  const performance = job?.mode === 'perf';
  return {
    durationMs: performance ? 60000 : 2000,
    claim: performance ? 'performance' : 'diagnostic-only',
    route,
  };
}

module.exports = { buildPerformanceRequest };
