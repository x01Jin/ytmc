export interface DesktopBridge {
  pickFolder: () => Promise<string | null>;
}

export interface SplashBridge {
  onStatus: (listener: (text: string) => void) => void;
}

export type UpdatePhase =
  | 'unsupported'
  | 'blocked'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'applying'
  | 'error';

export interface ApplyProgress {
  phase: string;
  percent: number | null;
  bytes: number;
  totalBytes: number | null;
  entries: number;
  totalEntries: number | null;
}

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion: string | null;
  notes: string | null;
  releaseUrl: string | null;
  archiveBytes: number | null;
  receivedBytes: number;
  progressPercent: number | null;
  applyProgress: ApplyProgress | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastCheckedAt: number | null;
  lastApply: {
    ok: boolean;
    reason: string;
    toVersion: string;
    at: number;
    detail?: string;
    restored?: boolean;
  } | null;
  logPath: string | null;
  canDownload: boolean;
  canApply: boolean;
}

export interface UpdateBridge {
  getState: () => Promise<UpdateState>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  apply: () => Promise<void>;
  openRelease: () => Promise<void>;
  revealLog: () => Promise<void>;
  notifyRendererReady: () => Promise<void>;
  onState: (listener: (state: UpdateState) => void) => void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
    splash?: SplashBridge;
    updates?: UpdateBridge;
    __BACKEND_PORT__?: number;
  }
}
