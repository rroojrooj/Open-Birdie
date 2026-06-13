'use strict';
// Electron shell: runs the sim server in the main process and opens the
// game fullscreen. `npm start` launches this; `npm run start:server`
// runs the same server headless for browser/tablet use.
const { app, BrowserWindow, globalShortcut } = require('electron');

const HTTP_PORT = +(process.env.BIRDIE_PORT || 8222);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
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
    win = new BrowserWindow({
      fullscreen: true,
      autoHideMenuBar: true,
      backgroundColor: '#0a160e',
      title: 'Open-Birdie',
      webPreferences: { contextIsolation: true },
    });
    win.loadURL(`http://localhost:${HTTP_PORT}`);
    win.on('closed', () => { win = null; });

    globalShortcut.register('F11', () => {
      if (win) win.setFullScreen(!win.isFullScreen());
    });
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    srv.close();
    app.quit();
  });
}
