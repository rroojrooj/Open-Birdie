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
const { Game, CLUB_FULL } = require('./lib/game');
const { resolveHdBundle } = require('./lib/hd-bundle');
const { serveHdAsset, publicHdMetadata } = require('./lib/hd-http');
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

const game = new Game();
const sseClients = new Set();
// HD bundle runtime state, kept OUTSIDE the serializable course object so absolute
// paths + Float32 heights never leak through course JSON.
let activeHd = null;     // resolved descriptor (server-only paths) or null
let courseRevision = 0;  // bumped on each course activation
// Per-process secret handed only to the loopback Electron primary client; an HD
// revision activates only on a nonce-matched ack from it.
const PRIMARY_NONCE = makeNonce();
const READY_TIMEOUT_MS = +(process.env.BIRDIE_HD_READY_TIMEOUT_MS || 15000);
let readyTimer = null;
const isLoopbackAddr = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';

function activateCourse(course) {
  const r = resolveHdBundle(course, { dataDir: DATA_DIR });
  activeHd = r.status === 'valid' ? r.descriptor : null;
  if (r.status === 'rejected') console.warn(`[hd] bundle rejected: ${r.code}`);
  courseRevision += 1;
  // An HD candidate holds physics (ready:false) until the primary client acks a
  // coherent scene; a plain course is immediately playable.
  game.setCourse(course, { ready: !activeHd });
  if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
  if (activeHd) {
    const rev = courseRevision;
    readyTimer = setTimeout(() => {
      if (!game.runtimeReady && courseRevision === rev) {
        console.warn('[hd] readiness timeout — activating procedural fallback');
        game.activateRuntimeTerrain([]);
        broadcast('state', game.state());
      }
    }, READY_TIMEOUT_MS);
    if (readyTimer.unref) readyTimer.unref();
  }
  return r;
}
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
        const course = body.cached ? loadCached(body.cached) : await loadCourse(body);
        activateCourse(course);
        updatePlayerInfo();
        // geometry is heavy (elevation grid) — clients refetch it themselves
        broadcast('course', { name: course.name });
        broadcast('state', game.state());
        return json(res, { ok: true, holes: course.holes.length });
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
        const v = verifyReadinessAck(body, {
          currentRevision: courseRevision,
          currentBundleId: activeHd ? activeHd.bundleId : null,
          serverNonce: PRIMARY_NONCE,
          isLoopback: isLoopbackAddr(req.socket.remoteAddress),
        });
        if (!v.ok) return json(res, { ok: false, code: v.code }, 403); // nonce never echoed
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
        game.activateRuntimeTerrain(v.mode === 'hd' && activeHd ? [activeHd.grid] : []);
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
      if (!m || !activeHd || activeHd.bundleId !== m[1]) { res.writeHead(404); return res.end('not found'); }
      return serveHdAsset(req, res, activeHd, m[2]);
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
    json(res, { error: err.message }, 500);
  }
});

function courseGeometry() {
  if (!game.course) return null;
  const { name, surfaces, boundary, holes, trees, woods, elevation } = game.course;
  // hd is sanitized metadata only (no absolute paths, no Float32 heights).
  return { name, surfaces, boundary, holes, trees, woods, elevation, hd: publicHdMetadata(activeHd), courseRevision };
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

// auto-load the most recently cached course on startup
const cached = listCached();
if (cached.length) {
  try {
    activateCourse(loadCached(cached[0].file));
    console.log(`[course] loaded cached: ${cached[0].name} (${game.course.holes.length} holes)`);
  } catch (e) { console.error('[course] cache load failed:', e.message); }
}

if (SPEED_SCALE !== 1) console.log(`[OC] BIRDIE_SPEED_SCALE=${SPEED_SCALE} — scaling incoming ball speed`);
const ready = new Promise((resolve) => {
  server.listen(HTTP_PORT, HTTP_HOST, () => {
    const exposed = HTTP_HOST !== '127.0.0.1' && HTTP_HOST !== 'localhost';
    console.log(`[HTTP] Open-Birdie UI: http://localhost:${HTTP_PORT}` +
      (exposed ? `  (exposed on ${HTTP_HOST} — trusted networks only)` : '  (localhost only — set BIRDIE_HOST=0.0.0.0 to mirror on your LAN)'));
    resolve({ httpPort: HTTP_PORT });
  });
});
oc.start();

function close() {
  for (const res of sseClients) { try { res.end(); } catch (_) { /* gone */ } }
  sseClients.clear();
  try { server.close(); } catch (_) { /* already closed */ }
  try {
    oc.server.close();
    for (const s of oc.clients) s.destroy();
  } catch (_) { /* already closed */ }
}

module.exports = { ready, close, primaryNonce: PRIMARY_NONCE };
