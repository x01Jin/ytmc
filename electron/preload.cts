import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  getDownloadsDefault: () => ipcRenderer.invoke('desktop:get-downloads-default'),
  pickFolder: () => ipcRenderer.invoke('desktop:pick-folder'),
  revealInExplorer: (absolutePath: string) => ipcRenderer.invoke('desktop:reveal', absolutePath),
  openFile: (absolutePath: string) => ipcRenderer.invoke('desktop:open-file', absolutePath),
  getBackendPort: () => ipcRenderer.invoke('desktop:get-backend-port'),
  getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
});

contextBridge.exposeInMainWorld('splash', {
  onStatus: (listener: (text: string) => void) => {
    ipcRenderer.on('splash:status', (_event, text: string) => listener(text));
  },
});
