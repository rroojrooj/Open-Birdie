'use strict';
// Uneekor VIEW -> Open-Birdie bridge (no paid third-party connection needed).
//
// Uneekor VIEW writes a folder per shot under ...\LocalLow\Uneekor\VIEW\ShotData\,
// even on the free Practice tier. Each folder has a small `shotinfo.json` holding
// the ball numbers (ballspeed/incline/azimuth/spin). This watcher tails that
// directory, and when a new shot appears it speaks the GSPro Open Connect protocol
// to Open-Birdie on TCP 921 — exactly like GSPconnect would — so the shot plays.
//
// Usage:
//   node tools/uneekor-watch.js                # watch for new shots, feed Open-Birdie
//   node tools/uneekor-watch.js --replay-last  # also fire the most recent existing shot once (smoke test)
//   node tools/uneekor-watch.js --invert-hla   # mirror left/right if aim comes out flipped
//   node tools/uneekor-watch.js --speed-scale 2.23694   # if VIEW reports m/s, convert to mph
//
// Env: BIRDIE_OC_HOST (127.0.0.1), BIRDIE_OC_PORT (921), UNEEKOR_SHOTDATA (override path).

const fs = require('fs');
const net = require('net');
const path = require('path');

// ---------- config ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const HOST = process.env.BIRDIE_OC_HOST || '127.0.0.1';
const PORT = +(process.env.BIRDIE_OC_PORT || 921);
const POLL_MS = +opt('poll', 400);
const SPEED_SCALE = +opt('speed-scale', 1);   // ballspeed * this -> mph
const INVERT_HLA = flag('invert-hla');
const REPLAY_LAST = flag('replay-last');

// Default ShotData dir: %LOCALAPPDATA%\..\LocalLow\Uneekor\VIEW\ShotData
const DEFAULT_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, '..', 'LocalLow', 'Uneekor', 'VIEW', 'ShotData')
  : null;
const SHOT_DIR = process.env.UNEEKOR_SHOTDATA || opt('dir', DEFAULT_DIR);

if (!SHOT_DIR || !fs.existsSync(SHOT_DIR)) {
  console.error(`[watch] ShotData folder not found: ${SHOT_DIR}`);
  console.error('        Pass --dir "C:\\path\\to\\Uneekor\\VIEW\\ShotData" or set UNEEKOR_SHOTDATA.');
  process.exit(1);
}
console.log(`[watch] watching ${SHOT_DIR}`);
console.log(`[watch] feeding Open-Birdie at ${HOST}:${PORT} (Open Connect)`);

// ---------- Open Connect client (persistent, auto-reconnecting) ----------
let sock = null;
let connected = false;
let shotCounter = 0;

function connect() {
  sock = net.connect(PORT, HOST, () => {
    connected = true;
    console.log('[watch] connected to Open-Birdie - LM badge should be green');
  });
  sock.on('data', () => { /* swallow Open-Birdie's 200/201 acks */ });
  sock.on('error', () => { /* handled by close */ });
  sock.on('close', () => {
    if (connected) console.log('[watch] connection lost - retrying...');
    connected = false;
    sock = null;
    setTimeout(connect, 1500);
  });
}
connect();

// Heartbeat so Open-Birdie keeps us shown as a live, ready launch monitor.
setInterval(() => {
  if (!connected || !sock) return;
  send({
    DeviceID: 'Uneekor VIEW (Open-Birdie watch)',
    Units: 'Yards', ShotNumber: shotCounter, APIversion: '1',
    ShotDataOptions: { ContainsBallData: false, ContainsClubData: false,
      LaunchMonitorIsReady: true, LaunchMonitorBallDetected: false, IsHeartBeat: true },
  });
}, 3000);

function send(msg) {
  try { sock.write(JSON.stringify(msg)); } catch (_) { /* gone; reconnect handles it */ }
}

// ---------- shot parsing ----------
const num = (s) => parseFloat(String(s).trim());

function ballFromShotInfo(info) {
  const d = info && info.DATA;
  if (!d) return null;
  const speed = num(d.ballspeed) * SPEED_SCALE;
  if (!isFinite(speed) || speed <= 0) return null; // not a valid ball read (e.g. club-only / mid-write)
  const hla = num(d.azimuth) || 0;
  const totalSpin = isFinite(num(d.spinmag2d)) ? num(d.spinmag2d)
    : Math.hypot(num(d.backspin) || 0, num(d.sidespin) || 0);
  return {
    Speed: round(speed, 2),
    VLA: round(num(d.incline) || 0, 2),
    HLA: round((INVERT_HLA ? -hla : hla), 2),
    TotalSpin: round(totalSpin, 1),
    SpinAxis: round(num(d.spinaxis2d) || 0, 2),
    BackSpin: round(num(d.backspin) || 0, 1),
    SideSpin: round(num(d.sidespin) || 0, 1),
    CarryDistance: 0,
  };
}
const round = (n, p) => +n.toFixed(p);

function clubName(dir) {
  try {
    const pro = JSON.parse(fs.readFileSync(path.join(dir, 'ProShotInfo.json'), 'utf8'));
    return pro.ClubName || pro.Club || '';
  } catch (_) { return ''; }
}

function sendShot(folder) {
  const dir = path.join(SHOT_DIR, folder);
  let info;
  try { info = JSON.parse(fs.readFileSync(path.join(dir, 'shotinfo.json'), 'utf8')); }
  catch (_) { return false; } // file not ready / mid-write — try again next poll
  const ball = ballFromShotInfo(info);
  if (!ball) return false;
  if (!connected || !sock) { console.log(`[watch] shot ${folder} ready but not connected yet — will retry`); return false; }

  shotCounter++;
  const club = clubName(dir);
  send({
    DeviceID: 'Uneekor VIEW (Open-Birdie watch)',
    Units: 'Yards', ShotNumber: shotCounter, APIversion: '1',
    BallData: ball, ClubData: null,
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: false,
      LaunchMonitorIsReady: true, LaunchMonitorBallDetected: true, IsHeartBeat: false },
  });
  console.log(`[watch] shot #${folder}${club ? ' (' + club + ')' : ''}: `
    + `${ball.Speed} mph, VLA ${ball.VLA}, HLA ${ball.HLA}, spin ${ball.TotalSpin} @ axis ${ball.SpinAxis}`);
  return true;
}

// ---------- watch loop (polling: simple and robust on Windows) ----------
const listShots = () => {
  try { return fs.readdirSync(SHOT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name); }
  catch (_) { return []; }
};
const numeric = (a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0);

const seen = new Set(listShots());          // prime: existing shots are NOT replayed
const pending = new Set();                   // folders detected but not yet successfully sent

if (REPLAY_LAST) {
  const latest = [...seen].sort(numeric).pop();
  if (latest) { console.log(`[watch] --replay-last: re-firing existing shot ${latest}`); seen.delete(latest); pending.add(latest); }
}

console.log(`[watch] ready - ${seen.size} existing shots ignored; swing away.`);

setInterval(() => {
  for (const name of listShots()) {
    if (!seen.has(name) && !pending.has(name)) pending.add(name);
  }
  for (const name of [...pending].sort(numeric)) {
    if (sendShot(name)) { pending.delete(name); seen.add(name); }
  }
}, POLL_MS);

process.on('SIGINT', () => { console.log('\n[watch] bye'); try { sock && sock.end(); } catch (_) {} process.exit(0); });
