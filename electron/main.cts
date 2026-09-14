import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort = 0;
let isQuitting = false;

const DEV_URL = process.env.ELECTRON_DEV_URL || '';
const isDev = !!DEV_URL && !app.isPackaged;

function devPort(): number {
  try {
    const parsed = new URL(DEV_URL);
    return parsed.port ? Number(parsed.port) : 3000;
  } catch {
    return 3000;
  }
}

// Strict renderer CSP, set as a response header (Electron security baseline).
// script-src stays 'self' in both envs: no inline scripts, no remote scripts.
// style-src keeps 'unsafe-inline' everywhere because React sets style
// *attributes* (e.g. the progress-bar width in ConversionProgress.tsx).
// Dev additionally allows the Vite client socket and Google Fonts;
// the filter scopes the header to our loopback origins so third-party
// responses (fonts.googleapis.com) keep their own headers untouched.
function cspPolicy(): string {
  const ws = isDev ? ' ws://127.0.0.1:* ws://localhost:*' : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "media-src 'self' blob:",
    `connect-src 'self' http://127.0.0.1:* http://localhost:*${ws} https://fonts.googleapis.com https://fonts.gstatic.com`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function registerCsp(): void {
  const policy = cspPolicy();
  const filter = { urls: ['http://127.0.0.1/*', 'http://localhost/*'] };
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

function defaultLibraryDir(): string {
  const dir = path.join(app.getPath('downloads'), 'YT Music');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function serverEntry(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server.cjs');
  }
  return path.join(app.getAppPath(), 'dist', 'server.cjs');
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        probe.close(() => resolve(port));
      } else {
        probe.close(() => reject(new Error('Could not find a free port')));
      }
    });
  });
}

function waitForServer(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (serverProcess === null && !isDev) {
        reject(new Error('Backend process exited before becoming ready.'));
        return;
      }
      const req = http.get(
        { hostname: '127.0.0.1', port, path: '/api/health', family: 4, timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
          } else {
            retry();
          }
        },
      );
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
      function retry() {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Backend did not become ready within 30s.'));
          return;
        }
        setTimeout(attempt, 250);
      }
    };
    attempt();
  });
}

async function startBackend(): Promise<number> {
  if (isDev) {
    // The dev server is owned by `concurrently` (npm run dev); just wait
    // for readiness instead of racing loadURL against server startup.
    const port = devPort();
    await waitForServer(port);
    serverPort = port;
    return port;
  }
  if (serverProcess) return serverPort;

  const port = await findFreePort();
  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`Backend bundle missing: ${entry}. Run npm run build first.`);
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    APP_DATA_DIR: app.getPath('userData'),
    APP_STATIC_DIR: path.join(process.resourcesPath, 'dist'),
    APP_DOWNLOADS_DIR: defaultLibraryDir(),
  };

  // Run the bundled Express server inside Electron's Node runtime so no
  // separate Node installation is required on the user's machine.
  serverProcess = spawn(process.execPath, [entry], {
    env,
    cwd: path.dirname(entry),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[backend] ${line}`);
  });
  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.error(`[backend:err] ${line}`);
  });
  serverProcess.on('exit', (code) => {
    console.log(`Backend exited with code ${code}`);
    serverProcess = null;
  });

  await waitForServer(port);
  serverPort = port;
  return port;
}

function stopBackend(): Promise<void> {
  return new Promise((resolve) => {
    const child = serverProcess;
    if (!child) {
      resolve();
      return;
    }
    let done = false;
    let killTimer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(killTimer);
      if (serverProcess === child) serverProcess = null;
      resolve();
    };
    child.once('exit', finish);
    const pid = child.pid;
    try {
      if (process.platform === 'win32' && pid) {
        // Windows has no SIGTERM: kill the whole process tree (backend +
        // yt-dlp + ffmpeg children) so nothing lingers after quit.
        spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      finish();
      return;
    }
    killTimer = setTimeout(() => {      try {
        if (process.platform === 'win32' && pid) {
          spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
        } else {
          child.kill('SIGKILL');
        }
      } catch {}
      finish();
    }, 5000);
  });
}

function windowIcon(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), 'assets', 'icon.png'),
    path.join(__dirname, '..', 'assets', 'icon.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return undefined;
}

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0B0B12',
    autoHideMenuBar: true,
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const target = isDev ? DEV_URL : `http://127.0.0.1:${port}`;
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  // Terminal-visible load proof: renderer failures (e.g. connection refused)
  // otherwise surface only inside DevTools, invisible to `npm run` output.
  mainWindow.webContents.once('did-finish-load', () => {
    console.log(`[window] loaded ${target}`);
  });
  mainWindow.webContents.once(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(`[window] failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
    },
  );
  void mainWindow.loadURL(target);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function focusWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function registerIpc(): void {
  ipcMain.handle('desktop:get-downloads-default', () => defaultLibraryDir());

  ipcMain.handle('desktop:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultLibraryDir(),
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('desktop:reveal', async (_event, absolutePath: string) => {
    if (typeof absolutePath !== 'string' || !absolutePath) return;
    const resolved = path.resolve(absolutePath);
    if (!fs.existsSync(resolved)) return;
    shell.showItemInFolder(resolved);
  });

  ipcMain.handle('desktop:open-file', async (_event, absolutePath: string) => {
    if (typeof absolutePath !== 'string' || !absolutePath) return;
    const resolved = path.resolve(absolutePath);
    if (!fs.existsSync(resolved)) return;
    const err = await shell.openPath(resolved);
    if (err) console.error(`openPath failed: ${err}`);
  });

  ipcMain.handle('desktop:get-backend-port', () => (serverPort > 0 ? serverPort : null));

  ipcMain.handle('desktop:get-app-version', () => app.getVersion());
}

async function boot(): Promise<void> {
  try {
    const port = await startBackend();
    registerIpc();
    registerCsp();
    createWindow(port);
  } catch (err) {
    console.error('Failed to start:', err);
    dialog.showErrorBox(
      'YT Music Converter - Failed to Start',
      `The internal server could not start.\n\n${err instanceof Error ? err.message : String(err)}\n\nPlease try restarting the application.`,
    );
    app.quit();
  }
}

// Single-instance lock: a second launch focuses the running window instead
// of spawning a second backend that would fight over ports and files.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);

  void app.whenReady().then(() => boot());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && (isDev || serverPort > 0)) {
      createWindow(isDev ? devPort() : serverPort);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', (event) => {
    if (isQuitting || !serverProcess) return;
    isQuitting = true;
    event.preventDefault();
    void stopBackend().then(() => app.quit());
  });
}

// Best-effort cleanup for abnormal termination paths.
process.on('SIGINT', () => {
  void stopBackend().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void stopBackend().then(() => process.exit(0));
});
