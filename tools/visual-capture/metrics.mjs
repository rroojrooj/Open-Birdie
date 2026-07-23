import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { VisualCaptureError } from './config.mjs';

const rounded = (value) => Number(value.toFixed(3));

function percentile(sorted, fraction) {
  if (!sorted.length) return NaN;
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

export function summarizeTimings(intervals, { warmupSamples = 0 } = {}) {
  const samples = intervals.slice(warmupSamples).filter(Number.isFinite);
  if (!samples.length || samples.some((value) => value <= 0)) {
    throw new VisualCaptureError('PERF_SAMPLE_INVALID', 'Timing sample contains no valid positive intervals');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const averageMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const p95Ms = percentile(sorted, 0.95);
  const p99Ms = percentile(sorted, 0.99);
  return {
    samples: samples.length,
    averageMs: rounded(averageMs),
    medianMs: rounded(medianMs),
    p95Ms: rounded(p95Ms),
    worstMs: rounded(sorted.at(-1)),
    averageFps: rounded(1000 / averageMs),
    onePercentLowFps: rounded(1000 / p99Ms),
  };
}

export function inspectNonblankPng(buffer, { expectedWidth, expectedHeight } = {}) {
  let png;
  try {
    png = PNG.sync.read(buffer);
  } catch (cause) {
    throw new VisualCaptureError('IMAGE_INVALID', 'PNG cannot be decoded', { stage: 'image', cause });
  }
  if ((expectedWidth && png.width !== expectedWidth) || (expectedHeight && png.height !== expectedHeight)) {
    throw new VisualCaptureError('IMAGE_INVALID', `Expected ${expectedWidth}x${expectedHeight}, got ${png.width}x${png.height}`, {
      stage: 'image',
    });
  }
  let min = 255;
  let max = 0;
  let opaquePixels = 0;
  const colors = new Set();
  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    const alpha = png.data[index + 3];
    if (alpha === 0) continue;
    opaquePixels += 1;
    const light = Math.round((red + green + blue) / 3);
    min = Math.min(min, light);
    max = Math.max(max, light);
    if (colors.size < 2) colors.add(`${red},${green},${blue},${alpha}`);
  }
  if (!opaquePixels || colors.size < 2 || max - min < 8) {
    throw new VisualCaptureError('IMAGE_INVALID', `Placeholder image: opaque=${opaquePixels}, colors=${colors.size}, luminanceRange=${Math.max(0, max - min)}`, {
      stage: 'image',
      details: { opaquePixels, distinctColorFloor: colors.size, luminanceRange: Math.max(0, max - min) },
    });
  }
  return {
    width: png.width,
    height: png.height,
    luminanceRange: max - min,
    opaquePixels,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}
