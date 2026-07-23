import crypto from 'node:crypto';
import path from 'node:path';
import { PNG } from 'pngjs';
import { VisualCaptureError } from './config.mjs';

const rounded = (value) => Number(value.toFixed(3));
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software(?:\s+only)?(?:\s+rasterizer)?|microsoft basic render/i;
const CHANNELS = ['red', 'green', 'blue', 'alpha'];

export const QUALITY_DIMENSIONS = Object.freeze([
  { name: 'World composition and horizon', weight: 15 },
  { name: 'Terrain and macro relief', weight: 15 },
  { name: 'Playing-surface delineation', weight: 15 },
  { name: 'Material and light response', weight: 15 },
  { name: 'Bunkers and green complexes', weight: 15 },
  { name: 'Vegetation, structures, landmarks', weight: 15 },
  { name: 'Atmosphere and color', weight: 5 },
  { name: 'UI and artifact cleanliness', weight: 5 },
]);

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

function decodeComparisonPng(buffer, side) {
  try {
    return PNG.sync.read(buffer);
  } catch (cause) {
    throw new VisualCaptureError('IMAGE_INVALID', `${side} comparison PNG cannot be decoded`, {
      stage: 'compare',
      cause,
    });
  }
}

/**
 * Compare two decoded PNGs without allowing a tolerance to alter the raw
 * measurements. `threshold` is an inclusive per-channel tolerance in 0..255:
 * a pixel is classified as changed only when one channel delta is greater.
 */
export function comparePngBuffers(beforeBuffer, afterBuffer, { threshold = 2 } = {}) {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new VisualCaptureError('ARGS_INVALID', 'Comparison threshold must be an integer from 0 to 255');
  }
  const before = decodeComparisonPng(beforeBuffer, 'Before');
  const after = decodeComparisonPng(afterBuffer, 'After');
  if (before.width !== after.width || before.height !== after.height) {
    throw new VisualCaptureError('COMPARE_INCOMPATIBLE', 'PNG dimensions do not match', {
      stage: 'compare',
      details: {
        mismatches: [{
          field: 'frame.dimensions',
          before: `${before.width}x${before.height}`,
          after: `${after.width}x${after.height}`,
        }],
      },
    });
  }

  const totalPixels = before.width * before.height;
  const channelTotals = CHANNELS.map(() => ({ squared: 0, maxDelta: 0, changedPixels: 0 }));
  let totalSquared = 0;
  let maxDelta = 0;
  let rawChangedPixels = 0;
  let changedPixels = 0;
  const diff = new PNG({ width: before.width, height: before.height });

  for (let offset = 0; offset < before.data.length; offset += 4) {
    let pixelMax = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(before.data[offset + channel] - after.data[offset + channel]);
      const stats = channelTotals[channel];
      stats.squared += delta * delta;
      stats.maxDelta = Math.max(stats.maxDelta, delta);
      if (delta > 0) stats.changedPixels += 1;
      totalSquared += delta * delta;
      pixelMax = Math.max(pixelMax, delta);
      maxDelta = Math.max(maxDelta, delta);
    }
    if (pixelMax > 0) rawChangedPixels += 1;
    if (pixelMax > threshold) changedPixels += 1;

    if (pixelMax > 0) {
      // Amplify small changes while retaining magnitude in the red channel.
      diff.data[offset] = Math.min(255, Math.max(64, pixelMax * 8));
      diff.data[offset + 1] = 0;
      diff.data[offset + 2] = 0;
    } else {
      const context = Math.round(
        (before.data[offset] + before.data[offset + 1] + before.data[offset + 2]) / 12,
      );
      diff.data[offset] = context;
      diff.data[offset + 1] = context;
      diff.data[offset + 2] = context;
    }
    diff.data[offset + 3] = 255;
  }

  const channels = Object.fromEntries(CHANNELS.map((name, index) => {
    const stats = channelTotals[index];
    return [name, {
      changedPixels: stats.changedPixels,
      rmsError: Number(Math.sqrt(stats.squared / totalPixels).toFixed(6)),
      maxDelta: stats.maxDelta,
    }];
  }));
  return {
    metrics: {
      width: before.width,
      height: before.height,
      totalPixels,
      threshold,
      rawChangedPixels,
      rawChangedPixelRatio: Number((rawChangedPixels / totalPixels).toFixed(8)),
      changedPixels,
      changedPixelRatio: Number((changedPixels / totalPixels).toFixed(8)),
      rmsError: Number(Math.sqrt(totalSquared / (totalPixels * 4)).toFixed(6)),
      maxDelta,
      channels,
      classification: changedPixels === 0 ? 'pixel-pass' : 'pixel-change',
    },
    diffPng: PNG.sync.write(diff),
  };
}

