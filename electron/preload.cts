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

contextBridge.exposeInMainWorld('updates', {
  getState: () => ipcRenderer.invoke('updates:get-state'),
  check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'),
  cancelDownload: () => ipcRenderer.invoke('updates:cancel-download'),
  apply: () => ipcRenderer.invoke('updates:apply'),
  openRelease: () => ipcRenderer.invoke('updates:open-release'),
  revealLog: () => ipcRenderer.invoke('updates:reveal-log'),
  notifyRendererReady: () => ipcRenderer.invoke('updates:renderer-ready'),
  onState: (listener: (state: unknown) => void) => {
    ipcRenderer.on('updates:state', (_event, state: unknown) => listener(state));
  },
});
