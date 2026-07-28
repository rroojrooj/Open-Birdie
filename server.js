'use strict';
// Open-Birdie — open-data golf simulator.
//   HTTP  : http://localhost:8222  (game UI + API, Server-Sent Events)
//   TCP   : port 921               (GSPro Open Connect — point GSPconnect here)
// Zero npm dependencies; needs Node 18+.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { OpenConnectServer } = require('./lib/openconnect');
const { searchCourses, loadCourse, listCached, loadCached } = require('./lib/course');
const { createCourseActivationManager } = require('./lib/course-activation');
const { createCourseDiagnostic } = require('./lib/course-diagnostics');
const { normalizeCourseSource } = require('./lib/course-identity');
const { prepareCourseCandidate } = require('./lib/resolved-course-package');
const { Game, CLUB_FULL } = require('./lib/game');
const { serveHdAsset, publicHdMetadata, pickDescriptor } = require('./lib/hd-http');
const { makeNonce, verifyReadinessAck } = require('./lib/hd-readiness');

const HTTP_PORT = +(process.env.BIRDIE_PORT || 8222);
const OC_PORT = +(process.env.BIRDIE_OC_PORT || 921);
// Bind the HTTP API to localhost by default — its mutating endpoints (reset,
// load-course, test-shot) are unauthenticated, so don't expose them to the LAN
// unless explicitly opted in. Set BIRDIE_HOST=0.0.0.0 for tablet/phone mirroring
// on a TRUSTED network only.
const HTTP_HOST = process.env.BIRDIE_HOST || '127.0.0.1';
// Correct ball speed for monitors/bridges that report m/s instead of mph
// (m/s plays ~2.2x short). e.g. BIRDIE_SPEED_SCALE=2.23694 for a metric monitor.
const SPEED_SCALE = +(process.env.BIRDIE_SPEED_SCALE || 1);
const PUB = path.join(__dirname, 'public');
const DATA_DIR = process.env.BIRDIE_DATA_DIR || path.join(__dirname, 'data');
const ART_DIR = process.env.BIRDIE_ART_DIR || path.join(__dirname, 'build', 'course-art');

const game = new Game();
const sseClients = new Set();
// HD bundle runtime state, kept OUTSIDE the serializable course object so absolute
// paths + Float32 heights never leak through course JSON. An ARRAY — one descriptor
// per built hole — so the whole course renders real 1 m relief, not just one hole.
let activeHd = [];       // resolved descriptors (server-only paths); [] when none
let courseRevision = 0;  // bumped on each course activation
// Per-process secret handed only to the loopback Electron primary client; an HD
// revision activates only on a nonce-matched ack from it.
const PRIMARY_NONCE = makeNonce();
const READY_TIMEOUT_MS = +(process.env.BIRDIE_HD_READY_TIMEOUT_MS || 15000);
let readyTimer = null;
const isLoopbackAddr = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';

let lmStatus = { connected: false, ready: false };

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

