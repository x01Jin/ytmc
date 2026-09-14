import { contextBridge, ipcRenderer } from 'electron';

// Minimal, capability-scoped bridge. The renderer never sees ipcRenderer
// itself, only these wrapped calls with plain-data arguments.
contextBridge.exposeInMainWorld('desktop', {
  getDownloadsDefault: () => ipcRenderer.invoke('desktop:get-downloads-default'),
  pickFolder: () => ipcRenderer.invoke('desktop:pick-folder'),
  revealInExplorer: (absolutePath: string) => ipcRenderer.invoke('desktop:reveal', absolutePath),
  openFile: (absolutePath: string) => ipcRenderer.invoke('desktop:open-file', absolutePath),
  getBackendPort: () => ipcRenderer.invoke('desktop:get-backend-port'),
  getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
});
