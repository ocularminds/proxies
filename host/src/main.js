const { app, BrowserWindow, Tray, Menu } = require('electron');
const path = require('path');
const { initTray } = require('./tray');
const { startBluetooth } = require('./bluetooth');

let mainWindow;

app.on('ready', () => {
  mainWindow = new BrowserWindow({
    show: false, // Hide window
    webPreferences: { nodeIntegration: true },
  });

  initTray(mainWindow);
  startBluetooth(mainWindow);
});
