import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import config from './config';
import { initTray } from './tray';
import { startBluetooth } from './bluetooth';
import { getHostAddress } from './network';
import type { HostEvent } from './events';

let statusWindow: BrowserWindow | null = null;
let quitting = false;

function createStatusWindow() {
  statusWindow = new BrowserWindow({
    width: 460,
    height: 520,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  statusWindow.loadFile(path.join(__dirname, 'index.html'));

  // Closing the window hides it; the app lives in the tray.
  statusWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      statusWindow?.hide();
    }
  });

  statusWindow.webContents.on('did-finish-load', () => {
    sendEvent({ type: 'host-info', hostAddress: getHostAddress(), serverUrl: config.serverUrl });
  });
}

function sendEvent(payload: HostEvent) {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.webContents.send('proxies:event', payload);
  }
}

app.whenReady().then(() => {
  createStatusWindow();
  initTray({
    onShowStatus: () => statusWindow?.show(),
    onQuit: () => {
      quitting = true;
      app.quit();
    },
  });
  startBluetooth({ onEvent: sendEvent });
});

app.on('window-all-closed', () => {
  // Keep running in the tray; quitting happens via the tray menu.
});
