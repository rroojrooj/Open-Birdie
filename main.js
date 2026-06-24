'use strict';
// Electron shell: runs the sim server in the main process and opens the
// game fullscreen. `npm start` launches this; `npm run start:server`
// runs the same server headless for browser/tablet use.
const { app, BrowserWindow, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const HTTP_PORT = +(process.env.BIRDIE_PORT || 8222);

// Auto-start the free Uneekor VIEW feed bridge so the launch monitor connects
// on its own — no separate `npm run watch`, no paywalled GSPconnect. Only runs
// when the VIEW ShotData folder is present, so non-Uneekor setups are untouched.
// Set BIRDIE_NO_WATCH=1 to opt out (e.g. when using GSPconnect instead).
let watcher = null;
function startWatcher() {
  if (process.env.BIRDIE_NO_WATCH) return;
  const shotDir = process.env.UNEEKOR_SHOTDATA || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, '..', 'LocalLow', 'Uneekor', 'VIEW', 'ShotData')
    : null);
  if (!shotDir || !fs.existsSync(shotDir)) return;
  const script = path.join(__dirname, 'tools', 'uneekor-watch.js');
  // process.execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes it run
  // the bridge as a plain Node script (no separate Node install needed).
  watcher = spawn(process.execPath, [script, '--speed-scale', '2.23694'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  watcher.on('exit', () => { watcher = null; });
}
function stopWatcher() {
  if (!watcher) return;
  try { watcher.kill(); } catch (_) { /* already gone */ }
  watcher = null;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Packaged builds run from a read-only app.asar; redirect the writable data
  // dir (course cache) to per-user AppData. Dev + headless (node server.js)
  // keep the repo's data/ via the env-var default in lib/course.js.
  if (app.isPackaged) {
    process.env.BIRDIE_DATA_DIR = path.join(app.getPath('userData'), 'data');
  }
  let win = null;
  const srv = require('./server');

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    await srv.ready;
    startWatcher();
    win = new BrowserWindow({
      fullscreen: true,
      autoHideMenuBar: true,
      backgroundColor: '#0a160e',
      title: 'Open-Birdie',
      webPreferences: { contextIsolation: true },
    });
    // Hand the readiness nonce ONLY to the loopback Electron primary client, so
    // LAN/SSE mirrors can render but cannot activate an HD course revision.
    win.loadURL(`http://localhost:${HTTP_PORT}?primaryNonce=${srv.primaryNonce}`);
    win.on('closed', () => { win = null; });

    globalShortcut.register('F11', () => {
      if (win) win.setFullScreen(!win.isFullScreen());
    });
  });

  app.on('will-quit', () => { globalShortcut.unregisterAll(); stopWatcher(); });
  app.on('window-all-closed', () => {
    stopWatcher();
    srv.close();
    app.quit();
  });
}
