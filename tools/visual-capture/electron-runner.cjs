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
const jobFlagIndex = process.argv.indexOf('--job');
const JOB_FILE = jobFlagIndex >= 0 ? path.resolve(process.argv[jobFlagIndex + 1] || '') : null;
const JOB = JOB_FILE ? JSON.parse(fs.readFileSync(JOB_FILE, 'utf8')) : null;
const outputArg = process.argv.slice(2).find((arg) => !arg.startsWith('-') && !arg.endsWith('electron-runner.cjs'));
const OUTPUT_DIR = JOB
  ? resolveTask0Output(JOB.stagingRoot, JOB.courseOutputDir)
  : resolveTask0Output(OWNED_OUTPUT_ROOT, outputArg || path.join(OWNED_OUTPUT_ROOT, 'probe'));
const RESULT_FILE = JOB ? resolveTask0Output(JOB.stagingRoot, JOB.resultFile) : path.join(OUTPUT_DIR, 'result.json');
if (JOB && (!path.isAbsolute(JOB.stagingRoot) || !path.isAbsolute(JOB.dataDir))) {
  throw new Error('JOB_INVALID stagingRoot and dataDir must be absolute');
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
process.env.BIRDIE_NO_WATCH = '1';
process.env.BIRDIE_NO_AUTOLOAD = '1';
process.env.BIRDIE_PORT = String(JOB?.server?.port ?? 0);
process.env.BIRDIE_OC_PORT = String(JOB?.server?.ocPort ?? 0);
process.env.BIRDIE_DATA_DIR = JOB?.dataDir || FIXTURE_DATA;

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
  const legacy = !JOB;
  const legacySuite = legacy ? JSON.parse(fs.readFileSync(SUITE_PATH, 'utf8')) : null;
  const legacyCourse = legacySuite?.courses?.[0] || (legacySuite ? {
    id: legacySuite.id,
    cacheFile: legacySuite.course,
    expectedName: 'Open Birdie Synthetic Visual',
    hdPolicy: legacySuite.hdPolicy,
    frames: legacySuite.frames,
  } : null);
  const capture = JOB?.capture || legacySuite?.capture || {
    width: 1280,
    height: 720,
    readinessTimeoutMs: 30000,
    settleFrames: 3,
    fixedTimeSeconds: legacySuite.frames[0].time,
  };
  const course = JOB?.course || legacyCourse;
  const cachePath = path.join(process.env.BIRDIE_DATA_DIR, 'courses', course.cacheFile);
  const cachedCourse = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  if (cachedCourse.name !== course.expectedName) {
    const error = new Error(`COURSE_IDENTITY_MISMATCH expected "${course.expectedName}", got "${cachedCourse.name}"`);
    error.code = 'COURSE_IDENTITY_MISMATCH';
    throw error;
  }
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
      body: JSON.stringify({ cached: course.cacheFile }),
    });
    const loadResult = await loadResponse.json();
    if (!loadResponse.ok || !loadResult.ok) throw new Error(`LOAD_COURSE ${loadResponse.status}: ${JSON.stringify(loadResult)}`);

    win = new BrowserWindow({
      width: capture.width,
      height: capture.height,
      useContentSize: true,
      show: Boolean(JOB?.showWindow),
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
        expectedCourse: ${JSON.stringify(course.expectedName)},
        timeoutMs: ${capture.readinessTimeoutMs},
        requiredSettledFrames: ${capture.settleFrames},
        hdPolicy: ${JSON.stringify(course.hdPolicy)}
      })`,
      true,
    );

    const pageState = await win.webContents.executeJavaScript(
      `({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
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
      `window.__birdie.visualCapture.validateHdPolicy(${JSON.stringify(course.hdPolicy)})`,
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
    if (pageState.innerWidth !== capture.width || pageState.innerHeight !== capture.height) {
      throw new Error(`CONTENT_SIZE expected ${capture.width}x${capture.height}, got ${pageState.innerWidth}x${pageState.innerHeight}`);
    }
    if (pageState.readiness.course?.name !== course.expectedName ||
        pageState.readiness.course?.revision !== 1) {
      throw new Error(`COURSE_REVISION ${JSON.stringify(pageState.readiness.course)}`);
    }
    if (pageState.readiness.environment?.state !== 'ready') {
      throw new Error(`ENVIRONMENT ${JSON.stringify(pageState.readiness.environment)}`);
    }
    if (pageState.readiness.loader?.active?.length || pageState.readiness.loader?.failures?.length) {
      throw new Error(`LOADER ${JSON.stringify(pageState.readiness.loader)}`);
    }
    const frameResults = [];
    let diagnostics = pageState.diagnostics;
    let legacyCanvasCheck = null;
    let legacyPageCheck = null;
    for (const frameSpec of course.frames) {
      const frame = {
        ...frameSpec,
        width: capture.width,
        height: capture.height,
        time: frameSpec.time ?? capture.fixedTimeSeconds,
      };
      diagnostics = await win.webContents.executeJavaScript(
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
      if (diagnostics.lastVisualCapture?.renderPath !== 'postfx.render') {
        throw new Error(`POSTFX_MARKER ${JSON.stringify(diagnostics.lastVisualCapture)}`);
      }
      let imageBuffer;
      if ((frameSpec.target || 'canvas') === 'page') {
        const pageImage = await win.webContents.capturePage();
        const pageSize = pageImage.getSize();
        if (pageSize.width !== capture.width || pageSize.height !== capture.height) {
          throw new Error(`CAPTURE_PAGE_SIZE expected ${capture.width}x${capture.height}, got ${pageSize.width}x${pageSize.height}`);
        }
        imageBuffer = pageImage.toPNG();
      } else {
        const canvasDataUrl = await win.webContents.executeJavaScript(
          'window.__birdie.visualCapture.canvasPng()',
          true,
        );
        imageBuffer = Buffer.from(canvasDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
      }
      const check = inspectPng(imageBuffer, capture.width, capture.height);
      const filename = legacy ? 'canvas.png' : `${frameSpec.id}.png`;
      fs.writeFileSync(path.join(OUTPUT_DIR, filename), imageBuffer);
      frameResults.push({ id: frameSpec.id, role: frameSpec.role, target: frameSpec.target || 'canvas', file: filename, ...check });
      if (legacy) {
        legacyCanvasCheck = check;
        const pageImage = await win.webContents.capturePage();
        const pagePng = pageImage.toPNG();
        legacyPageCheck = inspectPng(pagePng, capture.width, capture.height);
        fs.writeFileSync(path.join(OUTPUT_DIR, 'page.png'), pagePng);
      }
    }
    const gpuFeatureStatus = app.getGPUFeatureStatus();
    const gpuInfo = await app.getGPUInfo('complete');
    const gpuIdentity = JSON.stringify({
      devices: gpuInfo.gpuDevice,
      auxAttributes: gpuInfo.auxAttributes,
      webgl: diagnostics.renderer,
    });
    const softwareRenderer = /swiftshader|llvmpipe|software rasterizer/i.test(gpuIdentity);
    if (softwareRenderer) throw new Error(`SOFTWARE_RENDERER ${gpuIdentity}`);
    const result = {
      ok: true,
      suite: legacySuite?.id || JOB.suiteId,
      course: course.id,
      cacheFile: course.cacheFile,
      expectedName: course.expectedName,
      frames: frameResults,
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
      ...(legacy ? { canvas: legacyCanvasCheck, page: legacyPageCheck, frame: course.frames[0].id } : {}),
      diagnostics,
      pageState,
      vegetationTextureChecksums,
      hdPolicy,
      pageConsole,
    };
    const resultTemp = `${RESULT_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(resultTemp, JSON.stringify(result, null, 2));
    fs.renameSync(resultTemp, RESULT_FILE);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      output: OUTPUT_DIR,
      ...(legacy ? { canvas: legacyCanvasCheck.sha256, page: legacyPageCheck.sha256 } : { frames: frameResults.length }),
    })}\n`);
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
    const failure = {
      ok: false,
      code: error?.code || (/^[A-Z][A-Z0-9_]+/.exec(error?.message || '')?.[0]) || 'FRAME_CAPTURE_FAILED',
      stage: 'runner',
      message: error?.message || String(error),
      error: error?.stack || String(error),
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, 'failure.json'), JSON.stringify(failure, null, 2));
    if (JOB) {
      const resultTemp = `${RESULT_FILE}.tmp-${process.pid}`;
      fs.writeFileSync(resultTemp, JSON.stringify(failure, null, 2));
      fs.renameSync(resultTemp, RESULT_FILE);
    }
    console.error(error);
    app.exit(1);
  });
