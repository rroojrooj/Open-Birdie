'use strict';

const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { resolveTask0Output } = require('./output-path.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_DATA = path.join(ROOT, 'test', 'fixtures', 'visual-capture-data');
const SUITE_PATH = path.join(__dirname, 'suites', 'synthetic-smoke.json');
const OWNED_OUTPUT_ROOT = path.join(ROOT, '.shots', 'visual', 'task0-probes');
const outputArg = process.argv.slice(2).find((arg) => !arg.startsWith('-') && !arg.endsWith('electron-runner.cjs'));
const OUTPUT_DIR = resolveTask0Output(
  OWNED_OUTPUT_ROOT,
  outputArg || path.join(OWNED_OUTPUT_ROOT, 'probe'),
);

app.commandLine.appendSwitch('force-device-scale-factor', '1');
process.env.BIRDIE_NO_WATCH = '1';
process.env.BIRDIE_NO_AUTOLOAD = '1';
process.env.BIRDIE_PORT = '0';
process.env.BIRDIE_OC_PORT = '0';
process.env.BIRDIE_DATA_DIR = FIXTURE_DATA;

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function inspectPng(buffer, expectedWidth, expectedHeight) {
  const png = PNG.sync.read(buffer);
  if (png.width !== expectedWidth || png.height !== expectedHeight) {
    throw new Error(`PNG_SIZE expected ${expectedWidth}x${expectedHeight}, got ${png.width}x${png.height}`);
  }
  let min = 255;
  let max = 0;
  let opaque = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const light = Math.round((png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3);
    min = Math.min(min, light);
    max = Math.max(max, light);
    if (png.data[i + 3] > 0) opaque += 1;
  }
  if (opaque === 0 || max - min < 8) throw new Error(`PNG_BLANK opaque=${opaque} luminanceRange=${max - min}`);
  return { width: png.width, height: png.height, luminanceRange: max - min, opaquePixels: opaque, sha256: sha256(buffer) };
}

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const suite = JSON.parse(fs.readFileSync(SUITE_PATH, 'utf8'));
  // Environment variables must be fixed before this require: server/course
  // modules resolve their ports and data root at module initialization.
  const srv = require(path.join(ROOT, 'server.js'));
  let win = null;
  const pageConsole = [];
  try {
    const { httpPort } = await srv.ready;
    const origin = `http://127.0.0.1:${httpPort}`;
    const loadResponse = await fetch(`${origin}/api/load-course`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cached: suite.course }),
    });
    const loadResult = await loadResponse.json();
    if (!loadResponse.ok || !loadResult.ok) throw new Error(`LOAD_COURSE ${loadResponse.status}: ${JSON.stringify(loadResult)}`);

    win = new BrowserWindow({
      width: suite.width,
      height: suite.height,
      useContentSize: true,
      show: false,
      backgroundColor: '#000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        paintWhenInitiallyHidden: true,
      },
    });
    win.webContents.on('console-message', (_event, level, message) => {
      pageConsole.push({ level, message });
    });
    await win.loadURL(`${origin}/?visualCapture=1&primaryNonce=${encodeURIComponent(srv.primaryNonce)}`);
    await win.webContents.executeJavaScript(
      `window.__birdie.visualCapture.waitUntilReady({
        timeoutMs: 30000,
        requiredSettledFrames: 3,
        hdPolicy: ${JSON.stringify(suite.hdPolicy)}
      })`,
      true,
    );

    const frame = { ...suite.frames[0], width: suite.width, height: suite.height };
    const diagnostics = await win.webContents.executeJavaScript(
      `(async () => {
        let diagnostics;
        for (let i = 0; i < 8; i += 1) {
          diagnostics = window.__birdie.visualCapture.applyFrame(${JSON.stringify(frame)});
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return diagnostics;
      })()`,
      true,
    );
    const pageState = await win.webContents.executeJavaScript(
      `({
        visibilityState: document.visibilityState,
        devicePixelRatio: window.devicePixelRatio,
        readiness: window.__birdie.visualCapture.status(),
        diagnostics: window.__birdie.visualCapture.diagnostics()
      })`,
      true,
    );
    const vegetationTextureChecksums = await win.webContents.executeJavaScript(
      'window.__birdie.visualCapture.vegetationTextureChecksums()',
      true,
    );
    const hdPolicy = await win.webContents.executeJavaScript(
      `window.__birdie.visualCapture.validateHdPolicy(${JSON.stringify(suite.hdPolicy)})`,
      true,
    );
    if (!hdPolicy.ok) throw new Error(`HD_POLICY ${JSON.stringify(hdPolicy)}`);
    for (const kind of ['straw', 'flower']) {
      const checksum = vegetationTextureChecksums[kind];
      if (!checksum?.stable || checksum.a !== checksum.b) {
        throw new Error(`VEGETATION_TEXTURE_DRIFT ${kind}: ${JSON.stringify(checksum)}`);
      }
    }
    if (pageState.visibilityState !== 'visible') throw new Error(`PAGE_HIDDEN ${pageState.visibilityState}`);
    if (pageState.devicePixelRatio !== 1) throw new Error(`DPR expected 1, got ${pageState.devicePixelRatio}`);
    if (pageState.readiness.course?.name !== 'Open Birdie Synthetic Visual' ||
        pageState.readiness.course?.revision !== 1) {
      throw new Error(`COURSE_REVISION ${JSON.stringify(pageState.readiness.course)}`);
    }
    if (pageState.readiness.environment?.state !== 'ready') {
      throw new Error(`ENVIRONMENT ${JSON.stringify(pageState.readiness.environment)}`);
    }
    if (pageState.readiness.loader?.active?.length || pageState.readiness.loader?.failures?.length) {
      throw new Error(`LOADER ${JSON.stringify(pageState.readiness.loader)}`);
    }
    if (diagnostics.lastVisualCapture?.renderPath !== 'postfx.render') {
      throw new Error(`POSTFX_MARKER ${JSON.stringify(diagnostics.lastVisualCapture)}`);
    }
    const canvasDataUrl = await win.webContents.executeJavaScript(
      'window.__birdie.visualCapture.canvasPng()',
      true,
    );
    const canvasPng = Buffer.from(canvasDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    const pageImage = await win.webContents.capturePage();
    const pageSize = pageImage.getSize();
    if (pageSize.width !== suite.width || pageSize.height !== suite.height) {
      throw new Error(`CAPTURE_PAGE_SIZE expected ${suite.width}x${suite.height}, got ${pageSize.width}x${pageSize.height}`);
    }
    const pagePng = pageImage.toPNG();
    const canvasCheck = inspectPng(canvasPng, suite.width, suite.height);
    const pageCheck = inspectPng(pagePng, suite.width, suite.height);
    const gpuFeatureStatus = app.getGPUFeatureStatus();
    const gpuInfo = await app.getGPUInfo('complete');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'canvas.png'), canvasPng);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'page.png'), pagePng);

    const gpuIdentity = JSON.stringify({
      devices: gpuInfo.gpuDevice,
      auxAttributes: gpuInfo.auxAttributes,
      webgl: diagnostics.renderer,
    });
    const softwareRenderer = /swiftshader|llvmpipe|software rasterizer/i.test(gpuIdentity);
    if (softwareRenderer) throw new Error(`SOFTWARE_RENDERER ${gpuIdentity}`);
    const result = {
      ok: true,
      suite: suite.id,
      course: suite.course,
      frame: suite.frames[0].id,
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.versions.node,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        deviceScaleFactor: pageState.devicePixelRatio,
        gpuFeatureStatus,
        gpuInfo,
        softwareRenderer,
      },
      canvas: canvasCheck,
      page: pageCheck,
      diagnostics,
      pageState,
      vegetationTextureChecksums,
      hdPolicy,
      pageConsole,
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify({ ok: true, output: OUTPUT_DIR, canvas: canvasCheck.sha256, page: pageCheck.sha256 })}\n`);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    srv.close();
  }
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'failure.json'), JSON.stringify({
      ok: false,
      error: error?.stack || String(error),
    }, null, 2));
    console.error(error);
    app.exit(1);
  });
