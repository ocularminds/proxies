const { Tray, Menu } = require('electron');
const path = require('path');

let tray;

function initTray() {
  tray = new Tray(path.join(__dirname, 'tray-icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Validate Proximity', type: 'normal', click: () => console.log('Validating proximity...') },
    { label: 'Quit', type: 'normal', click: () => process.exit(0) },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('QR Code Validator');
}

module.exports = { initTray };
