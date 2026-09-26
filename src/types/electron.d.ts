export interface DesktopBridge {
  getDownloadsDefault: () => Promise<string>;
  pickFolder: () => Promise<string | null>;
  revealInExplorer: (absolutePath: string) => Promise<void>;
  openFile: (absolutePath: string) => Promise<void>;
  getBackendPort: () => Promise<number | null>;
  getAppVersion: () => Promise<string>;
}

export interface SplashBridge {
  onStatus: (listener: (text: string) => void) => void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
    splash?: SplashBridge;
    __BACKEND_PORT__?: number;
  }
}
