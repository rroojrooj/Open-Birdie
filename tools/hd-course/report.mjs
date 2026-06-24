// Minimal build report: per-stage elapsed time and output byte counts.
// Timing/bytes are diagnostics only — never folded into the bundle manifest,
// so they don't affect reproducibility.

export function makeReport() {
  const stages = [];
  return {
    stages,
    record(name, ms, bytes) { stages.push({ name, ms, bytes: bytes ?? null }); },
    total() { return stages.reduce((a, s) => a + (s.ms || 0), 0); },
    toString() {
      return stages.map((s) => `  ${s.name.padEnd(18)} ${s.ms ?? '?'}ms${s.bytes != null ? ` ${s.bytes}B` : ''}`).join('\n');
    },
  };
}
