import { Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';

let tray: Tray;

export interface TrayHandlers {
  onShowStatus: () => void;
  onQuit: () => void;
}

export function initTray({ onShowStatus, onQuit }: TrayHandlers): Tray {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '..', 'assets', 'tray-iconTemplate.png')
  );
  tray = new Tray(icon);
  tray.setToolTip('Proxies host');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Status', click: onShowStatus },
      { type: 'separator' },
      { label: 'Quit', click: onQuit },
    ])
  );
  return tray;
}
