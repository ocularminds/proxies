import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import config from './config';
import { initTray } from './tray';
import { startBluetooth } from './bluetooth';
import { getHostAddress } from './network';
import { enrollHost, loadIdentity, type HostIdentity } from './identity';
import { startLanServer, type LanServer } from './lanServer';
import type { HostEvent } from './events';

let statusWindow: BrowserWindow | null = null;
let quitting = false;
let identity: HostIdentity | null = null;
let lanServer: LanServer | null = null;

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
    sendEvent({
      type: 'host-info',
      hostAddress: getHostAddress(),
      serverUrl: config.serverUrl,
      hostId: identity?.hostId ?? null,
    });
  });
}

function sendEvent(payload: HostEvent) {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.webContents.send('proxies:event', payload);
  }
}

app.whenReady().then(async () => {
  createStatusWindow();
  initTray({
    onShowStatus: () => statusWindow?.show(),
    onQuit: () => {
      quitting = true;
      app.quit();
    },
  });

  const userDataDir = app.getPath('userData');
  identity = loadIdentity(userDataDir);
  if (!identity && config.enrollmentCode) {
    try {
      identity = await enrollHost(userDataDir, config.serverUrl, config.enrollmentCode);
      sendEvent({ type: 'error', message: `Enrolled as host ${identity.hostId}.` });
    } catch (err) {
      sendEvent({ type: 'error', message: `Enrollment failed: ${(err as Error).message}` });
    }
  }
  if (!identity) {
    console.warn(
      'Host has no identity: set HOST_ENROLLMENT_CODE to enroll. Validations will be refused.'
    );
  } else {
    try {
      lanServer = await startLanServer(identity, config.lanPort);
      sendEvent({ type: 'lan', url: lanServer.url });
    } catch (err) {
      sendEvent({
        type: 'error',
        message: `LAN token listener failed to start: ${(err as Error).message}`,
      });
    }
  }

  startBluetooth({
    onEvent: sendEvent,
    getIdentity: () => identity,
    getLanUrl: () => lanServer?.url ?? null,
  });
});

app.on('window-all-closed', () => {
  // Keep running in the tray; quitting happens via the tray menu.
});
