import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('proxies', {
  onEvent: (handler: (payload: unknown) => void) => {
    ipcRenderer.on('proxies:event', (_event: IpcRendererEvent, payload: unknown) =>
      handler(payload)
    );
  },
});