function markdownText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_[\]{}#!|])/g, '\\$1')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

function relativeUrl(fromDirectory, targetFile) {
  const relative = path.relative(fromDirectory, targetFile).replaceAll('\\', '/');
  return relative.split('/').map((segment) => (
    segment === '..' || segment === '.' ? segment : encodeURIComponent(segment)
  )).join('/');
}

export function createComparisonReport({
  comparison,
  artifacts,
  outputDir,
  beforeLabel,
  afterLabel,
}) {
  const lines = [
    '# Open Birdie visual comparison',
    '',
    '> **PIXEL PASS IS NOT A REALISM PASS.** Pixel metrics detect changed output and artifacts; a human must judge realism.',
    '',
    `- Before: ${markdownText(beforeLabel)}`,
    `- After: ${markdownText(afterLabel)}`,
    `- Threshold: ${comparison.threshold} per-channel units (0-255)`,
    `- Pixel result: ${comparison.summary.changedFrames === 0 ? 'PASS' : 'CHANGED'} (${comparison.summary.changedFrames}/${comparison.summary.totalFrames} frames classified changed)`,
    '',
  ];

  for (const [index, frame] of comparison.frames.entries()) {
    const files = artifacts[index];
    const judges = frame.judges?.length
      ? frame.judges.map(markdownText).join('; ')
      : '_Not recorded in source manifest_';
    lines.push(
      `## ${markdownText(frame.courseLabel || frame.courseId)} - ${markdownText(frame.frameId)}`,
      '',
      `Course ID: \`${markdownText(frame.courseId)}\` | Role: \`${markdownText(frame.role)}\` | Target: \`${markdownText(frame.target)}\` | Band: \`${markdownText(frame.band || 'not-recorded')}\``,
      '',
      `Judging intent: ${judges}`,
      '',
      '| Before | After | Difference heatmap |',
      '|---|---|---|',
      `| ![Before ${markdownText(frame.frameId)}](${relativeUrl(outputDir, files.beforePath)}) | ![After ${markdownText(frame.frameId)}](${relativeUrl(outputDir, files.afterPath)}) | ![Difference ${markdownText(frame.frameId)}](${relativeUrl(outputDir, files.diffPath)}) |`,
      '',
      '| Pixel metric | Value |',
      '|---|---:|',
      `| Classification at threshold ${frame.metrics.threshold} | ${frame.metrics.classification} |`,
      `| Raw changed pixels | ${frame.metrics.rawChangedPixels} / ${frame.metrics.totalPixels} |`,
      `| Thresholded changed pixels | ${frame.metrics.changedPixels} / ${frame.metrics.totalPixels} |`,
      `| Raw RMS error (RGBA) | ${frame.metrics.rmsError} |`,
      `| Raw maximum channel delta | ${frame.metrics.maxDelta} |`,
      `| Raw changed pixels by channel (R / G / B / A) | ${frame.metrics.channels.red.changedPixels} / ${frame.metrics.channels.green.changedPixels} / ${frame.metrics.channels.blue.changedPixels} / ${frame.metrics.channels.alpha.changedPixels} |`,
      `| Raw channel RMS (R / G / B / A) | ${frame.metrics.channels.red.rmsError} / ${frame.metrics.channels.green.rmsError} / ${frame.metrics.channels.blue.rmsError} / ${frame.metrics.channels.alpha.rmsError} |`,
      `| Raw channel max (R / G / B / A) | ${frame.metrics.channels.red.maxDelta} / ${frame.metrics.channels.green.maxDelta} / ${frame.metrics.channels.blue.maxDelta} / ${frame.metrics.channels.alpha.maxDelta} |`,
      '',
      '### Human realism scorecard',
      '',
      '| Dimension | Weight | Score | Notes |',
      '|---|---:|---:|---|',
      ...QUALITY_DIMENSIONS.map(({ name, weight }) => `| ${name} | ${weight}% | | |`),
      '',
      '| Hard gate | Verdict | Notes |',
      '|---|---|---|',
      '| Hard-gate verdict | | |',
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}