// ---------- Open Connect (launch monitor) ----------
const oc = new OpenConnectServer(OC_PORT);
oc.on('listening', (p) => console.log(`[OC] Open Connect listening on TCP ${p} — point GSPconnect/Uneekor VIEW at this PC`));
oc.on('connected', (addr) => {
  lmStatus.connected = true;
  console.log(`[OC] launch monitor connected from ${addr}`);
  broadcast('lm', lmStatus);
  updatePlayerInfo();
});
oc.on('disconnected', () => {
  lmStatus.connected = oc.clientCount > 0;
  broadcast('lm', lmStatus);
});
oc.on('status', (s) => { lmStatus.ready = s.ready; broadcast('lm', lmStatus); });
oc.on('shot', (shot) => {
  if (SPEED_SCALE !== 1 && typeof shot.ball.Speed === 'number') shot.ball.Speed *= SPEED_SCALE;
  console.log(`[OC] shot: ${shot.ball.Speed} mph, VLA ${shot.ball.VLA}, HLA ${shot.ball.HLA}, spin ${shot.ball.TotalSpin}${shot.clubName ? ' (' + shot.clubName + ')' : ''}`);
  playShot(shot.ball, shot.clubName);
});
oc.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[OC] Port ${OC_PORT} is in use — close GSPro (it uses the same Open Connect port) and restart.`);
  } else console.error('[OC]', err.message);
});

function playShot(ballData, clubName) {
  const result = game.handleShot(ballData, clubName);
  if (!result) return;
  broadcast('shot', result);
  broadcast('state', game.state());
  updatePlayerInfo();
}

function updatePlayerInfo() {
  if (!game.course) return;
  oc.setPlayer({ DistanceToTarget: Math.round(game.distToPinYd) });
}

function sourceFromCourseId(courseId) {
  const match = /^osm:(node|way|relation):([1-9][0-9]*)$/.exec(courseId || '');
  if (!match) return null;
  return normalizeCourseSource({ osmType: match[1], osmId: match[2], courseId });
}

function deriveActivationSource(request) {
  if (request?.source || (request?.osmType && request?.osmId != null)) {
    return normalizeCourseSource(request.source || request);
  }
  if (request?.cached) {
    const record = listCached().find((entry) => entry.file === path.basename(request.cached));
    const source = sourceFromCourseId(record?.courseId);
    if (source) return source;
  }
  return normalizeCourseSource(null);
}

async function acquireActivationCourse(request, { abortDifferent }) {
  if (request.cached) return loadCached(request.cached);
  return loadCourse(request, { abortDifferent });
}

function commitPreparedActivation({ candidate, resolvedPackage }) {
  let nextTimer = null;
  if (candidate.hdDescriptors.length) {
    const revision = resolvedPackage.courseRevision;
    nextTimer = setTimeout(() => {
      if (!game.runtimeReady && courseRevision === revision) {
        console.warn('[hd] readiness timeout — activating procedural fallback');
        game.activateRuntimeTerrain([]);
        broadcast('state', game.state());
      }
    }, READY_TIMEOUT_MS);
    if (nextTimer.unref) nextTimer.unref();
  }

  game.commitPreparedCourse(candidate.preparedGameState);
  activeHd = candidate.hdDescriptors;
  courseRevision = resolvedPackage.courseRevision;
  const previousTimer = readyTimer;
  readyTimer = nextTimer;
  if (previousTimer) clearTimeout(previousTimer);
}

const activationManager = createCourseActivationManager({
  deriveSource: deriveActivationSource,
  acquireCourse: acquireActivationCourse,
  prepareCandidate: ({ course, source }) => prepareCourseCandidate({
    baseCourse: course,
    requestedIdentity: source,
    packsEnabled: process.env.BIRDIE_DISABLE_CURATED !== '1',
    dataDir: DATA_DIR,
    artDir: ART_DIR,
    prepareGame: (gameplayCourse, options) => game.prepareCourse(gameplayCourse, options),
  }),
  commitPreparedActivation,
  onCommitted({ resolvedPackage, candidate }) {
    if (activeHd.length) {
      console.log(`[hd] ${activeHd.length} bundle(s) active: hole(s) ${activeHd.map((d) => d.hole).join(', ')}`);
    }
    updatePlayerInfo();
    broadcast('course', {
      name: candidate.gameplayCourse.name,
      courseId: resolvedPackage.courseId,
      courseRevision: resolvedPackage.courseRevision,
      contentRevision: resolvedPackage.contentRevision,
    });
    broadcast('state', game.state());
  },
});

// ---------- HTTP ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(game.state())}\n\n`);
      res.write(`event: lm\ndata: ${JSON.stringify(lmStatus)}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (p === '/api/state') return json(res, game.state());
    if (p === '/api/clubs') return json(res, CLUB_FULL);
    if (p === '/api/courses/cached') return json(res, listCached());
    if (p === '/api/search') {
      const q = url.searchParams.get('q') || '';
      return json(res, await searchCourses(q + (q.toLowerCase().includes('golf') ? '' : ' golf')));
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (p === '/api/load-course') {
        const result = await activationManager.activate(body);
        if (result.status === 'superseded') {
          return json(res, { ok: false, diagnostic: result.diagnostic }, 409);
        }
        if (result.status === 'failed') {
          return json(res, { ok: false, diagnostic: result.diagnostic }, 500);
        }
        // geometry is heavy (elevation grid) — clients refetch it themselves
        return json(res, {
          ok: true,
          holes: game.course.holes.length,
          courseId: result.package.courseId,
          courseRevision: result.package.courseRevision,
          contentRevision: result.package.contentRevision,
          ...(result.observerDiagnostic ? { diagnostics: [result.observerDiagnostic] } : {}),
        });
      }
      if (p === '/api/test-shot') {
        // practice panel / testing without a launch monitor
        playShot({
          Speed: +body.speed, VLA: +body.vla, HLA: +body.hla || 0,
          TotalSpin: +body.spin || 0, SpinAxis: +body.spinAxis || 0,
        });
        return json(res, { ok: true });
      }
      if (p === '/api/aim') {
        game.aimOffset = Math.max(-45, Math.min(45, +body.offset || 0));
        broadcast('state', game.state());
        return json(res, { ok: true });
      }
      if (p === '/api/club') {
        oc.setPlayer({ Club: body.club || 'DR' });
        return json(res, { ok: true });
      }
      if (p === '/api/next-hole') {
        game.nextHole();
        updatePlayerInfo();
        broadcast('state', game.state());
        return json(res, { ok: true });
      }
      if (p === '/api/course-runtime-ready') {
        const currentPackage = activationManager.current();
        const v = verifyReadinessAck(body, {
          currentRevision: currentPackage?.courseRevision || 0,
          currentBundleIds: activeHd.map((d) => d.bundleId),
          serverNonce: PRIMARY_NONCE,
          isLoopback: isLoopbackAddr(req.socket.remoteAddress),
        });
        if (!v.ok) return json(res, { ok: false, code: v.code }, 403); // nonce never echoed
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
        game.activateRuntimeTerrain(v.mode === 'hd' ? activeHd.map((d) => d.grid) : []);
        broadcast('state', game.state());
        return json(res, { ok: true, mode: v.mode });
      }
      if (p === '/api/reset') {
        game.reset();
        broadcast('state', game.state());
        return json(res, { ok: true });
      }
      if (p === '/api/settings') {
        Object.assign(game.settings, body);
        broadcast('state', game.state());
        return json(res, { ok: true });
      }
    }
    if (p.startsWith('/api/hd-assets/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const m = /^\/api\/hd-assets\/([^/]+)\/([^/]+)$/.exec(p);
      const d = m && pickDescriptor(activeHd, m[1]);
      if (!d) { res.writeHead(404); return res.end('not found'); }
      return serveHdAsset(req, res, d, m[2]);
    }
    if (p === '/api/course-aerial' && (req.method === 'GET' || req.method === 'HEAD')) {
      const a = game.course && game.course.aerial;
      const fname = a && a.file ? path.basename(a.file) : null; // basename strips any path traversal
      if (!fname) { res.writeHead(404); return res.end('not found'); }
      try {
        const buf = fs.readFileSync(path.join(DATA_DIR, 'courses', fname));
        res.writeHead(200, { 'Content-Type': fname.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : buf);
      } catch (e) { res.writeHead(404); return res.end('not found'); }
    }
    if (p === '/api/course-classmap' && (req.method === 'GET' || req.method === 'HEAD')) {
      const a = game.course && game.course.aerial;
      const fname = a && a.classFile ? path.basename(a.classFile) : null; // basename strips any path traversal
      if (!fname) { res.writeHead(404); return res.end('not found'); }
      try {
        const buf = fs.readFileSync(path.join(DATA_DIR, 'courses', fname));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }); // classmap is always PNG (data, not photo)
        return res.end(req.method === 'HEAD' ? undefined : buf);
      } catch (e) { res.writeHead(404); return res.end('not found'); }
    }
    if (p === '/api/course-geometry') return json(res, courseGeometry());

    // three.js served from node_modules (keeps the app fully offline-capable)
    if (p.startsWith('/vendor/three/')) {
      const base = path.join(__dirname, 'node_modules', 'three');
      const rel = path.normalize(p.slice('/vendor/three/'.length)).replace(/^([.][.][/\\])+/, '');
      const tfull = path.join(base, rel);
      if (!tfull.startsWith(base) || !fs.existsSync(tfull) || !fs.statSync(tfull).isFile()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(tfull)] || 'application/octet-stream' });
      return fs.createReadStream(tfull).pipe(res);
    }

    // static
    let file = p === '/' ? '/index.html' : p;
    file = path.normalize(file).replace(/^([.][.][/\\])+/, '');
    const full = path.join(PUB, file);
    if (!full.startsWith(PUB) || !fs.existsSync(full)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    console.error(`[HTTP] ${p}:`, err.message);
    json(res, {
      ok: false,
      diagnostic: createCourseDiagnostic({
        code: 'HTTP_REQUEST_FAILED',
        severity: 'error',
        stage: 'http',
        message: 'The request could not be completed.',
        recovery: 'Retry the request.',
      }),
    }, 500);
  }
});

// True iff both bounds exist and their extents are equal (tiny epsilon for float noise).
// The classmap's staleness key: it was generated against aerial.classBounds, so if a
// manual aerial swap has since changed aerial.bounds, the pixels no longer register.
function sameBounds(x, y) {
  if (!x || !y) return false;
  const eq = (a, b) => Math.abs(a - b) < 1e-6;
  return eq(x.minX, y.minX) && eq(x.minY, y.minY) && eq(x.maxX, y.maxX) && eq(x.maxY, y.maxY);
}

function courseGeometry() {
  const activePackage = activationManager.current();
  if (!game.course || !activePackage) return null;
  const { name, surfaces, boundary, holes, trees, woods, buildings, elevation } = game.course;
  // Course-wide aerial: bounds only (the image is fetched from /api/course-aerial);
  // never leak the server file path. Drapes the whole course as the ground photo.
  // classes: advertise the runtime NDVI classmap ONLY when it's fresh — i.e. it was
  // built against these same bounds. A stale classmap (aerial hand-swapped since) would
  // sample surfaces at UV coords from the NEW bounds against OLD pixels → mis-registered;
  // mismatch => classes:false => the shader falls back to OSM-only masks (safe).
  const a = game.course.aerial;
  const aerial = a ? {
    bounds: a.bounds,
    classes: !!(a.classFile && a.classBounds && sameBounds(a.classBounds, a.bounds)),
  } : null;
  // hd is an ARRAY of sanitized metadata (one per built hole; no absolute paths,
  // no Float32 heights), or null when the course has no HD bundles.
  const hd = activeHd.length ? activeHd.map(publicHdMetadata) : null;
  return {
    name,
    surfaces,
    boundary,
    holes,
    trees,
    woods,
    buildings,
    aerial,
    elevation,
    hd,
    courseId: activePackage.courseId,
    courseRevision: activePackage.courseRevision,
    contentRevision: activePackage.contentRevision,
    presentation: activePackage.presentation,
    terrainPatches: activePackage.terrainPatches,
    assetManifest: activePackage.assetManifest,
    diagnostics: activePackage.diagnostics,
  };
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

if (SPEED_SCALE !== 1) console.log(`[OC] BIRDIE_SPEED_SCALE=${SPEED_SCALE} — scaling incoming ball speed`);
async function bootstrap() {
  if (!process.env.BIRDIE_NO_AUTOLOAD) {
    const cached = listCached();
    if (cached.length) {
      const result = await activationManager.activate({ cached: cached[0].file });
      if (result.status === 'committed') {
        console.log(`[course] loaded cached: ${game.course.name} (${game.course.holes.length} holes)`);
      } else {
        console.error(`[course] cache load failed: ${JSON.stringify(result.diagnostic)}`);
      }
    }
  }
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(HTTP_PORT, HTTP_HOST, () => {
      server.off('error', onError);
      const actualPort = server.address().port;
      const exposed = HTTP_HOST !== '127.0.0.1' && HTTP_HOST !== 'localhost';
      console.log(`[HTTP] Open-Birdie UI: http://localhost:${actualPort}` +
        (exposed ? `  (exposed on ${HTTP_HOST} — trusted networks only)` : '  (localhost only — set BIRDIE_HOST=0.0.0.0 to mirror on your LAN)'));
      resolve({ httpPort: actualPort });
    });
  });
}

const ready = bootstrap();
oc.start();

function close() {
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
  for (const res of sseClients) { try { res.end(); } catch (_) { /* gone */ } }
  sseClients.clear();
  try { server.close(); } catch (_) { /* already closed */ }
  try {
    oc.server.close();
    for (const s of oc.clients) s.destroy();
  } catch (_) { /* already closed */ }
}

module.exports = {
  ready,
  close,
  primaryNonce: PRIMARY_NONCE,
  activationManager,
};
