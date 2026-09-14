export interface DesktopBridge {
  getDownloadsDefault: () => Promise<string>;
  pickFolder: () => Promise<string | null>;
  revealInExplorer: (absolutePath: string) => Promise<void>;
  openFile: (absolutePath: string) => Promise<void>;
  getBackendPort: () => Promise<number | null>;
  getAppVersion: () => Promise<string>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
    __BACKEND_PORT__?: number;
  }
}

export {};
