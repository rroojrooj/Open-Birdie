import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { VisualCaptureError } from './config.mjs';

const rounded = (value) => Number(value.toFixed(3));
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software(?:\s+only)?(?:\s+rasterizer)?|microsoft basic render/i;

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

export function classifyRendererCapability(input) {
  const reasons = [];
  const rendererIdentity = [
    input.vendor,
    input.renderer,
    input.unmaskedVendor,
    input.unmaskedRenderer,
  ].filter(Boolean).join(' | ');
  if (SOFTWARE_RENDERER.test(rendererIdentity)) {
    reasons.push({ code: 'SOFTWARE_RENDERER', detail: rendererIdentity });
  }
  const compositing = input.gpuFeatureStatus?.gpu_compositing;
  if (compositing !== 'enabled') {
    reasons.push({ code: 'GPU_COMPOSITING_DISABLED', detail: compositing ?? 'missing' });
  }
  for (const feature of ['webgl', 'webgl2']) {
    const status = input.gpuFeatureStatus?.[feature];
    if (typeof status === 'string' && /software|unavailable|disabled/i.test(status)) {
      reasons.push({ code: 'WEBGL_GPU_DISABLED', detail: { feature, status } });
    }
  }
  if (input.devicePixelRatio !== 1) {
    reasons.push({ code: 'DPR_MISMATCH', detail: input.devicePixelRatio });
  }
  const expected = input.expectedSize || {};
  const inner = input.innerSize || {};
  if (inner.width !== expected.width || inner.height !== expected.height) {
    reasons.push({ code: 'CONTENT_SIZE_MISMATCH', detail: { expected, actual: inner } });
  }
  const drawing = input.drawingBufferSize || {};
  if (drawing.width !== expected.width || drawing.height !== expected.height) {
    reasons.push({ code: 'DRAWING_BUFFER_SIZE_MISMATCH', detail: { expected, actual: drawing } });
  }
  if (input.visibilityState !== 'visible') {
    reasons.push({ code: 'PAGE_NOT_VISIBLE', detail: input.visibilityState ?? 'missing' });
  }
  return { qualifying: reasons.length === 0, reasons };
}

export function normalizeGpuTimerSamples(input = {}) {
  if (!input.supported) {
    return {
      supported: false,
      reason: input.reason || 'extension-unavailable',
      validSamples: [],
      validSampleCount: 0,
      discardedInvalid: 0,
      discardedDisjoint: 0,
    };
  }
  const validSamples = [];
  let discardedInvalid = 0;
  let discardedDisjoint = 0;
  for (const sample of input.samples || []) {
    if (sample?.disjoint) {
      discardedDisjoint += 1;
      continue;
    }
    if (!sample?.available || !Number.isFinite(sample.nanoseconds) || sample.nanoseconds <= 0) {
      discardedInvalid += 1;
      continue;
    }
    validSamples.push(rounded(sample.nanoseconds / 1e6));
  }
  const output = {
    supported: true,
    validSamples,
    validSampleCount: validSamples.length,
    discardedInvalid,
    discardedDisjoint,
  };
  if (!validSamples.length) {
    output.reason = discardedDisjoint ? 'all-samples-disjoint-or-invalid' : 'no-valid-samples';
    return output;
  }
  const sorted = [...validSamples].sort((a, b) => a - b);
  output.averageMs = rounded(validSamples.reduce((sum, value) => sum + value, 0) / validSamples.length);
  output.medianMs = sorted.length % 2
    ? sorted[Math.floor(sorted.length / 2)]
    : rounded((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
  output.p95Ms = percentile(sorted, 0.95);
  output.worstMs = sorted.at(-1);
  return output;
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
